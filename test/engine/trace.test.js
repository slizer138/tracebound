// Suspect-rule edge cases E1-E24 plus deleted links, same-second ordering and scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrace, buildGraph, DEFAULT_CONFIG, canonicalJson, toJiraTime } from '../../src/engine/index.js';
import { fixture, basePair, P, T0 } from '../fixtures/build.js';

const cfg = DEFAULT_CONFIG;
const T = 'The dose shall not exceed 25 units';
const run = (f, clr = [], opts = {}, c = cfg) => computeTrace(f.snapshot(), c, clr, opts);
const link = (r, testKey = 'P-2', itemKey = 'P-1') => r.links.find((l) => l.testKey === testKey && l.itemKey === itemKey);

test('baseline: a passed test with no later change is VERIFIED', () => {
  const r = run(basePair());
  assert.equal(link(r).state, 'VERIFIED');
  assert.equal(link(r).passedAt, P);
  assert.equal(link(r).passSource, 'changelog');
  assert.equal(r.items[0].state, 'READY');
  assert.equal(r.readiness.pct, 100);
});

test('E1 change strictly before the pass: VERIFIED', () => {
  const r = run(basePair().edit('P-1', 'description', T, T.replace('25', '20'), P - 1));
  assert.equal(link(r).state, 'VERIFIED');
});

test('E2 change at exactly the pass millisecond (tie): SUSPECT', () => {
  const r = run(basePair().edit('P-1', 'description', T, T.replace('25', '20'), P));
  assert.equal(link(r).state, 'SUSPECT');
  assert.equal(link(r).change.reason, 'TEXT_CHANGED');
});

test('same-second: tie is SUSPECT regardless of history array order or ids', () => {
  // Edit history listed before the pass history, with a smaller id, at the same ms.
  const f = fixture().issue('P-1', 'req').issue('P-2', 'test').link('P-2', 'P-1')
    .edit('P-1', 'description', T, T.replace('25', '20'), P, { id: 1 })
    .status('P-2', '3', P, { id: 2 });
  assert.equal(link(run(f)).state, 'SUSPECT');
  // Edit one second before the pass, histories delivered newest first: VERIFIED.
  const g = fixture().issue('P-1', 'req').issue('P-2', 'test').link('P-2', 'P-1')
    .status('P-2', '3', P, { id: 9 })
    .edit('P-1', 'description', T, T.replace('25', '20'), P - 1000, { id: 3 });
  assert.equal(link(run(g)).state, 'VERIFIED');
});

test('E3 formatting-only change (*25* -> 25): VERIFIED', () => {
  const r = run(basePair().edit('P-1', 'description', 'The dose shall not exceed *25* units', T, P + 10));
  assert.equal(link(r).state, 'VERIFIED');
  const r2 = run(basePair().edit('P-1', 'description', T, 'The dose shall not exceed {*}25{*} units', P + 10));
  assert.equal(link(r2).state, 'VERIFIED');
  const r3 = run(basePair().edit('P-1', 'description', T, 'h2. The dose shall not exceed **25** units', P + 10));
  assert.equal(link(r3).state, 'VERIFIED');
});

test('E4 whitespace, nbsp and smart-quote changes: VERIFIED', () => {
  const nbsp = String.fromCodePoint(0xa0);
  const r = run(basePair().edit('P-1', 'description', T, `The dose${nbsp}shall   not\n exceed 25 units `, P + 10));
  assert.equal(link(r).state, 'VERIFIED');
  const lq = String.fromCodePoint(0x2018);
  const rq = String.fromCodePoint(0x2019);
  const r2 = run(basePair().edit('P-1', 'description', "The user's 'dose' - 25", `The user${rq}s ${lq}dose${rq} ${String.fromCodePoint(0x2013)} 25`, P + 10));
  assert.equal(link(r2).state, 'VERIFIED');
});

test('E5 net revert after the pass: VERIFIED', () => {
  const f = basePair()
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 1)
    .edit('P-1', 'description', T.replace('25', '20'), T, P + 2);
  assert.equal(link(run(f)).state, 'VERIFIED');
});

