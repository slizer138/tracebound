// Change impact, role/config handling, and engine purity checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  impactOf, findTraceEntry, mergeChanges, buildGraph, computeTrace, simulateSeedSnapshot, applyEdit, applyPass,
  SAMPLE_PLAN, DEFAULT_CONFIG, normalizeConfig, resolveRole, readiness, pctOf, fingerprint, ENGINE_VERSION,
} from '../../src/engine/index.js';

const t0 = Date.parse('2026-12-01T09:00:00Z');
const S = simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: t0 });
const k = (ref) => S.refToKey[ref];
const S1 = applyEdit(S, k('REQ-7'), {
  fieldId: 'description',
  fromString: 'A single bolus dose shall not exceed 25 units per request.',
  toString: 'A single bolus dose shall not exceed 20 units per request.',
  atMs: t0 + 600000,
  authorId: 'editor-9',
});

test('impactOf a changed requirement: diff, suspect tests, derived control ripple, risks', () => {
  const g = buildGraph(S1, DEFAULT_CONFIG);
  const tr = computeTrace(S1, DEFAULT_CONFIG, []);
  const im = impactOf(tr, g, k('REQ-7'));
  assert.equal(im.role, 'req');
  assert.equal(im.state, 'SUSPECT');
  assert.equal(im.changes.changed, true);
  assert.equal(im.changes.fields[0].changedBy, 'editor-9');
  assert.ok(im.changes.fields[0].diff.some((d) => d.op === 'ins' && d.text === '20'));
  assert.equal(im.affectedLinks.length, 3);
  assert.equal(im.derivedControls.length, 1);
  const dc = im.derivedControls[0];
  assert.equal(dc.ctrlKey, k('CTRL-2'));
  assert.equal(dc.state, 'UPSTREAM_CHANGED');
  assert.equal(dc.itemState, 'UPSTREAM_CHANGED');
  assert.deepEqual(dc.tests.map((l) => [l.testKey, l.state]), [[k('TEST-11'), 'VERIFIED']]);
  assert.deepEqual(dc.risks, [k('RSK-3')]);
  assert.deepEqual(im.risks, [k('RSK-3')]);
});

test('impactOf a control, a test, a risk and an unknown key', () => {
  const g = buildGraph(S1, DEFAULT_CONFIG);
  const tr = computeTrace(S1, DEFAULT_CONFIG, []);
  const c = impactOf(tr, g, k('CTRL-2'));
  assert.equal(c.role, 'ctrl');
  assert.equal(c.upstream.length, 1);
  assert.equal(c.changes.fields[0].fieldId, 'description'); // falls back to the upstream change
  assert.deepEqual(c.risks, [k('RSK-3')]);
  const t = impactOf(tr, g, k('TEST-14'));
  assert.equal(t.role, 'test');
  assert.deepEqual(t.affectedLinks.map((l) => [l.itemKey, l.state]), [[k('REQ-7'), 'SUSPECT']]);
  const r = impactOf(tr, g, k('RSK-3'));
  assert.equal(r.role, 'risk');
  assert.deepEqual(r.derivedControls.map((x) => x.ctrlKey), [k('CTRL-2')]);
  assert.equal(impactOf(tr, g, 'NOPE-1'), null);
  assert.equal(impactOf(tr, g, k('RSK-4')).derivedControls.length, 0);
});

test('mergeChanges keeps the widest window per field', () => {
  let s = applyPass(S1, k('TEST-14'), t0 + 700000);
  s = applyEdit(s, k('REQ-7'), { fieldId: 'description', fromString: 'A single bolus dose shall not exceed 20 units per request.', toString: 'A single bolus dose shall not exceed 18 units per request.', atMs: t0 + 800000 });
  const tr = computeTrace(s, DEFAULT_CONFIG, []);
  const im = impactOf(tr, buildGraph(s, DEFAULT_CONFIG), k('REQ-7'));
  assert.equal(im.affectedLinks.filter((l) => l.state === 'SUSPECT').length, 3);
  assert.match(im.changes.fields[0].before, /25 units/);
  assert.match(im.changes.fields[0].after, /18 units/);
  assert.equal(mergeChanges([]), null);
  assert.equal(mergeChanges([{ passedAt: 1, change: { changed: false, fields: [] } }]), null);
});

test('findTraceEntry finds link and upstream entries', () => {
  const tr = computeTrace(S1, DEFAULT_CONFIG, []);
  assert.equal(findTraceEntry(tr, k('TEST-14'), k('REQ-7')).kind, 'link');
  assert.equal(findTraceEntry(tr, k('CTRL-2'), k('REQ-7')).kind, 'upstream');
  assert.equal(findTraceEntry(tr, k('REQ-7'), k('TEST-14')), null);
});

