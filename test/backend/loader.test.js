// B1: search pagination, bulkfetch pagination, per-issue fallback, truncation, permission errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeJira, makeFakeStore, T0 } from './fakes.js';
import { loadProjectSnapshot, loadNeighbourhood, traceJql, PER_ISSUE_CAP } from '../../src/backend/loader.js';
import { getStatusCats } from '../../src/backend/statusCache.js';
import { withRateLimitRetry } from '../../src/backend/retry.js';
import { DEFAULT_CONFIG, normalizeConfig, computeTrace } from '../../src/engine/index.js';

const cfg = normalizeConfig(DEFAULT_CONFIG).config;

function project(n, opts = {}) {
  const jira = makeFakeJira(opts);
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'trace-req' : 'trace-test';
    jira.addIssue({ summary: `Issue ${i}`, labels: [role] });
  }
  // Every issue gets two status histories.
  for (const issue of jira.state.issues.values()) {
    jira.transition(issue.key, 2);
    jira.transition(issue.key, 3);
  }
  return jira;
}

test('traceJql quotes values and covers both role modes', () => {
  assert.equal(traceJql('PUMP', cfg), 'project = "PUMP" AND labels in ("trace-req", "trace-risk", "trace-ctrl", "trace-test") ORDER BY key ASC');
  const it = normalizeConfig({ roleMode: 'issueTypes', issueTypes: { req: 'Requirement', test: 'Test "case"' } }).config;
  assert.equal(traceJql('PUMP', it), 'project = "PUMP" AND issuetype in ("Requirement", "Test \\"case\\"") ORDER BY key ASC');
});

test('B1 search paging over 3 pages with nextPageToken, then bulkfetch paging', async () => {
  const jira = project(30, { searchPageSize: 10, bulkPageSize: 25 });
  const store = makeFakeStore();
  const { snapshot, info } = await loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store, nowMs: T0 });
  assert.equal(snapshot.issues.length, 30);
  const searches = jira.calls('POST', /search\/jql/);
  assert.equal(searches.length, 3);
  assert.equal(searches[0].body.nextPageToken, undefined);
  assert.equal(searches[1].body.nextPageToken, '10');
  assert.equal(searches[2].body.nextPageToken, '20');
  assert.equal(searches[0].body.maxResults, 100);
  assert.deepEqual(searches[0].body.fields, ['summary', 'status', 'labels', 'issuetype', 'issuelinks', 'fixVersions', 'created', 'statuscategorychangedate', 'assignee']);
  const bulks = jira.calls('POST', /changelog\/bulkfetch/);
  assert.equal(bulks.length, 3); // 60 histories, 25 per page
  assert.deepEqual(bulks[0].body.fieldIds, ['status', 'summary', 'description']);
  assert.equal(info.changelogSource, 'bulk');
  assert.equal(info.truncated, false);
  const total = Object.values(snapshot.changelogs).reduce((n, l) => n + l.length, 0);
  assert.equal(total, 60);
  assert.equal(snapshot.statusCatById['3'], 'done');
});

test('B1 bulkfetch 404 switches to the per-issue changelog and reports it', async () => {
  const jira = project(12, { bulkfetch: false });
  const { snapshot, info } = await loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 });
  assert.equal(info.changelogSource, 'per-issue');
  assert.equal(jira.calls('GET', /\/changelog$/).length, 12);
  assert.equal(Object.values(snapshot.changelogs).reduce((n, l) => n + l.length, 0), 24);
  const trace = computeTrace(snapshot, cfg, []);
  assert.equal(trace.items.length, 6);
});

test('B1 per-issue fallback is capped and warns', async () => {
  const jira = project(PER_ISSUE_CAP + 10, { bulkfetch: false });
  const { info } = await loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 });
  assert.equal(jira.calls('GET', /\/changelog$/).length, PER_ISSUE_CAP);
  assert.match(info.warnings[0], /first 150 issues only; 10 issues/);
});

