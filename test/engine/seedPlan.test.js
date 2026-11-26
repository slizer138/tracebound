// Acceptance tests A1-A6: the demo numbers (92% before the edit, 75% after) are guaranteed by code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_PLAN, SAMPLE_NOTICE, DEFAULT_CONFIG, validatePlan, planSeed, parseSeedRef,
  simulateSeedSnapshot, applyEdit, applyPass, applyReopen, computeTrace, adfToText,
} from '../../src/engine/index.js';

const t0 = Date.parse('2026-12-01T09:00:00Z');
const S = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: t0 });
const key = (ref) => S.refToKey[ref];
const trace = (snap, clr = [], opts = {}) => computeTrace(snap, DEFAULT_CONFIG, clr, opts);
const FROM = 'A single bolus dose shall not exceed 25 units per request.';
const TO = 'A single bolus dose shall not exceed 20 units per request.';
const S1 = applyEdit(S, key('REQ-7'), { fieldId: 'description', fromString: FROM, toString: TO, atMs: t0 + 600000 });

function repass(snap, refs) {
  let s = snap;
  for (const r of refs) {
    s = applyReopen(s, key(r), t0 + 690000);
    s = applyPass(s, key(r), t0 + 700000);
  }
  return s;
}

test('plan is structurally valid and has the documented totals', () => {
  assert.deepEqual(validatePlan(SAMPLE_PLAN), []);
  assert.equal(SAMPLE_PLAN.issues.length, 30);
  assert.equal(SAMPLE_PLAN.links.length, 19);
  assert.equal(SAMPLE_PLAN.pass.length, 13);
  const role = Object.fromEntries(SAMPLE_PLAN.issues.map((i) => [i.ref, i.role]));
  const kinds = SAMPLE_PLAN.links.map((l) => `${role[l.down]}>${role[l.up]}`);
  assert.equal(kinds.filter((k) => k === 'test>req').length, 10);
  assert.equal(kinds.filter((k) => k === 'test>ctrl').length, 3);
  assert.equal(kinds.filter((k) => k === 'ctrl>req').length, 3);
  assert.equal(kinds.filter((k) => k === 'ctrl>risk').length, 3);
  for (const i of SAMPLE_PLAN.issues) assert.equal(i.paragraphs.at(-1), SAMPLE_NOTICE);
  assert.match(SAMPLE_NOTICE, /Not clinical guidance/);
  const req7 = SAMPLE_PLAN.issues.find((i) => i.ref === 'REQ-7');
  assert.equal(req7.paragraphs[0], FROM);
  assert.ok(Object.isFrozen(SAMPLE_PLAN) && Object.isFrozen(SAMPLE_PLAN.issues[0]));
});

test('validatePlan reports bad plans', () => {
  const bad = {
    issues: [{ ref: 'REQ-1', role: 'req' }, { ref: 'REQ-1', role: 'req' }, { ref: 'T-1', role: 'test' }],
    links: [{ down: 'REQ-1', up: 'T-1' }, { down: 'T-1', up: 'NOPE-1' }],
    pass: ['REQ-1'],
  };
  const p = validatePlan(bad);
  assert.ok(p.some((x) => x.includes('duplicate ref')));
  assert.ok(p.some((x) => x.includes('direction req>test')));
  assert.ok(p.some((x) => x.includes('unknown ref')));
  assert.ok(p.some((x) => x.includes('not a test')));
});

