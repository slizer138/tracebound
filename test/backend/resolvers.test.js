// B8 every resolver returns {ok:false,error} (never throws) on Jira 401/403/404/429/500,
// plus config, baselines, health and admin handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, projectCtx, issueCtx, drainQueue } from './fakes.js';
import { seededWorld } from './seeded.js';
import { makeHandlers, RESOLVER_KEYS } from '../../src/backend/handlers.js';
import { K } from '../../src/backend/keys.js';

const PAYLOADS = {
  'project.getView': {},
  'project.saveConfig': { config: { roleMode: 'labels' } },
  'link.getImpact': { downKey: 'PUMP-2', upKey: 'PUMP-1' },
  'link.clear': { downKey: 'PUMP-2', upKey: 'PUMP-1', kind: 'link', fingerprint: 'x', reason: 'a long enough reason' },
  'link.createReverifyTask': { downKey: 'PUMP-2', upKey: 'PUMP-1' },
  'seed.status': { runId: 'r' },
  'seed.remove': { runId: 'r' },
  'baseline.freeze': { name: 'B1' },
  'baseline.get': { id: 'x' },
  'baseline.verify': { id: 'x' },
  'admin.health': { projectKey: 'PUMP' },
  'admin.seedStart': { projectKey: 'PUMP' },
  'admin.seedStatus': { projectKey: 'PUMP' },
  'admin.seedRemove': { projectKey: 'PUMP', runId: 'r' },
};

test('the resolver key list matches the contract (plus the three admin-page seed keys)', () => {
  assert.deepEqual([...RESOLVER_KEYS].sort(), [
    'admin.health', 'admin.listProjects', 'admin.seedRemove', 'admin.seedStart', 'admin.seedStatus', 'audit.list', 'audit.verify', 'baseline.freeze', 'baseline.get',
    'baseline.list', 'baseline.verify', 'issue.getPanel', 'link.clear', 'link.createReverifyTask', 'link.getImpact',
    'project.getConfig', 'project.getView', 'project.issueTypes', 'project.saveConfig', 'project.useDefaults', 'seed.remove', 'seed.start', 'seed.status',
  ]);
});

for (const status of [401, 403, 404, 429, 500]) {
  test(`B8 every resolver returns a result and never throws on Jira ${status}`, async () => {
    const w = makeWorld();
    w.jira.addIssue({ summary: 'R', labels: ['trace-req'] });
    w.jira.addIssue({ summary: 'T', labels: ['trace-test'] });
    w.jira.override(() => ({ ok: false, status, json: { errorMessages: [`fake ${status}`] }, retryAfter: status === 429 ? 1 : null }));
    const h = makeHandlers(w.deps);
    for (const key of RESOLVER_KEYS) {
      const ctx = key === 'issue.getPanel' ? issueCtx('PUMP-1') : projectCtx();
      let r;
      await assert.doesNotReject(async () => { r = await h[key]({ payload: PAYLOADS[key] ?? {}, context: ctx }); }, key);
      assert.equal(typeof r.ok, 'boolean', key);
      if (!r.ok) {
        assert.equal(typeof r.error.code, 'string', key);
        assert.equal(typeof r.error.message, 'string', key);
      }
    }
    const view = await h['project.getView']({ payload: {}, context: projectCtx() });
    const want = { 401: 'JIRA_PERMISSION', 403: 'JIRA_PERMISSION', 404: 'NOT_FOUND', 429: 'RATE_LIMITED', 500: 'JIRA_ERROR' }[status];
    assert.equal(view.error.code, want);
    assert.ok(view.error.hint, 'every Jira error carries a next step');
  });
}

test('handlers never throw on an unexpected exception either', async () => {
  const w = makeWorld();
  w.deps.store.get = async () => { throw new TypeError('boom'); };
  const h = makeHandlers(w.deps);
  const r = await h['audit.list']({ payload: {}, context: projectCtx() });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INTERNAL');
});

test('projectKey comes from the context, never from the payload', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const r = await h['project.getView']({ payload: { projectKey: 'EVIL' }, context: projectCtx('PUMP') });
  assert.equal(r.data.projectKey, 'PUMP');
  const search = w.jira.calls('POST', /search\/jql/)[0];
  assert.match(search.body.jql, /^project = "PUMP"/);
  const none = await h['project.getView']({ payload: { projectKey: 'PUMP' }, context: {} });
  assert.equal(none.error.code, 'VALIDATION');
});