test('fingerprint is stable and depends on every part', () => {
  const base = { kind: 'link', downKey: 'P-2', upKey: 'P-1', sinceMs: 5, reason: 'TEXT_CHANGED', fields: [{ fieldId: 'description', after: 'x', before: 'y' }] };
  const f = fingerprint(base);
  assert.equal(f, fingerprint({ ...base, fields: [{ fieldId: 'description', after: 'x', before: 'other' }] }));
  for (const change of [{ kind: 'upstream' }, { downKey: 'P-3' }, { upKey: 'P-9' }, { sinceMs: 6 }, { reason: 'CREATED_AFTER' }, { fields: [{ fieldId: 'description', after: 'z' }] }]) {
    assert.notEqual(fingerprint({ ...base, ...change }), f);
  }
});

test('readiness rounding examples', () => {
  const items = (r, n) => Array.from({ length: n }, (_, i) => ({ state: i < r ? 'READY' : 'SUSPECT' }));
  assert.deepEqual(readiness(items(11, 12)), { ready: 11, total: 12, pct: 92 });
  assert.equal(readiness(items(10, 12)).pct, 83);
  assert.equal(readiness(items(9, 12)).pct, 75);
  assert.deepEqual(readiness([]), { ready: 0, total: 0, pct: null });
  assert.equal(pctOf(1, 3), 33);
  assert.equal(pctOf(0, 0), null);
});

test('normalizeConfig merges defaults and validates', () => {
  assert.deepEqual(normalizeConfig(null), { config: { ...DEFAULT_CONFIG, labels: { ...DEFAULT_CONFIG.labels }, issueTypes: {}, substantiveFieldIds: ['summary', 'description'] }, errors: [] });
  const ok = normalizeConfig({ labels: { req: 'srs' }, substantiveFieldIds: ['customfield_10050', 'summary', 'customfield_10050'], linkTypeAllowlist: [' Relates ', ''] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.config.labels.req, 'srs');
  assert.equal(ok.config.labels.test, 'trace-test');
  assert.deepEqual(ok.config.substantiveFieldIds, ['summary', 'description', 'customfield_10050']);
  assert.deepEqual(ok.config.linkTypeAllowlist, ['Relates']);
  const bad = normalizeConfig({
    roleMode: 'magic', labels: { req: 'has space', test: 'trace-ctrl' },
    substantiveFieldIds: ['priority', 'customfield_1', 'customfield_2', 'customfield_3', 'customfield_4', 'customfield_5'],
  });
  assert.ok(bad.errors.some((e) => e.includes('roleMode')));
  assert.ok(bad.errors.some((e) => e.includes('one word')));
  assert.ok(bad.errors.some((e) => e.includes('must be different')));
  assert.ok(bad.errors.some((e) => e.includes('"priority"')));
  assert.ok(bad.errors.some((e) => e.includes('At most 4')));
  assert.equal(bad.config.substantiveFieldIds.length, 6);
  assert.ok(normalizeConfig({ roleMode: 'issueTypes' }).errors.some((e) => e.includes('Issue-type mode')));
});

test('resolveRole by label (case-insensitive) and by issue type', () => {
  const issue = (labels, type) => ({ key: 'P-1', fields: { labels, issuetype: { name: type } } });
  assert.deepEqual(resolveRole(issue(['Trace-Req'], 'Task'), DEFAULT_CONFIG), { role: 'req', ambiguous: false, matched: ['req'] });
  assert.equal(resolveRole(issue(['trace-risk', 'trace-ctrl'], 'Task'), DEFAULT_CONFIG).role, 'ctrl');
  assert.equal(resolveRole(issue([], 'Task'), DEFAULT_CONFIG).role, null);
  assert.equal(resolveRole({ key: 'P-1', fields: {} }, DEFAULT_CONFIG).role, null);
  const c = { ...DEFAULT_CONFIG, roleMode: 'issueTypes', issueTypes: { risk: 'Hazard' } };
  assert.equal(resolveRole(issue(['trace-req'], 'hazard'), c).role, 'risk');
});

test('engine purity: no @forge imports, no I/O, no clock, no network', () => {
  const dir = fileURLToPath(new URL('../../src/engine/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 17);
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    const imports = [...src.matchAll(/^\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const spec of imports) {
      const okSpec = spec.startsWith('./') || (spec === 'node:crypto' && f === 'hash.js');
      assert.ok(okSpec, `${f} imports ${spec}`);
    }
    assert.ok(!/Date\.now\(|new Date\(\)/.test(src), `${f} reads the clock`);
    assert.ok(!/\bfetch\(|https?:\/\/|require\(/.test(src), `${f} has network or CommonJS code`);
    assert.ok(!/\bcomplian(t|ce)\b/i.test(src), `${f} uses the word compliant/compliance`);
  }
  assert.equal(ENGINE_VERSION, '1.0.0');
});