test('planSeed produces labelled creates, downstream-outward links and 63 operations', () => {
  const plan = planSeed(SAMPLE_PLAN, DEFAULT_CONFIG, 'a1b2c3d4');
  assert.equal(plan.creates.length, 30);
  assert.equal(plan.links.length, 19);
  assert.equal(plan.passRefs.length, 13);
  assert.equal(plan.totalOps, 63);
  const r7 = plan.creates.find((c) => c.ref === 'REQ-7');
  assert.equal(r7.summary, '[REQ-7] Bolus dose limit');
  assert.deepEqual(r7.labels, ['trace-req', 'tb-sample', 'tb-run-a1b2c3d4']);
  assert.equal(adfToText(r7.descriptionAdf), `${FROM}\n${SAMPLE_NOTICE}`);
  assert.deepEqual(plan.links[0], { downRef: 'TEST-1', upRef: 'REQ-1' });
  const custom = planSeed(SAMPLE_PLAN, { ...DEFAULT_CONFIG, labels: { req: 'r', risk: 'k', ctrl: 'c', test: 't' } }, 'ffffffff');
  assert.equal(custom.creates.find((c) => c.ref === 'TEST-1').labels[0], 't');
  assert.throws(() => planSeed(SAMPLE_PLAN, DEFAULT_CONFIG, 'short'), RangeError);
});

test('parseSeedRef', () => {
  assert.equal(parseSeedRef('[REQ-7] Bolus dose limit'), 'REQ-7');
  assert.equal(parseSeedRef('[TEST-20] Priming sequence test'), 'TEST-20');
  assert.equal(parseSeedRef('REQ-7 Bolus'), null);
  assert.equal(parseSeedRef('[req-7] x'), null);
  assert.equal(parseSeedRef(null), null);
});

test('A1 seeded data: readiness 92% before the demo edit', () => {
  const r = trace(S);
  assert.deepEqual(r.readiness, { ready: 11, total: 12, pct: 92 });
  assert.deepEqual(r.readiness, { ...SAMPLE_PLAN.expected.before });
  assert.equal(r.kpis.missingTests, 1);
  assert.equal(r.items.find((i) => i.state === 'MISSING_TESTS').key, key('REQ-9'));
  assert.equal(r.kpis.suspectLinks, 0);
  assert.equal(r.kpis.upstreamChanged, 0);
  assert.equal(r.kpis.unmitigatedRisks, 1);
  assert.deepEqual(r.risks.filter((x) => !x.mitigated).map((x) => x.key), [key('RSK-4')]);
  assert.equal(r.kpis.orphanTests, 1);
  assert.deepEqual(r.orphanTests, [key('TEST-20')]);
  assert.equal(r.kpis.notRunLinks, 0);
  assert.equal(r.kpis.coveragePct, 92);
  assert.equal(r.kpis.risks, 4);
});

test('A2 demo edit 25 -> 20 units: three suspects, CTRL-2 upstream changed, readiness 75%', () => {
  const r = trace(S1);
  assert.deepEqual(r.readiness, { ready: 9, total: 12, pct: 75 });
  const exp = SAMPLE_PLAN.expected.afterEdit;
  assert.equal(r.readiness.pct, exp.pct);
  assert.equal(r.kpis.suspectLinks, exp.suspectLinks);
  assert.equal(r.kpis.upstreamChanged, exp.upstreamChanged);
  const suspects = r.links.filter((l) => l.state === 'SUSPECT');
  assert.deepEqual(
    suspects.map((l) => [l.testKey, l.itemKey]),
    ['TEST-14', 'TEST-15', 'TEST-16'].map((t) => [key(t), key('REQ-7')]),
  );
  const up = r.upstream.filter((u) => u.state === 'UPSTREAM_CHANGED');
  assert.deepEqual(up.map((u) => [u.ctrlKey, u.reqKey]), [[key('CTRL-2'), key('REQ-7')]]);
  assert.equal(r.links.find((l) => l.testKey === key('TEST-11')).state, 'VERIFIED');
  assert.equal(r.items.find((i) => i.key === key('REQ-7')).state, 'SUSPECT');
  assert.equal(r.items.find((i) => i.key === key('CTRL-2')).state, 'UPSTREAM_CHANGED');
  const diff = suspects[0].change.fields[0].diff;
  assert.equal(suspects[0].change.fields[0].fieldId, 'description');
  assert.ok(diff.some((d) => d.op === 'del' && d.text === '25'));
  assert.ok(diff.some((d) => d.op === 'ins' && d.text === '20'));
  assert.deepEqual(diff.filter((d) => d.op !== 'eq').map((d) => d.text), ['25', '20']);
  // Every suspect carries a fingerprint for clearance.
  for (const l of suspects) assert.match(l.fingerprint, /^[0-9a-f]{64}$/);
});

