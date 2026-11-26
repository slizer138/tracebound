// B2-B4: seeder happy path, idempotency, crash resume, workflow variants and errors, plus
// the end-to-end demo numbers through the real loader + engine on a fake Jira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, drainQueue, projectCtx } from './fakes.js';
import { makeHandlers } from '../../src/backend/handlers.js';
import { runSeed, removeSeed, startSeed, runLabel } from '../../src/backend/seeder.js';
import { K } from '../../src/backend/keys.js';
import { verifyAudit } from '../../src/backend/audit.js';
import { SAMPLE_PLAN } from '../../src/engine/index.js';

const REQ7_TEXT = SAMPLE_PLAN.issues.find((i) => i.ref === 'REQ-7').paragraphs;

async function seeded(opts) {
  const w = makeWorld(opts);
  const h = makeHandlers(w.deps);
  const start = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(start.ok, true, JSON.stringify(start.error));
  const results = await drainQueue(w.queue, w.jobDeps);
  const run = await w.store.get(K.seedRun(start.data.runId));
  return { ...w, h, run, results, runId: start.data.runId };
}

test('B2 happy path: 30 issues, 19 links, 13 passes, 63/63, readiness 92 expected and actual', async () => {
  const w = await seeded();
  assert.equal(w.run.status, 'done', JSON.stringify(w.run.error));
  assert.equal(Object.keys(w.run.refToKey).length, 30);
  assert.equal(w.jira.calls('POST', /^\/rest\/api\/3\/issue\/bulk$/).length, 1);
  assert.equal(w.jira.calls('POST', /^\/rest\/api\/3\/issue\/bulk$/)[0].body.issueUpdates.length, 30);
  assert.equal(w.jira.calls('POST', /^\/rest\/api\/3\/issueLink$/).length, 19);
  assert.equal(w.run.passedRefs.length, 13);
  assert.deepEqual(w.run.progress, { done: 63, total: 63 });
  assert.equal(w.run.expected.readinessPct, 92);
  assert.equal(w.run.actual.readinessPct, 92);
  assert.deepEqual(w.run.warnings, []);
  // Every Jira call in the consumer ran as the app.
  assert.ok(w.jira.state.calls.filter((c) => c.method !== 'GET' || !c.path.includes('mypermissions')).length > 0);
  for (const c of w.jira.calls('POST', /^\/rest\/api\/3\/issue(\/bulk|Link)?$/)) assert.equal(c.mode, 'app');
  // Labels and the run label.
  const req7 = w.jira.byRef('REQ-7');
  assert.deepEqual(req7.fields.labels, ['trace-req', 'tb-sample', runLabel(w.runId)]);
  // Links use outward = downstream, inward = upstream, type Relates.
  const l = w.jira.calls('POST', /^\/rest\/api\/3\/issueLink$/)[0].body;
  assert.equal(l.type.name, 'Relates');
  assert.equal(l.outwardIssue.key, w.run.refToKey['TEST-1']);
  assert.equal(l.inwardIssue.key, w.run.refToKey['REQ-1']);
  // Audit: CONFIG_SAVED (defaults), SEED_STARTED, BASELINE_FROZEN, SEED_FINISHED; chain intact.
  const v = await verifyAudit(w.store, 'PUMP');
  assert.equal(v.ok, true);
  assert.equal(v.count, 4);
});

