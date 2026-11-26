// Rovo actions / MCP tools: JSON string results, GET actions never write, CREATE is idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededWorld } from './seeded.js';
import { fitJson, MAX_ACTION_BYTES } from '../../src/backend/actions.js';

const parse = (s) => {
  assert.equal(typeof s, 'string');
  return JSON.parse(s);
};

test('getReadiness: 92% then 75% after the demo edit; projectKey from input or Jira context', async () => {
  const w = await seededWorld();
  const a = parse(await w.actions.getReadiness({ projectKey: 'PUMP' }, {}));
  assert.match(a.summary, /release readiness 92% \(11 of 12/);
  assert.match(a.summary, /supports evidence for design-control traceability/);
  w.demoEdit();
  const b = parse(await w.actions.getReadiness({}, { jira: { projectKey: 'PUMP' } }));
  assert.equal(b.data.readiness.pct, 75);
  const c = parse(await w.actions.getReadiness({ context: { jira: { projectKey: 'PUMP' } } }));
  assert.equal(c.data.readiness.pct, 75);
});

test('missing or malformed keys return an error JSON, not a throw', async () => {
  const w = await seededWorld();
  const e = parse(await w.actions.getReadiness({}, {}));
  assert.equal(e.error.code, 'VALIDATION');
  const e2 = parse(await w.actions.getChangeImpact({ issueKey: 'PUMP-7"; DROP' }, {}));
  assert.equal(e2.error.code, 'VALIDATION');
  w.jira.state.perms.BROWSE_PROJECTS = false;
  const e3 = parse(await w.actions.listSuspects({ projectKey: 'PUMP' }, {}));
  assert.equal(e3.error.code, 'FORBIDDEN');
});

test('GET actions never write to Jira or storage', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const writesBefore = w.jira.state.calls.filter((c) => c.method !== 'GET' && !/search\/jql|bulkfetch/.test(c.path)).length;
  const storeOps = w.store.ops.filter(([, k]) => k !== 'cache:statuses').length;
  const s = parse(await w.actions.listSuspects({ projectKey: 'PUMP' }, {}));
  assert.equal(s.data.suspects.length, 3);
  assert.equal(s.data.upstream.length, 1);
  const g = parse(await w.actions.getTraceGaps({ projectKey: 'PUMP' }, {}));
  assert.deepEqual(g.data.missingTests.map((x) => x.key), [w.key('REQ-9')]);
  assert.deepEqual(g.data.unmitigatedRisks.map((x) => x.key), [w.key('RSK-4')]);
  assert.deepEqual(g.data.orphanTests, [w.key('TEST-20')]);
  const i = parse(await w.actions.getChangeImpact({ issueKey: w.key('REQ-7') }, {}));
  const diff = i.data.changes.fields[0].diff;
  assert.ok(diff.some((d) => d.op === 'del' && d.text === '25'));
  assert.ok(diff.some((d) => d.op === 'ins' && d.text === '20'));
  assert.equal(i.data.links.filter((l) => l.state === 'SUSPECT').length, 3);
  assert.deepEqual(i.data.risks, [w.key('RSK-3')]);
  assert.equal(w.jira.state.calls.filter((c) => c.method !== 'GET' && !/search\/jql|bulkfetch/.test(c.path)).length, writesBefore);
  assert.equal(w.store.ops.filter(([, k]) => k !== 'cache:statuses').length, storeOps);
});

test('createReverification creates once, then returns the existing task', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const a = parse(await w.actions.createReverification({ testKey: w.key('TEST-14'), itemKey: w.key('REQ-7') }, { accountId: 'u-9' }));
  assert.equal(a.data.created, true);
  const b = parse(await w.actions.createReverification({ testKey: w.key('TEST-14'), itemKey: w.key('REQ-7') }, { accountId: 'u-9' }));
  assert.equal(b.data.created, false);
  assert.equal(b.data.taskKey, a.data.taskKey);
  assert.match(b.summary, /already exists/);
});

test('getChangeImpact on an issue without a role says so', async () => {
  const w = await seededWorld();
  const plain = w.jira.addIssue({ summary: 'plain' });
  const r = parse(await w.actions.getChangeImpact({ issueKey: plain.key }, {}));
  assert.equal(r.data.role, null);
});

test('fitJson keeps results under the size cap by trimming lists', () => {
  const big = { summary: 's', data: { items: Array.from({ length: 5000 }, (_, i) => ({ key: `P-${i}`, text: 'x'.repeat(50) })) } };
  const s = fitJson(big);
  assert.ok(Buffer.byteLength(s) <= MAX_ACTION_BYTES);
  const o = JSON.parse(s);
  assert.equal(o.truncated, true);
  assert.ok(o.data.items.length > 100);
});
