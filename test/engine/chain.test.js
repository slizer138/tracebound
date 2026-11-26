// H1-H7: canonical JSON, hashing, audit chain and baselines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson, sha256Hex, GENESIS_HASH, makeAuditRecord, verifyChain, AUDIT_TYPES,
  buildBaseline, splitChunks, joinChunks, verifyBaselineJson, compareBaselines, itemTextHash, textToAdf,
  computeTrace, simulateSeedSnapshot, applyEdit, SAMPLE_PLAN, DEFAULT_CONFIG,
} from '../../src/engine/index.js';

test('H1 canonicalJson sorts keys and drops whitespace', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  assert.equal(canonicalJson({ a: undefined, b: null, c: -0, d: 'x"y' }), '{"b":null,"c":0,"d":"x\\"y"}');
  assert.equal(canonicalJson([undefined, 1]), '[null,1]');
  assert.equal(canonicalJson({ B: 1, a: 2, _: 3 }), '{"B":1,"_":3,"a":2}');
  assert.throws(() => canonicalJson({ x: NaN }), TypeError);
  assert.throws(() => canonicalJson({ x: Infinity }), TypeError);
  assert.throws(() => canonicalJson(undefined), TypeError);
  assert.throws(() => canonicalJson({ f() {} }), TypeError);
});

test('H2 sha256Hex', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(GENESIS_HASH, '0'.repeat(64));
});

function chain(n) {
  const recs = [];
  let head = null;
  for (let i = 0; i < n; i++) {
    const r = makeAuditRecord(head, {
      projectKey: 'PUMP', type: AUDIT_TYPES[i % AUDIT_TYPES.length], actor: 'user-1',
      subject: { downKey: `PUMP-${i}` }, data: { note: `record ${i + 1}` },
    }, `2026-12-01T09:0${i}:00.000Z`);
    recs.push(r);
    head = { seq: r.seq, hash: r.hash };
  }
  return recs;
}

test('makeAuditRecord links records and rejects unknown types', () => {
  const [r1, r2] = chain(2);
  assert.equal(r1.seq, 1);
  assert.equal(r1.prevHash, GENESIS_HASH);
  assert.equal(r2.prevHash, r1.hash);
  assert.match(r1.hash, /^[0-9a-f]{64}$/);
  assert.throws(() => makeAuditRecord(null, { projectKey: 'P', type: 'NOPE' }, 'x'), RangeError);
});

test('H3 a 5-record chain verifies', () => {
  assert.deepEqual(verifyChain(chain(5)), { ok: true, count: 5, firstBadSeq: null, problem: null });
  assert.deepEqual(verifyChain(chain(5).reverse()), { ok: true, count: 5, firstBadSeq: null, problem: null });
  assert.equal(verifyChain([]).ok, true);
});

test('H4 one changed character: HASH_MISMATCH at that record', () => {
  const recs = chain(5);
  recs[2] = { ...recs[2], data: { note: 'record 4' } };
  assert.deepEqual(verifyChain(recs), { ok: false, count: 5, firstBadSeq: 3, problem: 'HASH_MISMATCH' });
});

test('H5 deleted record: GAP', () => {
  const recs = chain(5);
  recs.splice(2, 1);
  const v = verifyChain(recs);
  assert.equal(v.problem, 'GAP');
  assert.equal(v.firstBadSeq, 3);
  // Missing first record is also a gap.
  assert.equal(verifyChain(chain(3).slice(1)).problem, 'GAP');
});

test('H6 swapped records with recomputed hashes: PREV_MISMATCH', () => {
  const recs = chain(5);
  const rehash = (r) => {
    const x = { ...r };
    delete x.hash;
    return { ...x, hash: sha256Hex(canonicalJson(x)) };
  };
  const a = rehash({ ...recs[2], seq: 2 });
  const b = rehash({ ...recs[1], seq: 3 });
  const v = verifyChain([recs[0], a, b, recs[3], recs[4]]);
  assert.equal(v.ok, false);
  assert.equal(v.problem, 'PREV_MISMATCH');
  assert.ok(v.firstBadSeq === 2 || v.firstBadSeq === 3);
  // Rewriting a record and re-hashing it breaks the next record's prevHash.
  const forged = rehash({ ...recs[1], data: { note: 'forged' } });
  const v2 = verifyChain([recs[0], forged, ...recs.slice(2)]);
  assert.deepEqual([v2.problem, v2.firstBadSeq], ['PREV_MISMATCH', 3]);
});