test('demo end to end through loader + engine: edit REQ-7 25 -> 20 gives 75%, 3 suspect, CTRL-2 upstream changed', async () => {
  const w = await seeded();
  const before = await w.h['project.getView']({ payload: {}, context: projectCtx() });
  assert.equal(before.ok, true, JSON.stringify(before.error));
  assert.equal(before.data.trace.readiness.pct, 92);
  assert.equal(before.data.configured, true);
  assert.equal(before.data.seed.status, 'done');
  assert.equal(before.data.info.changelogSource, 'bulk');

  const req7 = w.jira.byRef('REQ-7').key;
  w.jira.edit(req7, 'description', [REQ7_TEXT[0].replace('25 units', '20 units'), REQ7_TEXT[1]]);
  const after = await w.h['project.getView']({ payload: {}, context: projectCtx() });
  const t = after.data.trace;
  assert.deepEqual(t.readiness, { ready: 9, total: 12, pct: 75 });
  assert.equal(t.kpis.suspectLinks, 3);
  assert.equal(t.kpis.upstreamChanged, 1);
  const suspects = t.links.filter((l) => l.state === 'SUSPECT').map((l) => l.testKey).sort();
  assert.deepEqual(suspects, ['TEST-14', 'TEST-15', 'TEST-16'].map((r) => w.run.refToKey[r]).sort());
  const diff = t.links.find((l) => l.state === 'SUSPECT').change.fields[0].diff;
  assert.ok(diff.some((d) => d.op === 'del' && d.text === '25'));
  assert.ok(diff.some((d) => d.op === 'ins' && d.text === '20'));

  // Issue panel on REQ-7.
  const panel = await w.h['issue.getPanel']({ payload: {}, context: { accountId: 'user-1', extension: { issue: { key: req7 }, project: { key: 'PUMP' } } } });
  assert.equal(panel.ok, true, JSON.stringify(panel.error));
  assert.equal(panel.data.role, 'req');
  assert.equal(panel.data.itemState, 'SUSPECT');
  assert.equal(panel.data.links.filter((l) => l.state === 'SUSPECT').length, 3);

  // Bold-only re-save style change of REQ-1 (markup only): no new suspect.
  const req1 = w.jira.byRef('REQ-1');
  const p1 = SAMPLE_PLAN.issues.find((i) => i.ref === 'REQ-1').paragraphs;
  w.jira.edit(req1.key, 'description', [p1[0].replace('0.05 to', '*0.05* to'), p1[1]]);
  const after2 = await w.h['project.getView']({ payload: {}, context: projectCtx() });
  assert.equal(after2.data.trace.kpis.suspectLinks, 3);
  assert.equal(after2.data.trace.readiness.pct, 75);
});

test('B2 idempotent: runSeed again on the same runId makes zero create calls', async () => {
  const w = await seeded();
  const creates = () => w.jira.calls('POST', /^\/rest\/api\/3\/issue(\/bulk)?$/).length;
  const n = creates();
  assert.deepEqual(await runSeed(w.jobDeps, { runId: w.runId }), { status: 'done' });
  // Even if the record is forced back to running/create with refToKey intact.
  const run = await w.store.get(K.seedRun(w.runId));
  await w.store.set(K.seedRun(w.runId), { ...run, status: 'running', phase: 'create', actual: null });
  const r = await runSeed(w.jobDeps, { runId: w.runId });
  assert.equal(r.status, 'done');
  assert.equal(creates(), n);
  // A second "Load sample data" click returns the same run and queues nothing.
  const again = await w.h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(again.data.runId, w.runId);
  assert.equal(w.queue.pushed.length, 1);
});

test('B2 crash after bulk create (refToKey not saved): resume adopts the issues and creates none', async () => {
  const w = await seeded();
  const run = await w.store.get(K.seedRun(w.runId));
  const n = w.jira.calls('POST', /^\/rest\/api\/3\/issue(\/bulk)?$/).length;
  await w.store.set(K.seedRun(w.runId), {
    ...run, status: 'running', phase: 'create', refToKey: {}, refToId: {}, actual: null,
  });
  const r = await runSeed(w.jobDeps, { runId: w.runId });
  assert.equal(r.status, 'done');
  assert.equal(w.jira.calls('POST', /^\/rest\/api\/3\/issue(\/bulk)?$/).length, n);
  const after = await w.store.get(K.seedRun(w.runId));
  assert.equal(Object.keys(after.refToKey).length, 30);
  assert.deepEqual(after.refToKey, run.refToKey);
});

test('B3 two-hop workflow (To Do -> In Progress -> Done) works', async () => {
  const w = await seeded({ workflow: 'twoHop' });
  assert.equal(w.run.status, 'done');
  assert.equal(w.run.passedRefs.length, 13);
  assert.equal(w.run.actual.readinessPct, 92);
});

test('B3 workflow with no reachable Done: tests stay NOT RUN, warnings explain, actual differs', async () => {
  const w = await seeded({ workflow: 'noDone' });
  assert.equal(w.run.status, 'done');
  assert.equal(w.run.passedRefs.length, 0);
  assert.equal(w.run.notPassedRefs.length, 13);
  assert.notEqual(w.run.actual.readinessPct, 92);
  assert.equal(w.run.actual.readinessPct, 0);
  assert.ok(w.run.warnings.some((x) => /could not reach a Done status/.test(x) && /Task/.test(x)));
  assert.ok(w.run.warnings.some((x) => /^Readiness is 0%, expected 92%:/.test(x)));
});