test('E6 case change "shall" -> "SHALL": SUSPECT', () => {
  const r = run(basePair().edit('P-1', 'description', T, T.replace('shall', 'SHALL'), P + 10));
  assert.equal(link(r).state, 'SUSPECT');
  assert.deepEqual(link(r).change.fields[0].diff.filter((d) => d.op !== 'eq'), [
    { op: 'del', text: 'shall' }, { op: 'ins', text: 'SHALL' },
  ]);
});

test('E7 labels, assignee or priority change after the pass: VERIFIED', () => {
  const f = basePair()
    .history('P-1', P + 10, [{ field: 'labels', fieldId: 'labels', from: null, fromString: 'trace-req', to: null, toString: 'trace-req urgent' }])
    .history('P-1', P + 20, [{ field: 'assignee', fieldId: 'assignee', from: 'a', fromString: 'Ann', to: 'b', toString: 'Bob' }])
    .history('P-1', P + 30, [{ field: 'priority', fieldId: 'priority', from: '3', fromString: 'Medium', to: '2', toString: 'High' }]);
  assert.equal(link(run(f)).state, 'VERIFIED');
});

test('E8 summary change after the pass: SUSPECT with a summary diff', () => {
  const r = run(basePair().edit('P-1', 'summary', 'Bolus dose limit', 'Bolus dose limit per hour', P + 10));
  const l = link(r);
  assert.equal(l.state, 'SUSPECT');
  assert.equal(l.change.fields.length, 1);
  assert.equal(l.change.fields[0].fieldId, 'summary');
  assert.deepEqual(l.change.fields[0].diff, [{ op: 'eq', text: 'Bolus dose limit' }, { op: 'ins', text: 'per hour' }]);
  assert.equal(l.change.latestAt, P + 10);
  assert.equal(l.change.fields[0].changedBy, 'user-1');
});

test('E9 reopen: NOT_RUN while reopened, VERIFIED after the re-pass', () => {
  const f = basePair()
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 10)
    .status('P-2', '1', P + 20);
  const r = run(f);
  assert.equal(link(r).state, 'NOT_RUN');
  assert.equal(link(r).change, null);
  assert.equal(r.items[0].state, 'NOT_RUN');
  f.status('P-2', '3', P + 30);
  const r2 = run(f);
  assert.equal(link(r2).state, 'VERIFIED');
  assert.equal(link(r2).passedAt, P + 30);
});

test('E10 done-to-done transition after the edit counts as a re-pass', () => {
  const f = basePair()
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 10)
    .status('P-2', '4', P + 20);
  const r = run(f);
  assert.equal(link(r).state, 'VERIFIED');
  assert.equal(link(r).passedAt, P + 20);
});

test('E11 done without status history: statuscategorychangedate, else created', () => {
  const f = fixture().issue('P-1', 'req').issue('P-2', 'test', { status: '3', sccd: P + 100 })
    .link('P-2', 'P-1').edit('P-1', 'description', T, T.replace('25', '20'), P + 50);
  const l = link(run(f));
  assert.equal(l.state, 'VERIFIED');
  assert.equal(l.passSource, 'statusCategoryChangeDate');
  assert.equal(l.passedAt, P + 100);
  const g = fixture().issue('P-1', 'req').issue('P-2', 'test', { status: '3', created: T0 + 5000 }).link('P-2', 'P-1');
  const l2 = link(run(g));
  assert.equal(l2.state, 'VERIFIED');
  assert.equal(l2.passSource, 'created');
  assert.equal(l2.passedAt, T0 + 5000);
  // created fallback with an edit after it: SUSPECT
  g.edit('P-1', 'summary', 'a', 'b', T0 + 6000);
  assert.equal(link(run(g)).state, 'SUSPECT');
});

test('E12 requirement created after the test last passed: SUSPECT (CREATED_AFTER), clearable', () => {
  const f = fixture().issue('P-1', 'req', { created: P + 5000 }).issue('P-2', 'test').link('P-2', 'P-1').status('P-2', '3', P);
  const l = link(run(f));
  assert.equal(l.state, 'SUSPECT');
  assert.equal(l.change.reason, 'CREATED_AFTER');
  assert.deepEqual(l.change.fields, []);
  const clr = { kind: 'link', downKey: 'P-2', upKey: 'P-1', fingerprint: l.fingerprint, reason: 'Test covers it', at: 'x', by: 'u', auditSeq: 1 };
  assert.equal(link(run(f, [clr])).state, 'CLEARED');
  // Created at exactly the pass ms is not "after".
  const g = fixture().issue('P-1', 'req', { created: P }).issue('P-2', 'test').link('P-2', 'P-1').status('P-2', '3', P);
  assert.equal(link(run(g)).state, 'VERIFIED');
});

