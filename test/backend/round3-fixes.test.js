// Regression tests for review round 3 (backend side): the consent error reaches the platform,
// numeric bulkfetch times, items without text keys, bulkfetch fallback rules shared with health,
// audit head check, admin permission checks, app-access hints, KVS page size and the
// project.issueTypes resolver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '@forge/api';
import { makeWorld, makeFakeJira, makeFakeStore, projectCtx, T0 } from './fakes.js';
import { seededWorld } from './seeded.js';
import { makeHandlers } from '../../src/backend/handlers.js';
import { makeActions } from '../../src/backend/actions.js';
import { makeJira } from '../../src/backend/jiraClient.js';
import { toResult, toErrorResult, expectOk, isNeedsAuth } from '../../src/backend/errors.js';
import { loadProjectSnapshot, bulkFallsBack, cleanItem, cleanCreated } from '../../src/backend/loader.js';
import { appendAudit, verifyAudit } from '../../src/backend/audit.js';
import { K, queryAll, QUERY_PAGE } from '../../src/backend/keys.js';
import { pickIssueType } from '../../src/backend/jiraOps.js';
import { DEFAULT_CONFIG, normalizeConfig, computeTrace, tryParseJiraTime } from '../../src/engine/index.js';

const cfg = normalizeConfig(DEFAULT_CONFIG).config;
const consentError = () => Object.assign(new Error('Authentication Required'), { name: 'NEEDS_AUTHENTICATION_ERR', status: 401 });

/** A jira client whose every call throws the platform consent error. */
const consentJira = (mode = 'user') => {
  const fail = async () => { throw consentError(); };
  return { mode, get: fail, post: fail, put: fail, del: fail };
};

// ---------------------------------------------------------------- consent error (blocker 1)

test('jiraClient rethrows NEEDS_AUTHENTICATION_ERR and still maps other thrown errors to status 0', async () => {
  const realAsUser = api.asUser;
  try {
    api.asUser = () => ({ requestJira: async () => { throw consentError(); } });
    await assert.rejects(makeJira('user').get('/rest/api/3/myself'), { name: 'NEEDS_AUTHENTICATION_ERR' });
    api.asUser = () => ({ requestJira: async () => { throw new Error('socket hang up'); } });
    const r = await makeJira('user').get('/rest/api/3/myself');
    assert.deepEqual({ ok: r.ok, status: r.status, message: r.json.message }, { ok: false, status: 0, message: 'socket hang up' });
    api.asUser = () => ({ requestJira: async () => ({ ok: true, status: 200, text: async () => '{"a":1}', headers: { get: () => null } }) });
    assert.deepEqual((await makeJira('user').get('/x')).json, { a: 1 });
  } finally {
    api.asUser = realAsUser;
  }
});

test('toResult and toErrorResult rethrow only the consent error', async () => {
  assert.equal(isNeedsAuth(consentError()), true);
  assert.equal(isNeedsAuth(new Error('x')), false);
  assert.equal(isNeedsAuth(null), false);
  await assert.rejects(toResult(async () => { throw consentError(); }), { name: 'NEEDS_AUTHENTICATION_ERR' });
  assert.throws(() => toErrorResult(consentError()), { name: 'NEEDS_AUTHENTICATION_ERR' });
  assert.equal((await toResult(async () => { throw new Error('boom'); })).error.code, 'INTERNAL');
});

test('resolvers let the consent error through so the "Allow access" prompt can appear', async () => {
  const w = makeWorld();
  const h = makeHandlers({ ...w.deps, jiraUser: consentJira() });
  for (const key of ['project.getView', 'project.getConfig', 'link.getImpact', 'baseline.freeze', 'project.issueTypes']) {
    const payload = key === 'link.getImpact' ? { downKey: 'PUMP-2', upKey: 'PUMP-1' } : { name: 'B' };
    await assert.rejects(h[key]({ payload, context: projectCtx() }), { name: 'NEEDS_AUTHENTICATION_ERR' }, key);
  }
  // Health's "Jira read as you" check also lets it through instead of reporting a failure.
  await assert.rejects(h['admin.health']({ payload: {}, context: projectCtx() }), { name: 'NEEDS_AUTHENTICATION_ERR' });
  // listProjects checks each configured project as the user; its per-row catch must not swallow it.
  await w.store.set(K.config('PUMP'), { schema: 1, ...cfg });
  await assert.rejects(h['admin.listProjects']({ payload: {}, context: projectCtx() }), { name: 'NEEDS_AUTHENTICATION_ERR' });
});