const t0 = Date.parse('2026-12-01T09:00:00Z');
const S = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: t0 });
const meta = (extra = {}) => ({
  projectKey: 'PUMP', name: 'Release 2.0 (sample)', release: null, createdAtIso: '2026-12-01T10:00:00.000Z',
  createdBy: 'user-1', textHashes: { 'PUMP-7': 'abc' }, sample: true, ...extra,
});

test('H7 buildBaseline is stable and sensitive; chunks round-trip', () => {
  const tr = computeTrace(S, DEFAULT_CONFIG, []);
  const b1 = buildBaseline(tr, meta());
  const b2 = buildBaseline(computeTrace(structuredClone(S), DEFAULT_CONFIG, []), meta());
  assert.equal(b1.hash, b2.hash);
  assert.equal(b1.json, canonicalJson(b1.payload));
  assert.equal(b1.hash, sha256Hex(b1.json));
  assert.equal(b1.payload.engineVersion, '1.0.0');
  assert.equal(b1.payload.readiness.pct, 92);
  assert.equal(b1.payload.items.length, 12);
  assert.equal(b1.payload.items.find((i) => i.key === 'PUMP-7').textHash, 'abc');
  assert.equal(b1.payload.textHashes, undefined);
  // Change one test state -> different hash.
  const tr2 = structuredClone(tr);
  tr2.links[0].state = 'SUSPECT';
  assert.notEqual(buildBaseline(tr2, meta()).hash, b1.hash);
  assert.equal(joinChunks(splitChunks(b1.json, 10)), b1.json);
  assert.ok(splitChunks(b1.json, 10).every((c) => c.length <= 10));
  assert.deepEqual(splitChunks(''), ['']);
  assert.throws(() => splitChunks('x', 0), RangeError);
});

test('verifyBaselineJson detects tampering and non-canonical JSON', () => {
  const b = buildBaseline(computeTrace(S, DEFAULT_CONFIG, []), meta());
  assert.equal(verifyBaselineJson(b.json, b.hash).ok, true);
  const tampered = b.json.replace('"pct":92', '"pct":99');
  assert.equal(verifyBaselineJson(tampered, b.hash).ok, false);
  const pretty = JSON.stringify(JSON.parse(b.json), null, 2);
  assert.equal(verifyBaselineJson(pretty, sha256Hex(pretty)).canonical, false);
  assert.equal(verifyBaselineJson('{broken', 'x').ok, false);
});

test('compareBaselines reports state, text and readiness changes', () => {
  const before = buildBaseline(computeTrace(S, DEFAULT_CONFIG, []), meta()).payload;
  const k = S.refToKey['REQ-7'];
  const S1 = applyEdit(S, k, { fieldId: 'description', fromString: 'A 25', toString: 'A 20', atMs: t0 + 600000 });
  const after = buildBaseline(computeTrace(S1, DEFAULT_CONFIG, []), meta({ textHashes: { 'PUMP-7': 'def' } })).payload;
  const c = compareBaselines(before, after);
  assert.deepEqual(c.added, []);
  assert.deepEqual(c.removed, []);
  assert.deepEqual(c.stateChanged.map((s) => [s.key, s.from, s.to]), [
    [k, 'READY', 'SUSPECT'], [S.refToKey['CTRL-2'], 'READY', 'UPSTREAM_CHANGED'],
  ]);
  assert.deepEqual(c.textChanged, [k]);
  assert.equal(c.testChanges.length, 3);
  assert.deepEqual(c.readiness, { from: 92, to: 75, delta: -17 });
});

test('itemTextHash ignores formatting but not wording', () => {
  const a = itemTextHash('Bolus limit', textToAdf(['Max 25 units']));
  assert.equal(a, itemTextHash('Bolus  limit', textToAdf(['Max *25* units'])));
  assert.notEqual(a, itemTextHash('Bolus limit', textToAdf(['Max 20 units'])));
  assert.match(a, /^[0-9a-f]{64}$/);
});