test('E13 clearance with a stale fingerprint (edited again after clearing): SUSPECT', () => {
  const f = basePair().edit('P-1', 'description', T, T.replace('25', '20'), P + 10);
  const l = link(run(f));
  const clr = { kind: 'link', downKey: 'P-2', upKey: 'P-1', fingerprint: l.fingerprint, reason: 'Not substantive', at: 'x', by: 'u', auditSeq: 1 };
  assert.equal(link(run(f, [clr])).state, 'CLEARED');
  f.edit('P-1', 'description', T.replace('25', '20'), T.replace('25', '18'), P + 1000);
  const l2 = link(run(f, [clr]));
  assert.equal(l2.state, 'SUSPECT');
  assert.notEqual(l2.fingerprint, l.fingerprint);
  assert.equal(l2.clearance, null);
});

test('E14 changelog item without text but with differing raw values: SUSPECT, text not available', () => {
  const f = basePair().edit('P-1', 'customfield_10050', null, null, P + 10, { from: '1', to: '2' });
  const c = { ...cfg, substantiveFieldIds: ['summary', 'description', 'customfield_10050'] };
  const l = link(run(f, [], {}, c));
  assert.equal(l.state, 'SUSPECT');
  assert.equal(l.change.fields[0].before, '(text not available)');
  // Same raw values: not a change.
  const g = basePair().edit('P-1', 'customfield_10050', null, null, P + 10, { from: '1', to: '1' });
  assert.equal(link(run(g, [], {}, c)).state, 'VERIFIED');
  // Not configured as substantive: ignored.
  assert.equal(link(run(f)).state, 'VERIFIED');
});

test('E15 search index lag: field says new, newest changelog status is done -> treated as done', () => {
  const f = fixture().issue('P-1', 'req').issue('P-2', 'test').link('P-2', 'P-1')
    .status('P-2', '3', P, { keepField: true });
  assert.equal(f.raw('P-2').fields.status.id, '1');
  const l = link(run(f));
  assert.equal(l.state, 'VERIFIED');
  assert.equal(l.passedAt, P);
});

test('E16 unknown status id in the changelog is ignored for pass detection', () => {
  const f = basePair()
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 20)
    .status('P-2', '99', P + 50);
  f.setStatusField('P-2', '99', 'done');
  const l = link(run(f));
  // Current status 99 is unknown to the map; the issue's own category (done) is used.
  // The pass is the last transition into a KNOWN done status (P), so the edit at P+20 makes it suspect.
  assert.equal(l.passedAt, P);
  assert.equal(l.state, 'SUSPECT');
});

test('E17 control edited after its requirement changed: upstream OK, control tests SUSPECT', () => {
  const f = fixture()
    .issue('P-1', 'req').issue('P-2', 'ctrl', { created: T0 + 1000 }).issue('P-3', 'test')
    .link('P-2', 'P-1').link('P-3', 'P-2').status('P-3', '3', P)
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 100);
  const r1 = run(f);
  assert.equal(r1.upstream[0].state, 'UPSTREAM_CHANGED');
  assert.equal(link(r1, 'P-3', 'P-2').state, 'VERIFIED'); // never propagates to the control's tests
  assert.equal(r1.items.find((i) => i.key === 'P-2').state, 'UPSTREAM_CHANGED');
  f.edit('P-2', 'description', 'Cap at 25', 'Cap at 20', P + 200);
  const r2 = run(f);
  assert.equal(r2.upstream[0].state, 'OK');
  assert.equal(r2.upstream[0].since, P + 200);
  assert.equal(link(r2, 'P-3', 'P-2').state, 'SUSPECT');
  assert.equal(r2.items.find((i) => i.key === 'P-2').state, 'SUSPECT');
  // A formatting-only control edit does not move the upstream window.
  const g = fixture()
    .issue('P-1', 'req').issue('P-2', 'ctrl', { created: T0 + 1000 })
    .link('P-2', 'P-1')
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 100)
    .edit('P-2', 'description', 'Cap at 25', 'Cap at *25*', P + 200);
  assert.equal(run(g).upstream[0].state, 'UPSTREAM_CHANGED');
});

