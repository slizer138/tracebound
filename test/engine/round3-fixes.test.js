// Regression tests for review round 3 (engine side): numeric changelog times, changelog items
// without their own text keys, all-null description items, readiness rounding, impact reason
// and canonical JSON of sparse arrays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrace, simulateSeedSnapshot, applyEdit, SAMPLE_PLAN, DEFAULT_CONFIG, readiness, pctOf,
  impactOf, buildGraph, mergeChanges, canonicalJson, latestSubstantiveEditMs, TEXT_NOT_AVAILABLE,
} from '../../src/engine/index.js';
import { fixture, basePair, P } from '../fixtures/build.js';

const cfg = DEFAULT_CONFIG;
const run = (f, clr = [], opts = {}, c = cfg) => computeTrace(f.snapshot(), c, clr, opts);
const link = (r, testKey = 'P-2', itemKey = 'P-1') => r.links.find((l) => l.testKey === testKey && l.itemKey === itemKey);

const t0 = Date.parse('2026-12-01T09:00:00Z');
const S = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: t0 });
const k = (ref) => S.refToKey[ref];
const S1 = applyEdit(S, k('REQ-7'), {
  fieldId: 'description',
  fromString: 'A single bolus dose shall not exceed 25 units per request.',
  toString: 'A single bolus dose shall not exceed 20 units per request.',
  atMs: t0 + 600000,
});