test('Rovo actions let the consent error through too', async () => {
  const w = makeWorld();
  const a = makeActions({ ...w.deps, jiraUser: consentJira() });
  await assert.rejects(a.getReadiness({ projectKey: 'PUMP' }, {}), { name: 'NEEDS_AUTHENTICATION_ERR' });
  await assert.rejects(a.getChangeImpact({ issueKey: 'PUMP-1' }, {}), { name: 'NEEDS_AUTHENTICATION_ERR' });
  // Other errors are still returned as JSON, never thrown.
  const bad = JSON.parse(await a.getReadiness({}, {}));
  assert.equal(bad.error.code, 'VALIDATION');
});

// ------------------------------------------------- numeric bulkfetch created (blocker 2)

/** Wraps a fake client so bulkfetch histories carry a numeric "created". */
function numericBulk(client, toNumber) {
  return {
    ...client,
    post: async (path, body) => {
      const r = await client.post(path, body);
      if (path !== '/rest/api/3/changelog/bulkfetch' || !r.ok) return r;
      const json = JSON.parse(JSON.stringify(r.json));
      for (const log of json.issueChangeLogs) for (const h of log.changeHistories) h.created = toNumber(tryParseJiraTime(h.created));
      return { ...r, json };
    },
  };
}

for (const [name, toNumber] of [['milliseconds', (ms) => ms], ['seconds', (ms) => Math.floor(ms / 1000)]]) {
  test(`bulkfetch "created" as epoch ${name}: the demo edit still gives 75% and 3 suspects`, async () => {
    const w = await seededWorld();
    w.demoEdit();
    const h = makeHandlers({ ...w.deps, jiraUser: numericBulk(w.jira.asUser, toNumber) });
    const r = await h['project.getView']({ payload: {}, context: projectCtx() });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.info.changelogSource, 'bulk');
    assert.equal(r.data.trace.readiness.pct, 75);
    assert.equal(r.data.trace.links.filter((l) => l.state === 'SUSPECT').length, 3);
  });
}

test('loader stores history times as Jira time strings whatever form bulkfetch used', async () => {
  assert.equal(cleanCreated(1492070429), '2017-04-13T08:00:29.000+0000');
  assert.equal(cleanCreated(1795601730123), '2026-11-25T10:15:30.123+0000');
  assert.equal(cleanCreated('2026-11-25T10:15:30.123+0000'), '2026-11-25T10:15:30.123+0000');
  const jira = makeFakeJira();
  const req = jira.addIssue({ summary: 'R', labels: ['trace-req'] });
  jira.edit(req.key, 'summary', 'R', 'R2');
  const user = numericBulk(jira.asUser, (ms) => Math.floor(ms / 1000));
  const { snapshot } = await loadProjectSnapshot(user, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 });
  const h = snapshot.changelogs[req.id][0];
  assert.equal(typeof h.created, 'string');
  assert.match(h.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$/);
});

// ------------------------------------------- items without own text keys (major 3)

test('loader copies changelog items with own values only (no inherited toString)', async () => {
  const item = cleanItem({ field: 'description', fieldId: 'description', from: 'x', to: 'y' });
  assert.deepEqual(item, { field: 'description', fieldId: 'description', from: 'x', fromString: null, to: 'y', toString: null });
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'toString'), true);
  assert.equal(cleanItem({ fieldId: 'summary', fromString: 5, toString: 'a' }).fromString, null);

  const jira = makeFakeJira();
  const req = jira.addIssue({ summary: 'R', labels: ['trace-req'] });
  const t = jira.addIssue({ summary: 'T', labels: ['trace-test'] });
  jira.linkIssues('Relates', t.key, req.key);
  jira.transition(t.key, 3);
  jira.tick();
  jira.issue(req.key).changelog.push({ id: '99999', created: '2026-12-01T10:00:00.000+0000', author: { accountId: 'u' }, items: [{ field: 'description', fieldId: 'description', from: 'x', to: 'y' }] });
  const { snapshot } = await loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 });
  const tr = computeTrace(snapshot, cfg, []);
  const l = tr.links.find((x) => x.itemKey === req.key);
  assert.equal(l.state, 'SUSPECT');
  assert.doesNotMatch(JSON.stringify(l.change), /native code/);
});

// ------------------------------------------------ bulkfetch fallback rule (major 5)

test('bulkFallsBack: every client error falls back; 429, 5xx and no response do not', () => {
  for (const s of [400, 401, 403, 404, 405, 409, 410, 422]) assert.equal(bulkFallsBack({ ok: false, status: s }), true, String(s));
  for (const s of [0, 429, 500, 502, 503]) assert.equal(bulkFallsBack({ ok: false, status: s }), false, String(s));
  assert.equal(bulkFallsBack({ ok: true, status: 200 }), false);
});

