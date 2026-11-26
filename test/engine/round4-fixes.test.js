// Regression tests for review round 4 (engine side): the upstream rule's reference point is the
// control's net text, so an edit that is later reverted no longer hides a requirement change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrace, simulateSeedSnapshot, applyEdit, SAMPLE_PLAN, DEFAULT_CONFIG, latestSubstantiveEditMs,
} from '../../src/engine/index.js';

const cfg = DEFAULT_CONFIG;
const t0 = Date.parse('2026-11-01T10:00:00Z');
const H = 3600000;
const base = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: t0 });
const k = (ref) => base.refToKey[ref];
const REQ = k('REQ-7');
const CTRL = k('CTRL-2');
const ctrlSummary = base.issues.find((i) => i.key === CTRL).fields.summary;

const reqEdited = applyEdit(base, REQ, { fieldId: 'description', fromString: '25 units', toString: '20 units', atMs: t0 + H });
const edit = (s, from, to, atMs) => applyEdit(s, CTRL, { fieldId: 'summary', fromString: from, toString: to, atMs });
const view = (s) => {
  const tr = computeTrace(s, cfg);
  return {
    pct: tr.readiness.pct,
    upstream: tr.upstream.find((u) => u.ctrlKey === CTRL).state,
    ctrlTests: tr.links.filter((l) => l.itemKey === CTRL).map((l) => l.state),
    ctrlItem: tr.items.find((i) => i.key === CTRL).state,
  };
};

test('a control edit that is reverted (typo fixed) keeps UPSTREAM CHANGED (scenario a5)', () => {
  const before = view(reqEdited);
  assert.equal(before.pct, 75);
  assert.equal(before.upstream, 'UPSTREAM_CHANGED');
  let s = edit(reqEdited, ctrlSummary, `${ctrlSummary}x`, t0 + H + 100000);
  s = edit(s, `${ctrlSummary}x`, ctrlSummary, t0 + H + 100500);
  const after = view(s);
  assert.equal(after.upstream, 'UPSTREAM_CHANGED', 'the requirement change is still open');
  assert.equal(after.ctrlItem, 'UPSTREAM_CHANGED');
  assert.equal(after.pct, 75, 'readiness does not rise to 83');
  // The control's net text did not change, so its own tests stay verified.
  assert.ok(after.ctrlTests.every((st) => st === 'VERIFIED'), after.ctrlTests.join());
});

test('a real control edit after the requirement change still clears the flag and makes its tests suspect', () => {
  const s = edit(reqEdited, ctrlSummary, `${ctrlSummary} (20 units)`, t0 + H + 100000);
  const v = view(s);
  assert.equal(v.upstream, 'OK');
  assert.ok(v.ctrlTests.every((st) => st === 'SUSPECT'), v.ctrlTests.join());
});

test('edit, revert, then a different edit counts from the different edit', () => {
  let s = edit(reqEdited, ctrlSummary, `${ctrlSummary}x`, t0 + H + 100000);
  s = edit(s, `${ctrlSummary}x`, ctrlSummary, t0 + H + 100500);
  s = edit(s, ctrlSummary, `${ctrlSummary} v2`, t0 + H + 200000);
  assert.equal(view(s).upstream, 'OK');
});

test('a control returning to a text it had before the requirement change stays flagged', () => {
  // B is set before the requirement change; after it the control goes to C and back to B.
  let s = edit(base, ctrlSummary, `${ctrlSummary} B`, t0 + H / 2);
  s = applyEdit(s, REQ, { fieldId: 'description', fromString: '25 units', toString: '20 units', atMs: t0 + H });
  s = edit(s, `${ctrlSummary} B`, `${ctrlSummary} C`, t0 + H + 1000);
  s = edit(s, `${ctrlSummary} C`, `${ctrlSummary} B`, t0 + H + 2000);
  const u = computeTrace(s, cfg).upstream.find((x) => x.ctrlKey === CTRL);
  assert.equal(u.state, 'UPSTREAM_CHANGED');
  assert.equal(u.since, t0 + H / 2, 'the reference is when the current text B first appeared');
});

test('latestSubstantiveEditMs compares net text per field', () => {
  const h = (id, ms, items) => ({ id: String(id), created: new Date(ms).toISOString(), items });
  const it = (fieldId, from, to) => ({ field: fieldId, fieldId, fromString: from, toString: to });
  // A -> B -> A: no own edit.
  assert.equal(latestSubstantiveEditMs([h(1, 1000, [it('summary', 'A', 'B')]), h(2, 2000, [it('summary', 'B', 'A')])], ['summary']), null);
  // A -> B: the edit time.
  assert.equal(latestSubstantiveEditMs([h(1, 1000, [it('summary', 'A', 'B')])], ['summary']), 1000);
  // Formatting only (normalises equal): no own edit.
  assert.equal(latestSubstantiveEditMs([h(1, 1000, [it('summary', 'A  b', 'A b')])], ['summary']), null);
  // Two fields: the later version start wins; a reverted field does not count.
  assert.equal(latestSubstantiveEditMs([
    h(1, 1000, [it('summary', 'A', 'B')]),
    h(2, 2000, [it('description', 'x', 'y')]),
    h(3, 3000, [it('description', 'y', 'x')]),
  ], ['summary', 'description']), 1000);
  // An opaque item is a new version (conservative), even after a revert.
  const opaque = { field: 'description', fieldId: 'description', from: null, fromString: null, to: null, toString: null };
  assert.equal(latestSubstantiveEditMs([h(1, 1000, [it('summary', 'A', 'B')]), h(2, 2000, [opaque])], ['summary', 'description']), 2000);
  assert.equal(latestSubstantiveEditMs([], ['summary']), null);
});
