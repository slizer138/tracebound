// Regression tests for review round 5 (engine side): "did the text change" and "what does the
// diff show" are decided on the same word tokens, so an edit that only moves whitespace next to
// punctuation is not a substantive change and can never produce a SUSPECT link with an empty diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrace, simulateSeedSnapshot, applyEdit, SAMPLE_PLAN, DEFAULT_CONFIG,
  compareKey, diffWords, normalizeText, latestSubstantiveEditMs,
} from '../../src/engine/index.js';

const cfg = DEFAULT_CONFIG;
const t0 = Date.parse('2026-11-01T10:00:00Z');
const H = 3600000;
const base = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: t0 });
const REQ = base.refToKey['REQ-7'];
const CTRL = base.refToKey['CTRL-2'];
const reqLinks = (s) => computeTrace(s, cfg).links.filter((l) => l.itemKey === REQ);
const changed = (ops) => ops.filter((o) => o.op !== 'eq' && o.op !== 'same');

test('compareKey ignores whitespace around punctuation and nothing else', () => {
  assert.equal(compareKey('up to 25 units per request.'), compareKey('up to 25 units per request .'));
  assert.equal(compareKey('ratio 1:2'), compareKey('ratio 1 : 2'));
  assert.equal(compareKey('a,b'), compareKey('a , b'));
  assert.equal(compareKey(null), compareKey(''));
  assert.notEqual(compareKey('25 units'), compareKey('20 units'));
  assert.notEqual(compareKey('0.05 mL'), compareKey('0. 05 mL'), 'splitting a number is a real change');
  assert.notEqual(compareKey('units'), compareKey('u nits'), 'splitting a word is a real change');
  assert.notEqual(compareKey('stop at 25'), compareKey('stop at 25!'), 'added punctuation is a real change');
});

test('compareKey and the word diff always agree', () => {
  const pairs = [
    ['per request.', 'per request .'],
    ['ratio 1:2', 'ratio 1 : 2'],
    ['25 units', '20 units'],
    ['*bold* text', 'bold text'],
    ['a - b', 'a-b'],
    ['', 'new text'],
    ['limit (25)', 'limit ( 25 )'],
  ];
  for (const [a, b] of pairs) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    const same = compareKey(a) === compareKey(b);
    const shows = diffWords(na, nb).some((o) => o.op === 'del' || o.op === 'ins');
    assert.equal(same, !shows, `"${a}" vs "${b}": same=${same}, diff shows a change=${shows}`);
  }
});

test('a whitespace-only edit next to punctuation raises no suspect and readiness stays 92%', () => {
  const s = applyEdit(base, REQ, {
    fieldId: 'description', fromString: 'up to 25 units per request.', toString: 'up to 25 units per request .', atMs: t0 + H,
  });
  const tr = computeTrace(s, cfg);
  assert.equal(tr.readiness.pct, 92);
  assert.ok(reqLinks(s).every((l) => l.state === 'VERIFIED'), reqLinks(s).map((l) => l.state).join());
});

test('every SUSPECT link caused by a readable text change has a diff that shows the change', () => {
  const s = applyEdit(base, REQ, { fieldId: 'description', fromString: '25 units', toString: '20 units', atMs: t0 + H });
  const tr = computeTrace(s, cfg);
  assert.equal(tr.readiness.pct, 75);
  const suspects = tr.links.filter((l) => l.state === 'SUSPECT');
  assert.equal(suspects.length, 3);
  for (const l of suspects) {
    const fields = l.change?.fields ?? [];
    assert.ok(fields.length > 0, `${l.testKey} has field changes`);
    for (const f of fields) assert.ok(changed(f.diff).length > 0, `${l.testKey} ${f.fieldId} diff is not empty`);
  }
});

test('a whitespace-only control edit does not count as the control being updated', () => {
  const ctrlSummary = base.issues.find((i) => i.key === CTRL).fields.summary;
  const reqEdited = applyEdit(base, REQ, { fieldId: 'description', fromString: '25 units', toString: '20 units', atMs: t0 + H });
  const spaced = ctrlSummary.replace(/([.,:;)])/, ' $1');
  const s = applyEdit(reqEdited, CTRL, { fieldId: 'summary', fromString: ctrlSummary, toString: `${spaced} `, atMs: t0 + 2 * H });
  const tr = computeTrace(s, cfg);
  assert.equal(tr.upstream.find((u) => u.ctrlKey === CTRL).state, 'UPSTREAM_CHANGED');
  assert.equal(tr.readiness.pct, 75);
  const histories = s.changelogs[s.issues.find((i) => i.key === CTRL).id];
  assert.ok(Array.isArray(histories) && histories.length > 0, 'the control has a changelog');
  assert.equal(latestSubstantiveEditMs(histories, ['summary']), null, 'a whitespace-only edit is not an own edit');
});