test('E18 duplicate links (two types) and reverse direction count once', () => {
  const f = fixture().issue('P-1', 'req').issue('P-2', 'test')
    .link('P-2', 'P-1', 'Relates').link('P-1', 'P-2', 'Tests').link('P-2', 'P-1', 'Blocks')
    .status('P-2', '3', P);
  const g = buildGraph(f.snapshot(), cfg);
  assert.deepEqual(g.verifies, [{ testKey: 'P-2', itemKey: 'P-1' }]);
  const r = run(f);
  assert.equal(r.links.length, 1);
  assert.deepEqual(r.items[0].tests, ['P-2']);
  // Reverse direction alone has the same meaning.
  const h = fixture().issue('P-1', 'req').issue('P-2', 'test').link('P-1', 'P-2').status('P-2', '3', P);
  assert.deepEqual(buildGraph(h.snapshot(), cfg).verifies, [{ testKey: 'P-2', itemKey: 'P-1' }]);
});

test('E19 links to role-less issues are ignored; other-project links are counted as ignored', () => {
  const f = basePair().issue('P-3', null).link('P-2', 'P-3').link('P-1', 'P-3')
    .extLink('P-1', 'OTHER-5').extLink('P-2', 'OTHER-6');
  const r = run(f);
  assert.equal(r.links.length, 1);
  assert.equal(r.externalLinksIgnored, 2);
  assert.equal(buildGraph(f.snapshot(), cfg).nodes['P-3'], undefined);
  // A same-project issue that was not loaded is ignored but not counted as external.
  const g = basePair().extLink('P-1', 'P-77');
  assert.equal(run(g).externalLinksIgnored, 0);
});

test('E20 several role labels: test wins, ambiguous, warning', () => {
  const f = fixture().issue('P-1', 'req', { labels: ['trace-test', 'trace-req'] });
  const g = buildGraph(f.snapshot(), cfg);
  assert.equal(g.nodes['P-1'].role, 'test');
  assert.equal(g.nodes['P-1'].ambiguous, true);
  const r = run(f);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /P-1 has several roles/);
  assert.deepEqual(r.orphanTests, ['P-1']);
});

test('E21 cycle-like data terminates and yields one derives entry', () => {
  const f = fixture().issue('P-1', 'req').issue('P-2', 'ctrl')
    .link('P-2', 'P-1', 'Relates').link('P-1', 'P-2', 'Blocks').link('P-1', 'P-1', 'Relates');
  const g = buildGraph(f.snapshot(), cfg);
  assert.deepEqual(g.derives, [{ ctrlKey: 'P-2', reqKey: 'P-1' }]);
  const r = run(f);
  assert.equal(r.upstream.length, 1);
  assert.equal(r.items.length, 2);
});

test('E22 release filter: totals use only items in the release; empty release gives null', () => {
  const f = fixture();
  for (let i = 1; i <= 6; i++) f.issue(`P-${i}`, 'req', { fixVersions: i <= 4 ? ['R2'] : ['R1'] });
  f.issue('P-10', 'test').link('P-10', 'P-1').status('P-10', '3', P);
  f.issue('P-11', 'test').link('P-11', 'P-5').status('P-11', '3', P);
  const r = run(f, [], { release: 'R2' });
  assert.equal(r.readiness.total, 4);
  assert.equal(r.readiness.ready, 1);
  assert.equal(r.readiness.pct, 25);
  assert.deepEqual(r.links.map((l) => l.itemKey), ['P-1']);
  assert.equal(r.release, 'R2');
  const none = run(f, [], { release: 'R9' });
  assert.equal(none.readiness.pct, null);
  assert.equal(none.kpis.coveragePct, null);
  assert.equal(run(f).readiness.total, 6);
});