test('B1 more than 500 trace issues: truncated at 500', async () => {
  const jira = makeFakeJira();
  for (let i = 0; i < 520; i++) jira.addIssue({ summary: `R${i}`, labels: ['trace-req'] });
  const { snapshot, info } = await loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 });
  assert.equal(snapshot.issues.length, 500);
  assert.equal(info.truncated, true);
  assert.match(info.warnings.join(' '), /first 500 trace issues/);
  assert.equal(jira.calls('POST', /search\/jql/).length, 5);
});

test('B1 a 403 on search names the endpoint, the caller and the permission', async () => {
  const jira = project(2);
  jira.override(({ path }) => (path === '/rest/api/3/search/jql' ? { ok: false, status: 403, json: { errorMessages: ['nope'] }, retryAfter: null } : undefined));
  await assert.rejects(loadProjectSnapshot(jira.asUser, 'PUMP', cfg, { store: makeFakeStore(), nowMs: T0 }), (e) => {
    assert.equal(e.code, 'JIRA_PERMISSION');
    assert.match(e.message, /403 for POST \/rest\/api\/3\/search\/jql as you\. Jira said: nope/);
    assert.match(e.hint, /Browse projects/);
    assert.match(e.hint, /PUMP/);
    return true;
  });
});

test('status categories are cached for 10 minutes', async () => {
  const jira = makeFakeJira();
  const store = makeFakeStore();
  await getStatusCats(jira.asUser, store, T0);
  await getStatusCats(jira.asUser, store, T0 + 9 * 60000);
  assert.equal(jira.calls('GET', /\/status$/).length, 1);
  await getStatusCats(jira.asUser, store, T0 + 11 * 60000);
  assert.equal(jira.calls('GET', /\/status$/).length, 2);
});

test('loadNeighbourhood loads the issue, its links and the links of neighbouring controls', async () => {
  const jira = makeFakeJira();
  const req = jira.addIssue({ summary: 'R', labels: ['trace-req'] });
  const t1 = jira.addIssue({ summary: 'T1', labels: ['trace-test'] });
  const ctrl = jira.addIssue({ summary: 'C', labels: ['trace-ctrl'] });
  const t2 = jira.addIssue({ summary: 'T2', labels: ['trace-test'] });
  const risk = jira.addIssue({ summary: 'K', labels: ['trace-risk'] });
  const far = jira.addIssue({ summary: 'far', labels: ['trace-req'] });
  jira.linkIssues('Relates', t1.key, req.key);
  jira.linkIssues('Relates', ctrl.key, req.key);
  jira.linkIssues('Relates', t2.key, ctrl.key);
  jira.linkIssues('Relates', ctrl.key, risk.key);
  jira.linkIssues('Relates', t2.key, far.key);
  const { snapshot } = await loadNeighbourhood(jira.asUser, req.key, cfg, { store: makeFakeStore(), nowMs: T0 });
  assert.deepEqual(snapshot.issues.map((i) => i.key).sort(), [req.key, t1.key, ctrl.key, t2.key, risk.key].sort());
  await assert.rejects(loadNeighbourhood(jira.asUser, 'PUMP-999', cfg, { store: makeFakeStore(), nowMs: T0 }), { code: 'NOT_FOUND' });
});

test('withRateLimitRetry retries a 429 once after min(Retry-After, 2) s', async () => {
  let n = 0;
  const slept = [];
  const base = { mode: 'user', get: async () => (n++ === 0 ? { ok: false, status: 429, json: null, retryAfter: 30 } : { ok: true, status: 200, json: { a: 1 } }) };
  const j = withRateLimitRetry({ ...base, post: base.get, put: base.get, del: base.get }, { sleep: async (ms) => slept.push(ms) });
  const r = await j.get('/x');
  assert.equal(r.status, 200);
  assert.deepEqual(slept, [2000]);
});