test('B3 transition 400 on the first Done candidate: the next candidate is tried', async () => {
  const w = makeWorld();
  w.jira.override(({ method, path, body }) => (method === 'POST' && /\/transitions$/.test(path) && body?.transition?.id === '31'
    ? { ok: false, status: 400, json: { errorMessages: ['Resolution is required'] }, retryAfter: null } : undefined));
  const h = makeHandlers(w.deps);
  const s = await h['seed.start']({ payload: {}, context: projectCtx() });
  await drainQueue(w.queue, w.jobDeps);
  const run = await w.store.get(K.seedRun(s.data.runId));
  assert.equal(run.passedRefs.length, 13);
  assert.equal(run.actual.readinessPct, 92);
  assert.equal(w.jira.byRef('TEST-1').fields.status.name, 'Closed');
});

test('B4 429 on create returns a retry with retryAfter, then resumes and finishes', async () => {
  const w = makeWorld();
  let n = 0;
  w.jira.override(({ path }) => (path === '/rest/api/3/issue/bulk' && n++ === 0 ? { ok: false, status: 429, json: null, retryAfter: 7 } : undefined));
  const run = await startSeed({ jira: w.jira.asUser, store: w.store, queue: w.queue, now: w.now, uuid: w.uuid }, { projectKey: 'PUMP', actor: 'user-1' });
  const r1 = await runSeed(w.jobDeps, { runId: run.runId, retryCount: 0 });
  assert.deepEqual(r1, { retry: { retryAfter: 7 } });
  const r2 = await runSeed(w.jobDeps, { runId: run.runId, retryCount: 1 });
  assert.equal(r2.status, 'done');
  assert.equal((await w.store.get(K.seedRun(run.runId))).actual.readinessPct, 92);
});

test('B4 rate limit after 5 retries marks the run failed', async () => {
  const w = makeWorld();
  w.jira.override(({ path }) => (path === '/rest/api/3/issue/bulk' ? { ok: false, status: 429, json: null, retryAfter: null } : undefined));
  const run = await startSeed({ jira: w.jira.asUser, store: w.store, queue: w.queue, now: w.now, uuid: w.uuid }, { projectKey: 'PUMP', actor: 'u' });
  assert.deepEqual(await runSeed(w.jobDeps, { runId: run.runId, retryCount: 4 }), { retry: { retryAfter: 10 } });
  assert.deepEqual(await runSeed(w.jobDeps, { runId: run.runId, retryCount: 5 }), { status: 'failed' });
  const after = await w.store.get(K.seedRun(run.runId));
  assert.equal(after.error.code, 'RATE_LIMITED');
});

test('B4 403 on create as the app: failed with a JIRA_PERMISSION hint naming the app role', async () => {
  const w = makeWorld();
  w.jira.override(({ path, mode }) => (mode === 'app' && path === '/rest/api/3/issue/bulk' ? { ok: false, status: 403, json: { errorMessages: ['You do not have permission'] }, retryAfter: null } : undefined));
  const h = makeHandlers(w.deps);
  const s = await h['seed.start']({ payload: {}, context: projectCtx() });
  const [r] = await drainQueue(w.queue, w.jobDeps);
  assert.equal(r.status, 'failed');
  const run = await w.store.get(K.seedRun(s.data.runId));
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'JIRA_PERMISSION');
  assert.match(run.error.message, /403 for POST \/rest\/api\/3\/issue\/bulk as the app/);
  assert.match(run.error.hint, /atlassian-addons-project-access/);
  assert.match(run.error.hint, /Create issues/);
  const v = await verifyAudit(w.store, 'PUMP');
  assert.equal(v.ok, true);
});

test('B4 a required field blocks creation: failed with the field names', async () => {
  const w = await seeded({ requiredField: 'customfield_10050' });
  assert.equal(w.run.status, 'failed');
  assert.match(w.run.error.hint, /customfield_10050/);
  // Retry after fixing the field: resumes the same run id (no duplicate issues).
  w.jira.state.requiredField = null;
  const again = await w.h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(again.data.runId, w.runId);
  await drainQueue(w.queue, w.jobDeps, 1);
  const run = await w.store.get(K.seedRun(w.runId));
  assert.equal(run.status, 'done');
  assert.equal(run.actual.readinessPct, 92);
  assert.equal(w.jira.state.issues.size, 30);
});