test('E23 empty snapshot: no items, readiness null, no throw', () => {
  const r = computeTrace({ issues: [], changelogs: {}, statusCatById: {}, projectKey: 'P' }, cfg, []);
  assert.deepEqual(r.items, []);
  assert.equal(r.readiness.pct, null);
  assert.equal(r.kpis.items, 0);
  const r2 = computeTrace(undefined, cfg);
  assert.equal(r2.readiness.pct, null);
});

test('E24 deterministic: same input, same output', () => {
  const f = basePair().issue('P-3', 'ctrl').issue('P-4', 'risk').link('P-3', 'P-1').link('P-3', 'P-4')
    .edit('P-1', 'description', T, T.replace('25', '20'), P + 10);
  const snap = f.snapshot();
  const a = computeTrace(structuredClone(snap), cfg, []);
  const b = computeTrace(structuredClone(snap), cfg, []);
  assert.deepEqual(a, b);
  assert.equal(canonicalJson(a), canonicalJson(b));
  // Input order does not matter either.
  const rev = { ...structuredClone(snap), issues: structuredClone(snap.issues).reverse() };
  assert.equal(canonicalJson(computeTrace(rev, cfg, [])), canonicalJson(a));
  // The input is not mutated.
  const before = JSON.stringify(snap);
  computeTrace(snap, cfg, []);
  assert.equal(JSON.stringify(snap), before);
});

test('deleted link: item loses its test, test becomes orphan; the Link changelog item is not substantive', () => {
  const f = basePair().issue('P-3', 'req').issue('P-4', 'test').link('P-4', 'P-3').status('P-4', '3', P)
    .history('P-3', P + 10, [{ field: 'Link', fieldtype: 'jira', from: 'P-9', fromString: 'This issue relates to P-9', to: null, toString: null }]);
  assert.equal(link(run(f), 'P-4', 'P-3').state, 'VERIFIED');
  f.unlink('P-2', 'P-1');
  const r = run(f);
  assert.equal(r.items.find((i) => i.key === 'P-1').state, 'MISSING_TESTS');
  assert.deepEqual(r.orphanTests, ['P-2']);
  assert.equal(r.readiness.pct, 50);
});

test('state priority: MISSING > SUSPECT > UPSTREAM_CHANGED > NOT_RUN > READY', () => {
  const f = fixture()
    .issue('P-1', 'req')
    .issue('P-2', 'ctrl', { created: T0 + 1 }).issue('P-3', 'test').issue('P-4', 'test').issue('P-5', 'test')
    .link('P-2', 'P-1').link('P-3', 'P-2').link('P-4', 'P-2').link('P-5', 'P-1')
    .status('P-3', '3', P).status('P-5', '3', P)
    .edit('P-1', 'summary', 'a', 'b', P + 10);
  let r = run(f);
  // P-2: one NOT_RUN test (P-4) and upstream changed -> UPSTREAM_CHANGED wins.
  assert.equal(r.items.find((i) => i.key === 'P-2').state, 'UPSTREAM_CHANGED');
  assert.deepEqual(r.items.find((i) => i.key === 'P-2').flags, { missing: false, suspect: 0, upstream: 1, notRun: 1 });
  f.edit('P-2', 'summary', 'c', 'd', P + 20);
  r = run(f);
  assert.equal(r.items.find((i) => i.key === 'P-2').state, 'SUSPECT');
  assert.equal(r.items.find((i) => i.key === 'P-1').state, 'SUSPECT');
});

test('onlyGaps drops READY items but never changes KPIs or readiness', () => {
  const f = basePair().issue('P-3', 'req');
  const all = run(f);
  const gaps = run(f, [], { onlyGaps: true });
  assert.deepEqual(gaps.items.map((i) => i.key), ['P-3']);
  assert.deepEqual(gaps.kpis, all.kpis);
  assert.deepEqual(gaps.readiness, all.readiness);
});