const bulkStatus = (jira, status) => jira.override(({ path }) => (path === '/rest/api/3/changelog/bulkfetch'
  ? { ok: false, status, json: { errorMessages: [`bulk ${status}`] }, retryAfter: status === 429 ? 1 : null } : undefined));

function smallProject() {
  const jira = makeFakeJira();
  for (let i = 0; i < 4; i++) jira.addIssue({ summary: `I${i}`, labels: [i % 2 ? 'trace-test' : 'trace-req'] });
  for (const issue of jira.state.issues.values()) jira.transition(issue.key, 3);
  return jira;
}

for (const status of [400, 401]) {
  test(`loader: bulkfetch ${status} falls back to the per-issue changelog`, async () => {
    const jira = smallProject();
    bulkStatus(jira, status);
    const { snapshot, info } = await loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 });
    assert.equal(info.changelogSource, 'per-issue');
    assert.equal(Object.values(snapshot.changelogs).flat().length, 4);
  });
}

test('loader: bulkfetch 503 and 429 are reported, not bypassed', async () => {
  const a = smallProject();
  bulkStatus(a, 503);
  await assert.rejects(loadProjectSnapshot(a.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 }), { code: 'JIRA_ERROR' });
  const b = smallProject();
  bulkStatus(b, 429);
  await assert.rejects(loadProjectSnapshot(b.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 }), { code: 'RATE_LIMITED' });
});

test('health uses the loader rule for bulkfetch and checks the change times', async () => {
  const health = async (w, client = w.jira.asUser) => {
    const h = makeHandlers({ ...w.deps, jiraUser: client });
    const r = await h['admin.health']({ payload: { projectKey: 'PUMP' }, context: projectCtx() });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.data.checks.find((c) => c.id === 'changelog');
  };
  const w = await seededWorld();
  // Give the first trace issue (the one health probes) a change history.
  const first = [...w.jira.state.issues.values()].sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]))[0];
  w.jira.edit(first.key, 'summary', first.fields.summary, `${first.fields.summary} (edited)`);
  const ok = await health(w);
  assert.equal(ok.status, 'pass');
  assert.match(ok.detail, /change times are readable \(timestamps\)/);
  assert.match((await health(w, numericBulk(w.jira.asUser, (ms) => Math.floor(ms / 1000)))).detail, /epoch numbers/);
  // An unreadable time is a warning, not a pass.
  const garbled = { ...w.jira.asUser, post: async (p, b) => {
    const r = await w.jira.asUser.post(p, b);
    if (p === '/rest/api/3/changelog/bulkfetch') r.json.issueChangeLogs[0].changeHistories[0].created = 'yesterday';
    return r;
  } };
  const bad = await health(w, garbled);
  assert.equal(bad.status, 'warn');
  assert.match(bad.detail, /unknown format.*"yesterday"/);
  bulkStatus(w.jira, 400);
  const fb = await health(w);
  assert.equal(fb.status, 'warn');
  assert.match(fb.detail, /returned 400; Tracebound reads change history per issue/);
  w.jira.clearOverrides();
  bulkStatus(w.jira, 503);
  const tmp = await health(w);
  assert.equal(tmp.status, 'warn');
  assert.match(tmp.detail, /returned 503\. This is usually temporary/);
  assert.match(tmp.nextStep, /again in a minute/);
});

// ------------------------------------------------------------ audit head (minor 6)

test('audit verify detects a rewritten newest record with a recomputed hash', async () => {
  const { makeAuditRecord } = await import('../../src/engine/index.js');
  const store = makeFakeStore();
  const body = (i) => ({ type: 'LINK_CLEARED', actor: 'u', subject: { downKey: `P-${i}`, upKey: 'P-1' }, data: { reason: `reason number ${i}` } });
  for (let i = 1; i <= 3; i++) await appendAudit(store, 'P', body(i), '2026-12-01T10:00:00.000Z');
  assert.equal((await verifyAudit(store, 'P')).ok, true);
  const r2 = await store.get(K.audit('P', 2));
  const forged = makeAuditRecord(r2, { ...body(3), data: { reason: 'a different reason' }, projectKey: 'P' }, '2026-12-01T10:00:00.000Z');
  assert.equal(forged.seq, 3);
  store.map.set(K.audit('P', 3), forged);
  const v = await verifyAudit(store, 'P');
  assert.deepEqual({ ok: v.ok, problem: v.problem, firstBadSeq: v.firstBadSeq }, { ok: false, problem: 'HASH_MISMATCH', firstBadSeq: 3 });
});