test('NOT_CONFIGURED project: getView reports configured false with defaults and an empty trace', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const r = await h['project.getView']({ payload: {}, context: projectCtx() });
  assert.equal(r.ok, true);
  assert.equal(r.data.configured, false);
  assert.equal(r.data.trace.readiness.pct, null);
  assert.equal(r.data.seed, null);
  const d = await h['project.useDefaults']({ payload: {}, context: projectCtx() });
  assert.equal(d.data.configured, true);
  const r2 = await h['project.getView']({ payload: {}, context: projectCtx() });
  assert.equal(r2.data.configured, true);
});

test('saveConfig needs Administer projects, validates, and is audited', async () => {
  const w = makeWorld({ perms: { ADMINISTER_PROJECTS: false } });
  const h = makeHandlers(w.deps);
  const denied = await h['project.saveConfig']({ payload: { config: {} }, context: projectCtx() });
  assert.equal(denied.error.code, 'FORBIDDEN');
  assert.equal((await h['project.getConfig']({ payload: {}, context: projectCtx() })).data.canAdmin, false);
  w.jira.state.perms.ADMINISTER_PROJECTS = true;
  const bad = await h['project.saveConfig']({ payload: { config: { labels: { req: 'two words' } } }, context: projectCtx() });
  assert.equal(bad.error.code, 'CONFIG_INVALID');
  const ok = await h['project.saveConfig']({ payload: { config: { substantiveFieldIds: ['customfield_10100'] } }, context: projectCtx() });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.config.substantiveFieldIds, ['summary', 'description', 'customfield_10100']);
  const audit = await h['audit.list']({ payload: {}, context: projectCtx() });
  assert.equal(audit.data.records[0].type, 'CONFIG_SAVED');
});

test('baselines: freeze, list, get, verify; tampering with a chunk is detected', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const f = await w.call('baseline.freeze', { name: 'Release 2.1' });
  assert.equal(f.ok, true, JSON.stringify(f.error));
  assert.equal(f.data.readinessPct, 75);
  assert.match(f.data.hash, /^[0-9a-f]{64}$/);
  const list = await w.call('baseline.list');
  assert.deepEqual(list.data.map((b) => b.name), ['Release 2.1', 'Release 2.0 (sample)']);
  const v = await w.call('baseline.verify', { id: f.data.id });
  assert.equal(v.data.ok, true);
  assert.equal(v.data.auditMatches, true);
  const g = await w.call('baseline.get', { id: f.data.id });
  assert.equal(g.data.payload.items.find((i) => i.key === w.key('REQ-7')).state, 'SUSPECT');
  assert.match(g.data.payload.items[0].textHash, /^[0-9a-f]{64}$/);
  const chunkKey = K.baselineChunk('PUMP', f.data.id, 0);
  w.store.map.set(chunkKey, w.store.map.get(chunkKey).replace('"SUSPECT"', '"READY"'));
  const bad = await w.call('baseline.verify', { id: f.data.id });
  assert.equal(bad.data.ok, false);
  assert.equal(bad.data.problem, 'HASH_MISMATCH');
  const nameless = await w.call('baseline.freeze', { name: '' });
  assert.equal(nameless.error.code, 'VALIDATION');
});

test('release filter and onlyGaps flow through getView', async () => {
  const w = await seededWorld();
  for (const ref of ['REQ-1', 'REQ-2', 'REQ-9']) w.jira.issue(w.key(ref)).fields.fixVersions = [{ name: 'R2' }];
  const all = await w.call('project.getView');
  assert.deepEqual(all.data.releases, ['R2']);
  const r2 = await w.call('project.getView', { release: 'R2' });
  assert.deepEqual(r2.data.trace.readiness, { ready: 2, total: 3, pct: 67 });
  const gaps = await w.call('project.getView', { onlyGaps: true });
  assert.deepEqual(gaps.data.trace.items.map((i) => i.key), [w.key('REQ-9')]);
  assert.equal(gaps.data.trace.readiness.pct, 92);
});

test('issue panel: test, risk, no-role issue', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const t = await w.h['issue.getPanel']({ payload: {}, context: issueCtx(w.key('TEST-14')) });
  assert.equal(t.data.role, 'test');
  assert.deepEqual(t.data.links.map((l) => [l.itemKey, l.state]), [[w.key('REQ-7'), 'SUSPECT']]);
  const risk = await w.h['issue.getPanel']({ payload: {}, context: issueCtx(w.key('RSK-3')) });
  assert.equal(risk.data.role, 'risk');
  assert.equal(risk.data.ripple.derivedControls[0].ctrlKey, w.key('CTRL-2'));
  const ctrl = await w.h['issue.getPanel']({ payload: {}, context: issueCtx(w.key('CTRL-2')) });
  assert.equal(ctrl.data.upstream[0].state, 'UPSTREAM_CHANGED');
  const plain = w.jira.addIssue({ summary: 'No role' });
  const none = await w.h['issue.getPanel']({ payload: {}, context: issueCtx(plain.key) });
  assert.equal(none.data.role, null);
});