test('link-type allowlist and issue-type role mode', () => {
  const f = fixture().issue('P-1', 'req').issue('P-2', 'test').link('P-2', 'P-1', 'Relates').status('P-2', '3', P);
  assert.equal(run(f, [], {}, { ...cfg, linkTypeAllowlist: ['Tests'] }).links.length, 0);
  assert.equal(run(f, [], {}, { ...cfg, linkTypeAllowlist: ['relates'] }).links.length, 1);
  const g = fixture().issue('P-1', null, { type: 'Requirement' }).issue('P-2', null, { type: 'Test Case' })
    .link('P-2', 'P-1').status('P-2', '3', P);
  const c = { ...cfg, roleMode: 'issueTypes', issueTypes: { req: 'requirement', test: 'Test Case' } };
  const r = run(g, [], {}, c);
  assert.equal(r.links.length, 1);
  assert.equal(r.readiness.pct, 100);
});

test('custom substantive field (acceptance criteria) is honoured only when configured', () => {
  const f = basePair().edit('P-1', 'customfield_10050', 'Dose <= 25', 'Dose <= 20', P + 5, { field: 'Acceptance criteria' });
  assert.equal(link(run(f)).state, 'VERIFIED');
  const c = { ...cfg, substantiveFieldIds: ['summary', 'description', 'customfield_10050'] };
  const l = link(run(f, [], {}, c));
  assert.equal(l.state, 'SUSPECT');
  assert.equal(l.change.fields[0].fieldId, 'customfield_10050');
  // Older changelog items without fieldId are matched by field name.
  const g = basePair().edit('P-1', 'description', T, T.replace('25', '20'), P + 5, { noFieldId: true });
  assert.equal(link(run(g)).state, 'SUSPECT');
});

test('several edits after the pass: before is the first from, after is the last to', () => {
  const f = basePair()
    .edit('P-1', 'description', T, T.replace('25', '22'), P + 10)
    .edit('P-1', 'description', T.replace('25', '22'), T.replace('25', '20'), P + 20, { author: 'user-2' });
  const fc = link(run(f)).change.fields[0];
  assert.equal(fc.before, T);
  assert.equal(fc.after, T.replace('25', '20'));
  assert.equal(fc.changedAt, P + 20);
  assert.equal(fc.changedBy, 'user-2');
  assert.equal(fc.historyIds.length, 2);
});

test('large project: 500 requirements with 500 tests compute quickly and correctly', () => {
  const f = fixture('BIG');
  for (let i = 1; i <= 500; i++) f.issue(`BIG-${i}`, 'req', { created: T0 + i });
  for (let i = 1; i <= 500; i++) {
    f.issue(`BIG-${1000 + i}`, 'test').link(`BIG-${1000 + i}`, `BIG-${i}`).status(`BIG-${1000 + i}`, '3', P + i);
  }
  for (let i = 1; i <= 50; i++) f.edit(`BIG-${i * 10}`, 'description', `Value ${i}`, `Value ${i + 1}`, P + 10000);
  const snap = f.snapshot();
  const started = performance.now();
  const r = computeTrace(snap, cfg, []);
  const ms = performance.now() - started;
  assert.equal(r.items.length, 500);
  assert.equal(r.kpis.suspectLinks, 50);
  assert.equal(r.readiness.pct, 90);
  assert.equal(r.items[0].key, 'BIG-1');
  assert.equal(r.items[499].key, 'BIG-500');
  assert.ok(ms < 5000, `computeTrace took ${ms} ms`);
});

test('a huge description falls back to whole del+ins in the diff and still flags SUSPECT', () => {
  const big = Array.from({ length: 3500 }, (_, i) => `w${i}`).join(' ');
  const f = basePair().edit('P-1', 'description', big, big + ' extra', P + 10);
  const d = link(run(f)).change.fields[0].diff;
  assert.equal(link(run(f)).state, 'SUSPECT');
  assert.deepEqual(d.map((x) => x.op), ['del', 'ins']);
});

test('histories with unparseable timestamps are ignored, not fatal', () => {
  const f = basePair();
  const snap = f.snapshot();
  snap.changelogs['1'].push({ id: '7', created: 'garbage', items: [{ field: 'summary', fieldId: 'summary', fromString: 'a', toString: 'b' }] });
  const r = computeTrace(snap, cfg, []);
  assert.equal(link(r).state, 'VERIFIED');
  assert.equal(toJiraTime(P).endsWith('+0000'), true);
});
