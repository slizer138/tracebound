// Regression tests for the reviewer findings of 2026-11-25 (engine side).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrace, DEFAULT_CONFIG, normalizeText, splitChunks, joinChunks, utf8Length,
  SAMPLE_PLAN, simulateSeedSnapshot,
} from '../../src/engine/index.js';
import { fixture, basePair, P } from '../fixtures/build.js';

const cfg = DEFAULT_CONFIG;
const run = (f, clr = [], opts = {}, c = cfg) => computeTrace(f.snapshot(), c, clr, opts);
const link = (r, testKey = 'P-2', itemKey = 'P-1') => r.links.find((l) => l.testKey === testKey && l.itemKey === itemKey);
const clearOf = (l) => ({ kind: 'link', downKey: l.testKey, upKey: l.itemKey, fingerprint: l.fingerprint, reason: 'Reviewed and accepted', at: 'x', by: 'u', auditSeq: 1 });

test('CREATED_AFTER clearance goes stale when the requirement is edited later, and the edit is shown', () => {
  const f = fixture().issue('P-1', 'req', { created: P + 100 }).issue('P-2', 'test').link('P-2', 'P-1').status('P-2', '3', P);
  const l = link(run(f));
  assert.equal(l.change.reason, 'CREATED_AFTER');
  const clr = clearOf(l);
  assert.equal(link(run(f, [clr])).state, 'CLEARED');
  f.edit('P-1', 'description', 'dose 25 units', 'dose 99 units', P + 5000);
  const l2 = link(run(f, [clr]));
  assert.equal(l2.state, 'SUSPECT');
  assert.equal(l2.change.reason, 'CREATED_AFTER');
  assert.equal(l2.change.fields.length, 1);
  assert.ok(l2.change.fields[0].diff.some((d) => d.op === 'ins' && d.text === '99'));
  assert.equal(l2.change.latestAt, P + 5000);
  assert.notEqual(l2.fingerprint, l.fingerprint);
});

test('opaque change: a clearance goes stale after a further opaque change', () => {
  const c = { ...cfg, substantiveFieldIds: ['summary', 'description', 'customfield_10050'] };
  const f = basePair().edit('P-1', 'customfield_10050', null, null, P + 10, { from: '1', to: '2' });
  const l = link(run(f, [], {}, c));
  assert.equal(l.state, 'SUSPECT');
  const clr = clearOf(l);
  assert.equal(link(run(f, [clr], {}, c)).state, 'CLEARED');
  f.edit('P-1', 'customfield_10050', null, null, P + 20, { from: '2', to: '3' });
  const l2 = link(run(f, [clr], {}, c));
  assert.equal(l2.state, 'SUSPECT');
  assert.notEqual(l2.fingerprint, l.fingerprint);
});

test('text-change fingerprints carry no opaque part (existing clearances stay valid)', () => {
  const f = basePair().edit('P-1', 'description', 'a 25 b', 'a 20 b', P + 10);
  const l = link(run(f));
  assert.equal(l.change.fields[0].opaque, undefined);
  assert.equal(link(run(f, [clearOf(l)])).state, 'CLEARED');
});

test('status unknown to the cache and different from the search result is not done (index lag)', () => {
  // Passed into 7 (done), then moved to 99 (unknown to the cache); search still shows 7/done.
  const f = basePair().setCategory('7', 'done');
  f.status('P-2', '7', P + 10);
  f.status('P-2', '99', P + 20, { keepField: true });
  f.setStatusField('P-2', '7', 'done');
  assert.equal(link(run(f)).state, 'NOT_RUN');
  // When the search result shows the same unknown status, its own category is used.
  const g = basePair();
  g.status('P-2', '42', P + 20);
  g.setStatusField('P-2', '42', 'done');
  assert.equal(link(run(g)).state, 'VERIFIED');
});