test('admin.health: all pass on a seeded site; createmeta 403 as the app names the app role', async () => {
  const w = await seededWorld();
  const r = await w.call('admin.health', { projectKey: 'pump' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const byId = Object.fromEntries(r.data.checks.map((c) => [c.id, c]));
  for (const id of ['storage', 'jira-app-read', 'jira-user-read', 'config', 'trace-issues', 'changelog', 'user-perms', 'app-write']) {
    assert.equal(byId[id].status, 'pass', `${id}: ${byId[id].detail}`);
  }
  w.jira.override(({ mode, path }) => (mode === 'app' && /createmeta/.test(path) ? { ok: false, status: 403, json: null, retryAfter: null } : undefined));
  w.jira.state.bulkfetch = false;
  const r2 = await w.call('admin.health', { projectKey: 'PUMP' });
  const c2 = Object.fromEntries(r2.data.checks.map((c) => [c.id, c]));
  assert.equal(c2['app-write'].status, 'fail');
  assert.match(c2['app-write'].detail, /Jira returned 403 for createmeta as the app, so the app cannot create issues in PUMP\./);
  // The next step names the app role for company-managed projects AND the team-managed path.
  assert.match(c2['app-write'].nextStep, /atlassian-addons-project-access/);
  assert.match(c2['app-write'].nextStep, /Team-managed project/);
  assert.equal(c2.changelog.status, 'warn');
  const noProject = await w.call('admin.health', {});
  assert.equal(noProject.data.checks.find((c) => c.id === 'project').status, 'info');
  const badKey = await w.call('admin.health', { projectKey: 'not a key' });
  assert.equal(badKey.error.code, 'VALIDATION');
});

test('admin page seeding: typed project key, permission-checked, same idempotent run, remove and poll by runId', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const adminCtx = { accountId: 'user-1', extension: {} };
  const bad = await h['admin.seedStart']({ payload: { projectKey: 'not a key' }, context: adminCtx });
  assert.equal(bad.error.code, 'VALIDATION');
  const none = await h['admin.seedStatus']({ payload: { projectKey: 'PUMP' }, context: adminCtx });
  assert.deepEqual(none.data, { run: null, queue: null });
  const s1 = await h['admin.seedStart']({ payload: { projectKey: 'pump' }, context: adminCtx });
  assert.equal(s1.ok, true, JSON.stringify(s1.error));
  assert.equal(s1.data.projectKey, 'PUMP');
  const s2 = await h['admin.seedStart']({ payload: { projectKey: 'PUMP' }, context: adminCtx });
  assert.equal(s2.data.runId, s1.data.runId, 'a second click returns the same run');
  const polling = await h['admin.seedStatus']({ payload: { projectKey: 'PUMP' }, context: adminCtx });
  assert.equal(polling.data.run.status, 'queued');
  assert.deepEqual(polling.data.queue, { success: 0, inProgress: 1, failed: 0 });
  await drainQueue(w.queue, w.jobDeps);
  const done = await h['admin.seedStatus']({ payload: { projectKey: 'PUMP' }, context: adminCtx });
  assert.equal(done.data.run.status, 'done');
  assert.equal(done.data.run.actual.readinessPct, 92);
  const rm = await h['admin.seedRemove']({ payload: { projectKey: 'PUMP', runId: s1.data.runId }, context: adminCtx });
  assert.equal(rm.data.status, 'removing');
  await drainQueue(w.queue, w.jobDeps, 1);
  const after = await h['admin.seedStatus']({ payload: { projectKey: 'PUMP', runId: s1.data.runId }, context: adminCtx });
  assert.equal(after.data.run.status, 'removed');
  const other = await h['admin.seedStatus']({ payload: { projectKey: 'OTHER', runId: s1.data.runId }, context: adminCtx });
  assert.equal(other.error.code, 'NOT_FOUND', 'a run id from another project is refused');
});

test('admin page seeding is refused without Browse projects on the typed project', async () => {
  const w = makeWorld({ perms: { BROWSE_PROJECTS: false } });
  const h = makeHandlers(w.deps);
  const r = await h['admin.seedStatus']({ payload: { projectKey: 'PUMP' }, context: {} });
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.message, /Browse projects/);
});

test('admin.listProjects lists configured projects with their sample run', async () => {
  const w = await seededWorld();
  const r = await w.call('admin.listProjects');
  assert.deepEqual(r.data, [{ projectKey: 'PUMP', roleMode: 'labels', updatedAt: r.data[0].updatedAt, seed: { status: 'done', actual: 92 } }]);
});