/** The snapshot with every changelog "created" replaced by mapFn(ms). */
function withCreated(snapshot, mapFn) {
  const s = JSON.parse(JSON.stringify(snapshot));
  for (const list of Object.values(s.changelogs)) {
    for (const h of list) h.created = mapFn(Date.parse(h.created.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')));
  }
  return s;
}

test('numeric changelog "created" (epoch ms) still finds the demo edit: 75% and 3 suspects', () => {
  const s = withCreated(S1, (ms) => ms);
  assert.equal(typeof Object.values(s.changelogs).flat()[0].created, 'number');
  const tr = computeTrace(s, cfg, []);
  assert.deepEqual(tr.readiness, { ready: 9, total: 12, pct: 75 });
  assert.equal(tr.links.filter((l) => l.state === 'SUSPECT').length, 3);
});

test('numeric changelog "created" in epoch seconds (the bulkfetch spec example form)', () => {
  const s = withCreated(S1, (ms) => Math.floor(ms / 1000));
  const tr = computeTrace(s, cfg, []);
  assert.equal(tr.readiness.pct, 75);
  assert.equal(tr.links.filter((l) => l.state === 'SUSPECT').length, 3);
  // Before the edit the same conversion still gives the sample's 92%.
  assert.equal(computeTrace(withCreated(S, (ms) => Math.floor(ms / 1000)), cfg, []).readiness.pct, 92);
});

test('an item without its own fromString/toString keys never diffs Object.prototype.toString', () => {
  const f = basePair().history('P-1', P + 10, [{ field: 'description', fieldId: 'description', from: 'x', to: 'y' }]);
  const l = link(run(f));
  assert.equal(l.state, 'SUSPECT');
  const field = l.change.fields[0];
  assert.equal(field.before, TEXT_NOT_AVAILABLE);
  assert.equal(field.after, TEXT_NOT_AVAILABLE);
  assert.doesNotMatch(JSON.stringify(l.change), /native code|function/);
  assert.deepEqual(field.opaque, { rawTo: 'y', historyId: f.snapshot().changelogs['1'][0].id });
});

test('an item with only toString missing compares the text it has, not the inherited function', () => {
  const f = basePair().history('P-1', P + 10, [{ field: 'summary', fieldId: 'summary', from: null, fromString: 'Old summary', to: null }]);
  const l = link(run(f));
  assert.equal(l.state, 'SUSPECT');
  assert.equal(l.change.fields[0].before, 'Old summary');
  assert.equal(l.change.fields[0].after, '');
  assert.doesNotMatch(JSON.stringify(l.change), /native code/);
});

test('a description item whose from/to/fromString/toString are all null is a change (conservative)', () => {
  const allNull = { field: 'description', fieldId: 'description', fieldtype: 'jira', from: null, fromString: null, to: null, toString: null };
  const f = basePair().history('P-1', P + 5, [allNull]);
  const l = link(run(f));
  assert.equal(l.state, 'SUSPECT');
  assert.equal(l.change.reason, 'TEXT_CHANGED');
  assert.equal(l.change.fields[0].before, TEXT_NOT_AVAILABLE);
  assert.equal(l.change.fields[0].opaque.rawTo, null);
  // The same with the keys left out entirely.
  const g = basePair().history('P-1', P + 5, [{ field: 'description', fieldId: 'description' }]);
  assert.equal(link(run(g)).state, 'SUSPECT');
  // It also counts as the item's latest substantive edit (used by the upstream rule).
  assert.equal(latestSubstantiveEditMs(f.snapshot().changelogs['1'], ['description']), P + 5);
  // Identical non-null raw values with no text are still positive evidence of no change.
  const same = basePair().history('P-1', P + 5, [{ field: 'description', fieldId: 'description', from: '7', fromString: null, to: '7', toString: null }]);
  assert.equal(link(run(same)).state, 'VERIFIED');
  // A later all-null edit after clearing produces a new fingerprint (the clearance goes stale).
  const clr = { kind: 'link', downKey: 'P-2', upKey: 'P-1', fingerprint: l.fingerprint, reason: 'Reviewed formatting', at: 'x', by: 'u', auditSeq: 1 };
  assert.equal(link(run(f, [clr])).state, 'CLEARED');
  f.history('P-1', P + 9, [allNull]);
  assert.equal(link(run(f, [clr])).state, 'SUSPECT');
});

test('readiness shows 100% only when every item is ready', () => {
  const items = (n, ready) => Array.from({ length: n }, (_, i) => ({ state: i < ready ? 'READY' : 'SUSPECT' }));
  assert.equal(readiness(items(200, 199)).pct, 99);
  assert.equal(readiness(items(200, 200)).pct, 100);
  assert.equal(readiness(items(300, 1)).pct, 1);
  assert.equal(readiness(items(300, 0)).pct, 0);
  assert.equal(readiness([]).pct, null);
  // The sample numbers are unchanged.
  assert.equal(pctOf(11, 12), 92);
  assert.equal(pctOf(9, 12), 75);
  assert.equal(pctOf(10, 12), 83);
  assert.equal(pctOf(1, 2), 50);
});

test('impact of an item created after the pass and edited later says CREATED_AFTER and keeps the edit', () => {
  const f = fixture().issue('P-1', 'req', { created: P + 10 }).issue('P-2', 'test').link('P-2', 'P-1').status('P-2', '3', P)
    .edit('P-1', 'summary', 'Old', 'New', P + 20);
  const snap = f.snapshot();
  const tr = computeTrace(snap, cfg, []);
  assert.equal(link(tr).change.reason, 'CREATED_AFTER');
  const im = impactOf(tr, buildGraph(snap, cfg), 'P-1');
  assert.equal(im.changes.reason, 'CREATED_AFTER');
  assert.equal(im.changes.fields.length, 1);
  assert.equal(im.changes.fields[0].after, 'New');
  // A plain text change still says TEXT_CHANGED.
  assert.equal(mergeChanges([{ passedAt: 1, change: { changed: true, reason: 'TEXT_CHANGED', fields: [{ fieldId: 'summary' }], latestAt: 2 } }]).reason, 'TEXT_CHANGED');
});

test('canonicalJson writes holes in sparse arrays as null', () => {
  // eslint-disable-next-line no-sparse-arrays
  assert.equal(canonicalJson([, 1]), '[null,1]');
  // eslint-disable-next-line no-sparse-arrays
  assert.deepEqual(JSON.parse(canonicalJson({ a: [1, , 3] })), { a: [1, null, 3] });
  assert.equal(canonicalJson([undefined, 2]), '[null,2]');
});