test('normalisation keeps meaning-changing markers and superscripts', () => {
  const sup5 = String.fromCodePoint(0x2075);
  assert.notEqual(normalizeText(`10${sup5} cycles`), normalizeText('105 cycles'));
  assert.notEqual(normalizeText('the -not- option'), normalizeText('the not option'));
  assert.notEqual(normalizeText('shall not exceed -25- units'), normalizeText('shall not exceed 25 units'));
  assert.notEqual(normalizeText('10^5^ cycles'), normalizeText('105 cycles'));
  assert.notEqual(normalizeText('10^-8^ /h'), normalizeText('10-8 /h'));
  assert.notEqual(normalizeText('H~2~O'), normalizeText('H2O'));
  // Bold, italic and underline are still formatting only.
  assert.equal(normalizeText('the *dose* _limit_ +is+ 25'), 'the dose limit is 25');
  // Striking a word in a requirement is a substantive change.
  const f = basePair().edit('P-1', 'description', 'shall not exceed 25 units', 'shall not exceed -25- units', P + 10);
  assert.equal(link(run(f)).state, 'SUSPECT');
});

test('release filter applies to risks and orphan tests', () => {
  const f = fixture()
    .issue('P-1', 'req', { fixVersions: ['R1'] }).issue('P-2', 'test').link('P-2', 'P-1').status('P-2', '3', P)
    .issue('P-3', 'ctrl', { fixVersions: ['R1'] }).issue('P-4', 'risk').link('P-3', 'P-4')
    .issue('P-5', 'risk') // unmitigated, no release
    .issue('P-6', 'risk', { fixVersions: ['R1'] }) // unmitigated, in R1
    .issue('P-7', 'test') // orphan, no release
    .issue('P-8', 'test', { fixVersions: ['R1'] }); // orphan, in R1
  const all = run(f);
  assert.equal(all.kpis.risks, 3);
  assert.equal(all.kpis.unmitigatedRisks, 2);
  assert.equal(all.kpis.orphanTests, 2);
  const r1 = run(f, [], { release: 'R1' });
  assert.deepEqual(r1.risks.map((r) => r.key), ['P-4', 'P-6']);
  assert.equal(r1.kpis.unmitigatedRisks, 1);
  assert.deepEqual(r1.orphanTests, ['P-8']);
  const none = run(f, [], { release: 'nope' });
  assert.equal(none.readiness.pct, null);
  assert.equal(none.kpis.risks, 0);
  assert.equal(none.kpis.unmitigatedRisks, 0);
  assert.equal(none.kpis.orphanTests, 0);
});

test('sample plan numbers are unchanged by the review fixes (92% before the edit)', () => {
  const s = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: Date.parse('2026-12-01T09:00:00Z') });
  const r = computeTrace(s.snapshot ?? s, cfg, []);
  assert.equal(r.readiness.pct, 92);
  assert.equal(r.kpis.unmitigatedRisks, 1);
  assert.equal(r.kpis.orphanTests, 1);
});

test('baseline chunks are bounded by UTF-8 bytes and never split a code point', () => {
  const cjk = String.fromCodePoint(0x4e2d).repeat(50) + 'abc' + String.fromCodePoint(0x1f600).repeat(5);
  const chunks = splitChunks(cjk, 10);
  assert.equal(joinChunks(chunks), cjk);
  for (const c of chunks) {
    assert.ok(utf8Length(c) <= 10, `chunk of ${utf8Length(c)} bytes`);
    assert.equal(utf8Length(c), Buffer.byteLength(c, 'utf8'));
  }
  // 200,000 CJK characters split at 120,000 bytes: each chunk, stored as a JSON string, fits 240 KiB.
  const big = String.fromCodePoint(0x4e2d).repeat(200000);
  const parts = splitChunks(big, 120000);
  assert.ok(parts.every((c) => Buffer.byteLength(c, 'utf8') <= 120000));
  assert.ok(parts.every((c) => Buffer.byteLength(JSON.stringify(c), 'utf8') <= 240 * 1024));
  assert.equal(joinChunks(parts), big);
  // Worst case for escaping: all quotes.
  const quotes = '"'.repeat(120000);
  assert.ok(Buffer.byteLength(JSON.stringify(splitChunks(quotes, 120000)[0]), 'utf8') <= 240 * 1024);
});