test('seed.start: missing user permissions give FORBIDDEN listing them; nothing is queued', async () => {
  const w = makeWorld({ perms: { LINK_ISSUES: false, TRANSITION_ISSUES: false } });
  const h = makeHandlers(w.deps);
  const r = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.message, /Link issues, Transition issues/);
  assert.equal(w.queue.pushed.length, 0);
});

test('seed.status returns the run plus queue stats while unfinished', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const s = await h['seed.start']({ payload: {}, context: projectCtx() });
  const st = await h['seed.status']({ payload: { runId: s.data.runId }, context: projectCtx() });
  assert.equal(st.data.run.status, 'queued');
  assert.deepEqual(st.data.queue, { success: 0, inProgress: 1, failed: 0 });
  const other = await h['seed.status']({ payload: { runId: s.data.runId }, context: projectCtx('OTHER') });
  assert.equal(other.error.code, 'NOT_FOUND');
});

test('remove sample data: issues and re-verification tasks deleted, audit kept and intact', async () => {
  const w = await seeded();
  const req7 = w.jira.byRef('REQ-7').key;
  w.jira.edit(req7, 'description', [REQ7_TEXT[0].replace('25 units', '20 units'), REQ7_TEXT[1]]);
  const t14 = w.run.refToKey['TEST-14'];
  const task = await w.h['link.createReverifyTask']({ payload: { downKey: t14, upKey: req7 }, context: projectCtx() });
  assert.equal(task.ok, true, JSON.stringify(task.error));
  assert.equal(w.jira.state.issues.size, 31);
  const r = await w.h['seed.remove']({ payload: { runId: w.runId }, context: projectCtx() });
  assert.equal(r.data.status, 'removing');
  await drainQueue(w.queue, w.jobDeps, 1);
  assert.equal(w.jira.state.issues.size, 0);
  const run = await w.store.get(K.seedRun(w.runId));
  assert.equal(run.status, 'removed');
  assert.equal(await w.store.get(K.seedProj('PUMP')), undefined);
  const v = await verifyAudit(w.store, 'PUMP');
  assert.equal(v.ok, true);
  const list = await w.h['audit.list']({ payload: {}, context: projectCtx() });
  assert.equal(list.data.records[0].type, 'SEED_REMOVED');
  assert.equal(list.data.records[0].data.deleted, 31);
  // Baselines are kept and flagged as sample.
  const bl = await w.h['baseline.list']({ payload: {}, context: projectCtx() });
  assert.equal(bl.data.length, 1);
  assert.equal(bl.data[0].sample, true);
  // A new load after removal starts a new run.
  const again = await w.h['seed.start']({ payload: {}, context: projectCtx() });
  assert.notEqual(again.data.runId, w.runId);
});

test('remove: DELETE 403 as the app fails with the bulk-delete JQL hint', async () => {
  const w = await seeded();
  w.jira.override(({ method }) => (method === 'DELETE' ? { ok: false, status: 403, json: null, retryAfter: null } : undefined));
  await w.h['seed.remove']({ payload: { runId: w.runId }, context: projectCtx() });
  await drainQueue(w.queue, w.jobDeps, 1);
  const run = await w.store.get(K.seedRun(w.runId));
  assert.equal(run.status, 'failed');
  assert.match(run.error.hint, new RegExp(`labels = ${runLabel(w.runId)}`));
  // The user can retry removal.
  w.jira.clearOverrides();
  await w.h['seed.remove']({ payload: { runId: w.runId }, context: projectCtx() });
  await drainQueue(w.queue, w.jobDeps, 2);
  assert.equal((await w.store.get(K.seedRun(w.runId))).status, 'removed');
});

test('seed.remove without Delete issues: FORBIDDEN with the JQL fallback', async () => {
  const w = await seeded({ perms: { DELETE_ISSUES: false } });
  const r = await w.h['seed.remove']({ payload: { runId: w.runId }, context: projectCtx() });
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.hint, /labels = tb-run-/);
});

test('removeSeed and runSeed ignore unknown run ids', async () => {
  const w = makeWorld();
  assert.deepEqual(await runSeed(w.jobDeps, { runId: 'nope' }), { status: 'missing' });
  assert.deepEqual(await removeSeed(w.jobDeps, { runId: 'nope' }), { status: 'missing' });
});
