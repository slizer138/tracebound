// Regression tests for the reviewer findings of 2026-11-25 (backend side).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededWorld } from './seeded.js';
import { makeWorld, drainQueue, projectCtx } from './fakes.js';
import { makeHandlers } from '../../src/backend/handlers.js';
import { K } from '../../src/backend/keys.js';
import { staleReason, STALE_RUN_MS } from '../../src/backend/seeder.js';
import { listAudit } from '../../src/backend/audit.js';

const parse = (s) => JSON.parse(s);
// The second handler argument as Forge documents it (function-reference/arguments).
const invocationCtx = (accountId) => ({ installContext: 'ari:cloud:jira::site/1', principal: { accountId } });

test('Rovo actions: project key from payload.context.jira, actor from the invocation principal', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const a = parse(await w.actions.getReadiness({ context: { jira: { projectKey: 'PUMP' } } }, invocationCtx('u-9')));
  assert.equal(a.data.readiness.pct, 75);
  const t = parse(await w.actions.getTraceGaps({ context: { cloudId: 'c', moduleKey: 'm', jira: { projectKey: 'PUMP' } } }, invocationCtx('u-9')));
  assert.equal(t.data.projectKey, 'PUMP');
  const c = parse(await w.actions.createReverification({ testKey: w.key('TEST-14'), itemKey: w.key('REQ-7') }, invocationCtx('u-9')));
  assert.equal(c.data.created, true);
  const audit = await listAudit(w.store, 'PUMP', { limit: 25 });
  const rec = (audit.records ?? audit.items ?? audit).find((r) => r.type === 'REVERIFY_TASK_CREATED');
  assert.ok(rec, 'audit record written');
  assert.equal(rec.actor, 'u-9');
});

test('re-verification guard: an open task for PUMP-70 is not taken for PUMP-7 (exact summary match)', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const testKey = w.key('TEST-14');
  const req = w.key('REQ-7');
  const decoy = w.jira.addIssue({ summary: `Re-verify ${testKey} against changed ${req}0`, labels: ['tb-reverify'] });
  w.jira.linkIssues('Relates', decoy.key ?? decoy, testKey);
  const r = await w.call('link.createReverifyTask', { downKey: testKey, upKey: req });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.created, true);
  assert.notEqual(r.data.taskKey, decoy.key ?? decoy);
});

test('re-verification guard does not depend on the search index (second click right after creation)', async () => {
  const w = await seededWorld();
  w.demoEdit();
  // Simulate index lag: the duplicate-guard search never sees the new task.
  w.jira.override(({ method, path, body }) => (method === 'POST' && path === '/rest/api/3/search/jql' && /tb-reverify/.test(body?.jql ?? '')
    ? { ok: true, status: 200, json: { issues: [] }, retryAfter: null } : null));
  const args = { downKey: w.key('TEST-15'), upKey: w.key('REQ-7') };
  const a = await w.call('link.createReverifyTask', args);
  assert.equal(a.data.created, true);
  const b = await w.call('link.createReverifyTask', args);
  assert.equal(b.ok, true, JSON.stringify(b.error));
  assert.equal(b.data.created, false);
  assert.equal(b.data.taskKey, a.data.taskKey);
  // A recorded task that is Done no longer blocks a new one.
  w.jira.transition(a.data.taskKey, 3);
  const c = await w.call('link.createReverifyTask', args);
  assert.equal(c.data.created, true);
  assert.notEqual(c.data.taskKey, a.data.taskKey);
});

test('seed: a failed queue push marks the run failed; the next click resumes it', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const realPush = w.queue.push;
  w.queue.push = async () => { throw new Error('queue unavailable'); };
  const first = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(first.ok, false);
  const ptr = await w.store.get(K.seedProj('PUMP'));
  const run = await w.store.get(K.seedRun(ptr.runId));
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'QUEUE_ERROR');
  w.queue.push = realPush;
  const second = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(second.ok, true, JSON.stringify(second.error));
  assert.equal(second.data.runId, ptr.runId);
  await drainQueue(w.queue, w.jobDeps);
  const done = await w.store.get(K.seedRun(ptr.runId));
  assert.equal(done.status, 'done');
  assert.equal(done.actual.readinessPct, 92);
});

