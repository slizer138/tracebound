// Regression tests for review round 4 (backend side): the health check's createmeta probe splits
// temporary failures from access failures, createmeta issue types are read across pages, error
// hints point at actions a site admin can take, and the issue panel says how tests are marked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededWorld } from './seeded.js';
import { issueCtx } from './fakes.js';
import { K } from '../../src/backend/keys.js';
import { toErrorResult } from '../../src/backend/errors.js';
import { listCreatableIssueTypes, projectIssueTypeNames, pickIssueType } from '../../src/backend/jiraOps.js';

const appWrite = async (w) => (await w.call('admin.health', { projectKey: 'PUMP' })).data.checks.find((c) => c.id === 'app-write');
const createmetaAs = (w, status) => w.jira.override(({ mode, path }) => (mode === 'app' && /createmeta/.test(path)
  ? { ok: false, status, json: null, retryAfter: null } : undefined));

test('health: createmeta 429, 5xx or no response is a temporary WARN, not the project-access advice', async () => {
  for (const status of [0, 429, 500, 503]) {
    const w = await seededWorld();
    createmetaAs(w, status);
    const c = await appWrite(w);
    assert.equal(c.status, 'warn', `status ${status}`);
    assert.match(c.detail, /usually temporary/);
    assert.equal(c.nextStep, 'Run the check again in a minute.');
    assert.doesNotMatch(c.nextStep, /atlassian-addons-project-access|Team-managed/);
  }
});

test('health: createmeta 401, 403 and 404 keep the app-access advice; other 4xx do not', async () => {
  for (const status of [401, 403, 404]) {
    const w = await seededWorld();
    createmetaAs(w, status);
    const c = await appWrite(w);
    assert.equal(c.status, 'fail', `status ${status}`);
    assert.match(c.nextStep, /atlassian-addons-project-access/);
  }
  const w = await seededWorld();
  createmetaAs(w, 400);
  const c = await appWrite(w);
  assert.equal(c.status, 'fail');
  assert.doesNotMatch(c.nextStep, /atlassian-addons-project-access/);
});

test('health: an unreadable change time no longer sends the admin to "the Tracebound team"', async () => {
  const w = await seededWorld();
  w.jira.override(({ path }) => (/changelog\/bulkfetch/.test(path)
    ? { ok: true, status: 200, json: { issueChangeLogs: [{ issueId: '1', changeHistories: [{ id: '1', created: 'yesterday', items: [] }] }] }, retryAfter: null }
    : undefined));
  const c = (await w.call('admin.health', { projectKey: 'PUMP' })).data.checks.find((x) => x.id === 'changelog');
  assert.equal(c.status, 'warn');
  assert.doesNotMatch(c.nextStep, /Tracebound team/);
  assert.match(c.nextStep, /Run the check again/);
  assert.match(c.nextStep, /History tab/);
});

test('INTERNAL error hint points at Retry and Tracebound setup, not forge logs', () => {
  const r = toErrorResult(new Error('boom'));
  assert.equal(r.error.code, 'INTERNAL');
  assert.doesNotMatch(r.error.hint, /forge logs/);
  assert.match(r.error.hint, /Retry/);
  assert.match(r.error.hint, /Tracebound setup/);
});

/** A fake client whose createmeta answers in pages of `size` from `types`. */
function pagedJira(types, size, shape = 'total') {
  const calls = [];
  return {
    mode: 'user',
    calls,
    get: async (path) => {
      const url = new URL(path, 'http://jira.test');
      const startAt = Number(url.searchParams.get('startAt') ?? 0);
      calls.push({ startAt, maxResults: Number(url.searchParams.get('maxResults')) });
      const values = types.slice(startAt, startAt + size);
      const json = { issueTypes: values, startAt, maxResults: size };
      if (shape === 'total') json.total = types.length;
      if (shape === 'isLast') json.isLast = startAt + values.length >= types.length;
      return { ok: true, status: 200, json, retryAfter: null };
    },
  };
}

test('createmeta issue types are read across pages (total, isLast, or a short page)', async () => {
  const types = Array.from({ length: 450 }, (_, i) => ({ id: String(i), name: `Type ${i}`, subtask: false }));
  for (const shape of ['total', 'isLast', 'none']) {
    const jira = pagedJira(types, 200, shape);
    const all = await listCreatableIssueTypes(jira, 'PUMP');
    assert.equal(all.length, 450, shape);
    assert.deepEqual(jira.calls.map((c) => c.startAt), [0, 200, 400], shape);
    assert.ok(jira.calls.every((c) => c.maxResults === 200));
  }
  // A type on the third page is accepted by name and can be picked.
  const names = await projectIssueTypeNames(pagedJira(types, 200), 'PUMP');
  assert.ok(names.includes('Type 449'));
  const withTask = [...types.slice(0, 420), { id: 'T', name: 'Task', subtask: false }];
  assert.deepEqual(await pickIssueType(pagedJira(withTask, 200), 'PUMP'), { id: 'T', name: 'Task' });
  // A server that caps the page below 200 is still followed when it reports more.
  const capped = pagedJira(types.slice(0, 120), 50, 'isLast');
  assert.equal((await listCreatableIssueTypes(capped, 'PUMP')).length, 120);
  // The loop is capped (five pages) so a server that never says "last" cannot loop forever.
  const endless = { mode: 'user', n: 0, get: async () => { endless.n += 1; return { ok: true, status: 200, json: { issueTypes: [{ id: String(endless.n), name: `X${endless.n}` }], isLast: false }, retryAfter: null }; } };
  assert.equal((await listCreatableIssueTypes(endless, 'PUMP')).length, 5);
});

test('issue panel data says how this project marks tests (label or issue type)', async () => {
  const w = await seededWorld();
  const req = w.key('REQ-9'); // the sample requirement without a test
  const r = await w.h['issue.getPanel']({ payload: {}, context: issueCtx(req) });
  assert.equal(r.data.roleMode, 'labels');
  assert.equal(r.data.labels.test, 'trace-test');
  const cfg = (await w.call('project.getConfig')).data.config;
  await w.store.set(K.config('PUMP'), { schema: 1, ...cfg, labels: { ...cfg.labels, test: 'qa-test' } });
  const r2 = await w.h['issue.getPanel']({ payload: {}, context: issueCtx(req) });
  assert.equal(r2.data.labels.test, 'qa-test');
  assert.equal(r2.data.testIssueType, null);
});