test('A3 re-running the three tests: 83%, no suspects, CTRL-2 still upstream changed', () => {
  const S2 = repass(S1, ['TEST-14', 'TEST-15', 'TEST-16']);
  const r = trace(S2);
  assert.equal(r.readiness.pct, 83);
  assert.equal(r.kpis.suspectLinks, 0);
  assert.equal(r.kpis.upstreamChanged, 1);
  assert.equal(r.items.find((i) => i.key === key('REQ-7')).state, 'READY');
});

test('A4 clearing the CTRL-2 upstream flag with the matching fingerprint: 92%, CLEARED', () => {
  const S2 = repass(S1, ['TEST-14', 'TEST-15', 'TEST-16']);
  const up = trace(S2).upstream.find((u) => u.ctrlKey === key('CTRL-2'));
  const clr = {
    kind: 'upstream', downKey: up.ctrlKey, upKey: up.reqKey, fingerprint: up.fingerprint,
    reason: 'Firmware cap is configured separately', at: '2026-12-01T09:20:00.000Z', by: 'user-1', auditSeq: 1,
  };
  const r = trace(S2, [clr]);
  assert.equal(r.readiness.pct, 92);
  const u2 = r.upstream.find((u) => u.ctrlKey === key('CTRL-2'));
  assert.equal(u2.state, 'CLEARED');
  assert.deepEqual(u2.clearance, clr);
  assert.equal(r.kpis.upstreamChanged, 0);
});

test('A5 only TEST-14 re-passed: two suspects remain, 75%', () => {
  const r = trace(repass(S1, ['TEST-14']));
  assert.equal(r.kpis.suspectLinks, 2);
  assert.equal(r.readiness.pct, 75);
  const states = r.links.filter((l) => l.itemKey === key('REQ-7')).map((l) => l.state);
  assert.deepEqual(states, ['VERIFIED', 'SUSPECT', 'SUSPECT']);
});

test('A6 link counts: 13 verification links, TEST-20 has none', () => {
  const r = trace(S);
  assert.equal(r.items.reduce((n, i) => n + i.tests.length, 0), 13);
  assert.equal(r.links.length, 13);
  assert.ok(!r.links.some((l) => l.testKey === key('TEST-20')));
  assert.equal(r.upstream.length, 3);
});

test('a link clearance on one suspect turns it CLEARED and counts as verified', () => {
  const r = trace(S1);
  const l = r.links.find((x) => x.state === 'SUSPECT');
  const clr = { kind: 'link', downKey: l.testKey, upKey: l.itemKey, fingerprint: l.fingerprint, reason: 'Typo only, checked', at: 'x', by: 'u', auditSeq: 2 };
  const r2 = trace(S1, [clr]);
  assert.equal(r2.links.find((x) => x.testKey === l.testKey).state, 'CLEARED');
  assert.equal(r2.kpis.suspectLinks, 2);
  assert.equal(r2.kpis.clearedLinks, 1);
  // A clearance of the wrong kind does not apply.
  const r3 = trace(S1, [{ ...clr, kind: 'upstream' }]);
  assert.equal(r3.kpis.suspectLinks, 3);
});

test('a cosmetic re-save of REQ-1 (bold only) raises no suspect', () => {
  const t = 'The pump shall deliver basal rates from 0.05 to 35.00 units per hour in 0.05-unit steps.';
  const s = applyEdit(S, key('REQ-1'), { fieldId: 'description', fromString: t, toString: t.replace('0.05 to', '*0.05* to'), atMs: t0 + 600000 });
  assert.equal(trace(s).readiness.pct, 92);
});