test('seed: a run whose job failed or went quiet is marked failed by seed.status, then resumes', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const start = await h['seed.start']({ payload: {}, context: projectCtx() });
  const runId = start.data.runId;
  // Job reported failed by the queue, consumer never ran.
  w.queue.stats = async () => ({ success: 0, inProgress: 0, failed: 1 });
  const st = await h['seed.status']({ payload: { runId }, context: projectCtx() });
  assert.equal(st.ok, true);
  assert.equal(st.data.run.status, 'failed');
  assert.equal(st.data.run.error.code, 'STALE_JOB');
  assert.match(st.data.run.error.hint, /Load sample data/);
  w.queue.stats = async () => ({ success: 0, inProgress: 1, failed: 0 });
  const again = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(again.data.runId, runId);
  assert.equal(again.data.status, 'queued');
  await drainQueue(w.queue, w.jobDeps, 1);
  assert.equal((await w.store.get(K.seedRun(runId))).status, 'done');
});

test('staleReason: time-based and stats-based rules', () => {
  const now = Date.parse('2026-12-01T10:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const run = (status, ageMs) => ({ status, updatedAt: iso(now - ageMs) });
  assert.equal(staleReason(run('running', 60000), now, { success: 0, inProgress: 1, failed: 0 }), null);
  assert.match(staleReason(run('running', STALE_RUN_MS + 1), now, null), /not reported progress/);
  assert.match(staleReason(run('removing', 1000), now, { success: 0, inProgress: 0, failed: 1 }), /failed/);
  // "ended" needs two quiet minutes, so a pending retry is not mistaken for a dead job.
  assert.equal(staleReason(run('running', 30000), now, { success: 1, inProgress: 0, failed: 0 }), null);
  assert.match(staleReason(run('running', 3 * 60000), now, { success: 1, inProgress: 0, failed: 0 }), /ended/);
  assert.equal(staleReason(run('done', STALE_RUN_MS * 2), now, null), null);
});

test('stuck removal: a run left "removing" can be removed again after it is marked failed', async () => {
  const w = await seededWorld();
  const realPush = w.queue.push;
  w.queue.push = async () => { throw new Error('queue unavailable'); };
  const r = await w.call('seed.remove', { runId: w.runId });
  assert.equal(r.ok, false);
  assert.equal((await w.store.get(K.seedRun(w.runId))).status, 'failed');
  w.queue.push = realPush;
  const r2 = await w.call('seed.remove', { runId: w.runId });
  assert.equal(r2.ok, true, JSON.stringify(r2.error));
  assert.equal(r2.data.status, 'removing');
});

test('status cache is filled as the app, and refetched once when a status id is unknown', async () => {
  const w = await seededWorld();
  await w.store.delete(K.statuses);
  // The user's view of statuses is incomplete; the shared cache must not be filled from it.
  w.jira.override(({ mode, method, path }) => (mode === 'user' && method === 'GET' && path === '/rest/api/3/status'
    ? { ok: true, status: 200, json: [], retryAfter: null } : null));
  const v = await w.call('project.getView');
  assert.equal(v.data.trace.readiness.pct, 92);
  const statusCalls = w.jira.calls('GET', /^\/rest\/api\/3\/status$/);
  assert.ok(statusCalls.length > 0 && statusCalls.every((c) => c.mode === 'app'), JSON.stringify(statusCalls.map((c) => c.mode)));
  // A fresh cache that lacks the Done status (created after the cache was filled) is refetched.
  await w.store.set(K.statuses, { at: w.now().getTime(), byId: { 1: 'new' } });
  const before = w.jira.calls('GET', /^\/rest\/api\/3\/status$/).length;
  const v2 = await w.call('project.getView');
  assert.equal(v2.data.trace.readiness.pct, 92);
  assert.equal(w.jira.calls('GET', /^\/rest\/api\/3\/status$/).length, before + 1);
});

test('issue-type role mode: misspelled types are refused on save; a stored bad config gives CONFIG_INVALID', async () => {
  const w = await seededWorld();
  const cfg = (await w.call('project.getConfig')).data.config;
  const bad = { ...cfg, roleMode: 'issueTypes', issueTypes: { req: 'Requirment', test: 'Task' } };
  const r = await w.call('project.saveConfig', { config: bad });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CONFIG_INVALID');
  assert.match(r.error.message, /Requirment/);
  // A config that got stored anyway (for example before this check existed) and a JQL 400.
  await w.store.set(K.config('PUMP'), { schema: 1, ...bad });
  w.jira.override(({ method, path, body }) => (method === 'POST' && path === '/rest/api/3/search/jql' && /issuetype in/.test(body?.jql ?? '')
    ? { ok: false, status: 400, json: { errorMessages: ["The value 'Requirment' does not exist for the field 'issuetype'."] }, retryAfter: null } : null));
  const v = await w.call('project.getView');
  assert.equal(v.ok, false);
  assert.equal(v.error.code, 'CONFIG_INVALID');
});