// ---------------------------------------------------- admin permissions (minor 12)

test('admin.health checks Browse projects for a typed project; listProjects hides projects you cannot browse', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  await w.store.set(K.config('PUMP'), { schema: 1, ...cfg });
  await w.store.set(K.config('OTHER'), { schema: 1, ...cfg });
  await w.store.set(K.config('GONE'), { schema: 1, ...cfg });
  w.jira.override(({ path, query }) => {
    if (path !== '/rest/api/3/mypermissions') return undefined;
    if (query.projectKey === 'OTHER') return { ok: true, status: 200, json: { permissions: { BROWSE_PROJECTS: { havePermission: false } } }, retryAfter: null };
    if (query.projectKey === 'GONE') return { ok: false, status: 404, json: { errorMessages: ['No project'] }, retryAfter: null };
    return undefined;
  });
  const list = await h['admin.listProjects']({ payload: {}, context: {} });
  assert.deepEqual(list.data.map((p) => p.projectKey), ['PUMP']);
  const denied = await h['admin.health']({ payload: { projectKey: 'OTHER' }, context: {} });
  assert.equal(denied.error.code, 'FORBIDDEN');
  // No probe ran as the app for the denied project.
  assert.equal(w.jira.calls('GET', /createmeta\/OTHER/).length, 0);
  const allowed = await h['admin.health']({ payload: { projectKey: 'PUMP' }, context: {} });
  assert.equal(allowed.ok, true);
  const global = await h['admin.health']({ payload: {}, context: {} });
  assert.equal(global.ok, true);
});

// ------------------------------------------------------ app-access hints (minor 13)

test('a 401/403 as the app gives company-managed AND team-managed advice', async () => {
  try {
    expectOk({ ok: false, status: 403, json: null }, { endpoint: 'POST /rest/api/3/issue', permission: 'Create issues', as: 'app', projectKey: 'PUMP' });
    assert.fail('expected a throw');
  } catch (e) {
    assert.equal(e.code, 'JIRA_PERMISSION');
    assert.match(e.hint, /Create issues in project PUMP/);
    assert.match(e.hint, /atlassian-addons-project-access/);
    assert.match(e.hint, /Team-managed project/);
    assert.match(e.hint, /read:jira-work and write:jira-work/);
  }
  const jira = makeFakeJira();
  jira.state.issueTypes = [];
  await assert.rejects(pickIssueType(jira.asApp, 'PUMP'), (e) => /Team-managed project/.test(e.hint));
  await assert.rejects(pickIssueType(jira.asUser, 'PUMP'), (e) => /your "Create issues" permission/.test(e.hint));
});

test('the seeder reports team-managed advice when the app cannot create issues', async () => {
  const w = makeWorld();
  w.jira.state.appCannotCreate = true;
  const h = makeHandlers(w.deps);
  const start = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(start.ok, true);
  const { drainQueue } = await import('./fakes.js');
  await drainQueue(w.queue, w.jobDeps);
  const run = await w.store.get(K.seedRun(start.data.runId));
  assert.equal(run.status, 'failed');
  assert.match(run.error.hint, /Team-managed project/);
});

// ------------------------------------------------------------- KVS paging (minor 11)

test('queryAll reads in pages of 20 and follows cursors', async () => {
  assert.equal(QUERY_PAGE, 20);
  const store = makeFakeStore();
  for (let i = 0; i < 45; i++) await store.set(`clr:P:link:P-${i}:P-1`, { i });
  const limits = [];
  const spy = { queryPrefix: (prefix, o) => { limits.push(o.limit); return store.queryPrefix(prefix, o); } };
  const rows = await queryAll(spy, 'clr:P:');
  assert.equal(rows.length, 45);
  assert.deepEqual(limits, [20, 20, 20]);
});

// ------------------------------------------------------ project.issueTypes (minor 16)

test('project.issueTypes lists the issue types you can create in the context project', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const r = await h['project.issueTypes']({ payload: { projectKey: 'EVIL' }, context: projectCtx('PUMP') });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { projectKey: 'PUMP', names: ['Epic', 'Sub-task', 'Task'] });
  assert.equal(w.jira.calls('GET', /createmeta\/PUMP/)[0].mode, 'user');
  const none = await h['project.issueTypes']({ payload: {}, context: {} });
  assert.equal(none.error.code, 'VALIDATION');
});
