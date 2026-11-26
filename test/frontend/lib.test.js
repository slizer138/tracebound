// Unit tests for the pure UI logic in src/frontend/lib (formatting, state derivation, rows,
// diff display, form validation, the call wrapper). No React needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateTime, formatTime, shortHash, pctText, pctValue, plural, cleanProjectKey, issuePath, normalizeLocale,
} from '../../src/frontend/lib/format.js';
import { kpiLozenges, stateOf, ITEM_STATES, LINK_STATES, isActionable } from '../../src/frontend/lib/states.js';
import {
  VIEW, projectViewState, seedProgress, seedBanner, pollDecision, POLL_MAX_MS, runLabelOf,
} from '../../src/frontend/lib/view.js';
import { matrixRows, suspectRows, otherGaps, releaseOptions, compareKeys } from '../../src/frontend/lib/matrix.js';
import { tidy, diffSegments, diffStats, fieldLabel, changeReasonText, passSourceNote } from '../../src/frontend/lib/diff.js';
import {
  checkReason, checkBaselineName, splitList, configToForm, formToConfig, REASON_MIN, REASON_MAX,
} from '../../src/frontend/lib/forms.js';
import { panelModel } from '../../src/frontend/lib/panel.js';
import { auditAction, auditSubject, auditDetail, chainVerdict, baselineVerdict } from '../../src/frontend/lib/audit.js';
import { healthSummary } from '../../src/frontend/lib/health.js';
import { makeCall } from '../../src/frontend/lib/api.js';
import { REASON_MIN as BACKEND_MIN, REASON_MAX as BACKEND_MAX } from '../../src/backend/clearances.js';
import { runLabel } from '../../src/backend/seeder.js';
import {
  computeTrace, simulateSeedSnapshot, applyEdit, SAMPLE_PLAN, DEFAULT_CONFIG, diffWords, normalizeConfig,
} from '../../src/engine/index.js';

const T0 = Date.parse('2026-12-01T09:00:00Z');
const sample = () => simulateSeedSnapshot(SAMPLE_PLAN, { t0Ms: T0 });
function demo() {
  const s = sample();
  const req7 = s.refToKey['REQ-7'];
  const edited = applyEdit(s.snapshot ?? s, req7, {
    fieldId: 'description',
    fromString: 'A single bolus dose shall not exceed 25 units per request.',
    toString: 'A single bolus dose shall not exceed 20 units per request.',
    atMs: T0 + 600000, authorId: 'u-1', historyId: '9001',
  });
  return { trace: computeTrace(edited, DEFAULT_CONFIG, []), key: (r) => s.refToKey[r] };
}

test('format: dates in a fixed time zone, dash for missing values', () => {
  assert.equal(formatDateTime(Date.parse('2026-11-25T10:15:30Z'), { locale: 'en-US', timeZone: 'UTC' }), 'Nov 25, 2026, 10:15');
  assert.equal(formatDateTime('2026-11-25T10:15:30.000Z', { locale: 'en_GB', timeZone: 'UTC' }), '25 Nov 2026, 10:15');
  assert.equal(formatTime(Date.parse('2026-11-25T08:05:00Z'), { locale: 'en-US', timeZone: 'UTC' }), '08:05');
  for (const v of [null, undefined, '', 'garbage']) assert.equal(formatDateTime(v), '-');
  assert.equal(normalizeLocale('en_US'), 'en-US');
  assert.equal(normalizeLocale('not a locale!'), undefined);
});

test('format: readiness, hashes, plurals, keys and paths', () => {
  assert.equal(pctText(92), '92%');
  assert.equal(pctText(null), '-', 'an empty project shows a dash, never 0%');
  assert.equal(pctValue(75), 0.75);
  assert.equal(pctValue(null), 0);
  assert.equal(pctValue(140), 1);
  assert.equal(shortHash('a'.repeat(64)), 'a'.repeat(12));
  assert.equal(shortHash(null), '-');
  assert.equal(plural(1, 'test'), '1 test');
  assert.equal(plural(3, 'test'), '3 tests');
  assert.equal(cleanProjectKey(' pump '), 'PUMP');
  assert.equal(cleanProjectKey('PUMP-7'), null);
  assert.equal(cleanProjectKey('9AB'), null);
  assert.equal(issuePath('PUMP-7'), '/browse/PUMP-7');
});

test('states: every engine state has a label and a documented Lozenge appearance', () => {
  const appearances = new Set(['default', 'inprogress', 'moved', 'new', 'removed', 'success']);
  for (const map of [ITEM_STATES, LINK_STATES]) {
    for (const v of Object.values(map)) assert.ok(appearances.has(v.appearance), v.label);
  }
  for (const s of ['READY', 'SUSPECT', 'UPSTREAM_CHANGED', 'NOT_RUN', 'MISSING_TESTS']) assert.ok(ITEM_STATES[s]);
  for (const s of ['VERIFIED', 'SUSPECT', 'CLEARED', 'NOT_RUN']) assert.ok(LINK_STATES[s]);
  assert.deepEqual(stateOf(LINK_STATES, 'WHATEVER'), { label: 'WHATEVER', appearance: 'default', help: '' });
  assert.deepEqual(['SUSPECT', 'CLEARED', 'UPSTREAM_CHANGED', 'VERIFIED', 'NOT_RUN', 'OK'].map(isActionable), [true, true, true, false, false, false]);
});

test('states: KPI lozenges for the demo numbers', () => {
  const before = computeTrace(sample().snapshot ?? sample(), DEFAULT_CONFIG, []);
  const l0 = Object.fromEntries(kpiLozenges(before.kpis).map((k) => [k.id, k]));
  assert.equal(l0.ready.label, 'Ready 11/12');
  assert.equal(l0.suspect.label, 'Suspect links 0');
  assert.equal(l0.suspect.appearance, 'default');
  const { trace } = demo();
  const l1 = Object.fromEntries(kpiLozenges(trace.kpis).map((k) => [k.id, k]));
  assert.equal(l1.ready.label, 'Ready 9/12');
  assert.equal(l1.suspect.label, 'Suspect links 3');
  assert.equal(l1.suspect.appearance, 'moved');
  assert.equal(l1.upstream.label, 'Upstream changed 1');
  assert.equal(l1.missing.appearance, 'removed');
  assert.equal(kpiLozenges(undefined)[0].label, 'Ready 0/0');
});

test('view: state machine for the project page', () => {
  assert.equal(projectViewState({ view: null, error: null }), VIEW.LOADING);
  assert.equal(projectViewState({ view: null, error: { code: 'X' } }), VIEW.ERROR);
  const base = { configured: false, info: { issueCount: 0 }, seed: null };
  assert.equal(projectViewState({ view: base }), VIEW.NOT_CONFIGURED);
  assert.equal(projectViewState({ view: { ...base, configured: true } }), VIEW.NO_TRACE_ISSUES);
  assert.equal(projectViewState({ view: { ...base, info: { issueCount: 4 } } }), VIEW.READY, 'labelled issues without saved settings still show the matrix');
  assert.equal(projectViewState({ view: { ...base, configured: true, info: { issueCount: 30 } } }), VIEW.READY);
  for (const status of ['queued', 'running', 'removing']) {
    assert.equal(projectViewState({ view: base, seedRun: { status } }), VIEW.SEEDING, status);
  }
  assert.equal(projectViewState({ view: { ...base, seed: { status: 'running' } }, seedRun: { status: 'done' }, error: null }), VIEW.NOT_CONFIGURED, 'the polled run wins over the stale view');
  assert.equal(projectViewState({ view: { ...base, configured: true, info: { issueCount: 30 } }, error: { code: 'X' } }), VIEW.READY, 'a failed refresh keeps the last view');
});

test('view: seed progress, banners and polling rule', () => {
  assert.deepEqual(seedProgress({ status: 'running', phase: 'link', progress: { done: 40, total: 63 } }),
    { value: 40 / 63, label: '40/63', phaseText: 'Linking requirements, controls, risks and tests', isIndeterminate: false });
  assert.equal(seedProgress({ status: 'queued', phase: 'create', progress: { done: 0, total: 63 } }).isIndeterminate, true);
  assert.equal(seedProgress({ status: 'removing' }).phaseText, 'Deleting the sample issues');
  const ok = seedBanner({ status: 'done', actual: { readinessPct: 92 }, expected: { readinessPct: 92 }, warnings: [] });
  assert.equal(ok.title, 'Sample data loaded (readiness 92% when loaded, expected 92%)');
  assert.equal(ok.appearance, 'success');
  assert.match(ok.body, /\[REQ-7\].*"25 units" to "20 units"/);
  const off = seedBanner({ status: 'done', actual: { readinessPct: 75 }, expected: { readinessPct: 92 }, warnings: ['TEST-1: no Done path'] });
  assert.equal(off.appearance, 'warning');
  assert.deepEqual(off.warnings, ['TEST-1: no Done path']);
  const failed = seedBanner({ status: 'failed', error: { message: 'm', hint: 'h', phase: 'create' }, warnings: [] });
  assert.deepEqual([failed.kind, failed.appearance, failed.hint], ['SEED_FAILED', 'error', 'h']);
  assert.equal(seedBanner({ status: 'failed', error: { phase: 'remove' } }).kind, 'REMOVE_FAILED');
  assert.equal(seedBanner({ status: 'running' }), null);
  assert.equal(seedBanner(null), null);
  assert.equal(pollDecision({ status: 'running' }, 0, 1000), 'continue');
  assert.equal(pollDecision({ status: 'running' }, 0, POLL_MAX_MS), 'timeout');
  assert.equal(pollDecision({ status: 'done' }, 0, 1), 'finished');
  const runId = '1a2b3c4d-aaaa-4bbb-8ccc-dddddddddddd';
  assert.equal(runLabelOf({ runId }), runLabel(runId), 'same run label as the seeder');
});

test('matrix: rows, chips and related keys for the demo edit', () => {
  const { trace, key } = demo();
  const rows = matrixRows(trace);
  assert.equal(rows.length, 12);
  const req7 = rows.find((r) => r.key === key('REQ-7'));
  assert.equal(req7.state, 'SUSPECT');
  assert.deepEqual(req7.chips.map((c) => [c.state, c.actionable]), [['SUSPECT', true], ['SUSPECT', true], ['SUSPECT', true]]);
  assert.deepEqual(req7.related, [key('CTRL-2')]);
  const ctrl2 = rows.find((r) => r.key === key('CTRL-2'));
  assert.deepEqual(ctrl2.upstream, [{ reqKey: key('REQ-7'), state: 'UPSTREAM_CHANGED', actionable: true }]);
  assert.deepEqual(ctrl2.related, [key('REQ-7'), key('RSK-3')].sort(compareKeys));
  assert.deepEqual(ctrl2.chips.map((c) => c.state), ['VERIFIED']);
  assert.equal(rows.find((r) => r.key === key('REQ-9')).chips.length, 0);
  const s = suspectRows(trace);
  assert.deepEqual(s.map((r) => r.kind), ['link', 'link', 'link', 'upstream']);
  assert.deepEqual(s[0].fields, ['description']);
  const g = otherGaps(trace);
  assert.deepEqual(g.unmitigatedRisks.map((r) => r.key), [key('RSK-4')]);
  assert.deepEqual(g.orphanTests, [key('TEST-20')]);
  assert.deepEqual(releaseOptions(['R1']), [{ label: 'All items', value: '' }, { label: 'R1', value: 'R1' }]);
  assert.deepEqual(matrixRows(undefined), []);
  assert.deepEqual(suspectRows({}), []);
});

test('diff: tidy punctuation, segment spacing and the 25 -> 20 edit', () => {
  assert.equal(tidy('units per request .'), 'units per request.');
  assert.equal(tidy('( a , b )'), '(a, b)');
  const ops = diffWords('A single bolus dose shall not exceed 25 units per request.', 'A single bolus dose shall not exceed 20 units per request.');
  const seg = diffSegments(ops);
  assert.deepEqual(seg.map((x) => [x.op, x.text, x.lead]), [
    ['eq', 'A single bolus dose shall not exceed', false],
    ['del', '25', true],
    ['ins', '20', true],
    ['eq', 'units per request.', true],
  ]);
  assert.deepEqual(diffStats(ops), { removed: 1, added: 1 });
  const rebuilt = seg.filter((x) => x.op !== 'del').map((x) => (x.lead ? ' ' : '') + x.text).join('');
  assert.equal(rebuilt, 'A single bolus dose shall not exceed 20 units per request.');
  assert.deepEqual(diffSegments([{ op: 'eq', text: 'end' }, { op: 'ins', text: '.' }]).map((x) => x.lead), [false, false]);
  assert.deepEqual(diffSegments(null), []);
  assert.equal(fieldLabel('summary'), 'Summary');
  assert.equal(fieldLabel('customfield_10100'), 'Field customfield_10100');
  assert.match(changeReasonText({ reason: 'CREATED_AFTER', fields: [] }), /created after/);
  assert.match(changeReasonText({ reason: 'TEXT_CHANGED', fields: [{}, {}] }), /2 fields/);
  assert.equal(passSourceNote('changelog'), null);
  assert.match(passSourceNote('created'), /creation date/);
});

test('forms: reason and baseline-name validation mirror the backend', () => {
  assert.equal(REASON_MIN, BACKEND_MIN);
  assert.equal(REASON_MAX, BACKEND_MAX);
  assert.equal(checkReason('short').ok, false);
  assert.equal(checkReason('   123456789   ').ok, false, 'trimmed length counts');
  assert.equal(checkReason('1234567890').ok, true);
  assert.equal(checkReason('x'.repeat(501)).ok, false);
  assert.equal(checkBaselineName('').ok, false);
  assert.equal(checkBaselineName('Release 2.1').ok, true);
  assert.equal(checkBaselineName('x'.repeat(81)).ok, false);
});

test('forms: settings round trip and validation agree with normalizeConfig', () => {
  assert.deepEqual(splitList(' a, b,,a ,\nc'), ['a', 'b', 'c']);
  const form = configToForm(DEFAULT_CONFIG);
  assert.equal(form.label_req, 'trace-req');
  assert.equal(form.fieldIds, '');
  const back = formToConfig(form);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(normalizeConfig(back.config).config, normalizeConfig(DEFAULT_CONFIG).config);
  const custom = formToConfig({ ...form, fieldIds: 'customfield_10100', allowlist: 'Relates, Tests' });
  assert.deepEqual(custom.config.substantiveFieldIds, ['summary', 'description', 'customfield_10100']);
  assert.deepEqual(custom.config.linkTypeAllowlist, ['Relates', 'Tests']);
  assert.deepEqual(normalizeConfig(custom.config).errors, []);
  assert.equal(formToConfig({ ...form, fieldIds: 'priority' }).errors.length, 1);
  assert.equal(formToConfig({ ...form, label_req: 'two words' }).errors.length, 1);
  assert.equal(formToConfig({ ...form, roleMode: 'issueTypes' }).errors.length, 1);
  assert.deepEqual(formToConfig({ ...form, roleMode: 'issueTypes', type_test: 'Test' }).errors, []);
});

test('panel: requirement, test, risk and no-role models', () => {
  const fmt = (ms) => (ms === null ? '-' : new Date(ms).toISOString().slice(0, 16));
  assert.equal(panelModel({ role: null }, fmt).kind, 'none');
  const links = [
    { testKey: 'P-27', itemKey: 'P-7', state: 'SUSPECT', passedAt: T0, change: { latestAt: T0 + 600000 } },
    { testKey: 'P-28', itemKey: 'P-7', state: 'VERIFIED', passedAt: T0 },
  ];
  const req = panelModel({ role: 'req', links }, fmt);
  assert.equal(req.message.title, 'Changed after verification: 1 test suspect');
  assert.deepEqual(req.lines.map((l) => [l.key, l.state]), [['P-27', 'SUSPECT'], ['P-28', 'VERIFIED']]);
  assert.equal(panelModel({ role: 'req', links: [links[1]] }, fmt).message.title, 'All 1 test verified');
  assert.equal(panelModel({ role: 'ctrl', links: [] }, fmt).message.title, 'No verification test is linked');
  const ctrl = panelModel({ role: 'ctrl', links: [links[1]], upstream: [{ ctrlKey: 'P-15', reqKey: 'P-7', state: 'UPSTREAM_CHANGED' }] }, fmt);
  assert.match(ctrl.lines[1].text, /Upstream P-7 changed after this control was last edited/);
  const t = panelModel({ role: 'test', links: [links[0]] }, fmt);
  assert.equal(t.lines[0].text, 'SUSPECT: P-7 changed 2026-12-01T09:10, after this test passed on 2026-12-01T09:00');
  assert.equal(panelModel({ role: 'test', links: [links[1]] }, fmt).lines[0].text, 'Verified against P-7 as of 2026-12-01T09:00');
  assert.equal(panelModel({ role: 'risk', ripple: { derivedControls: [] } }, fmt).message.title, 'Unmitigated risk');
});

test('audit: labels, subjects, details and verdicts', () => {
  assert.equal(auditAction('LINK_CLEARED'), 'Suspect link cleared');
  assert.equal(auditAction('NEW_THING'), 'NEW_THING');
  assert.equal(auditSubject({ subject: { downKey: 'P-27', upKey: 'P-7', taskKey: 'P-31' } }), 'P-31 for P-27 / P-7');
  assert.equal(auditSubject({ subject: { baselineId: 'b1', name: 'Release 2.1', release: 'R2' } }), 'Release 2.1 (R2)');
  assert.equal(auditSubject({ subject: { runId: '1a2b3c4d-aaaa' } }), 'tb-run-1a2b3c4d');
  assert.equal(auditDetail({ type: 'LINK_CLEARED', data: { reason: 'typo only fix' } }), 'Reason: typo only fix');
  assert.equal(auditDetail({ type: 'SEED_FINISHED', data: { status: 'done', actualPct: 92, expectedPct: 92 } }), 'Readiness 92% (expected 92%)');
  assert.equal(chainVerdict({ ok: true, count: 5 }).title, '5 records, chain intact');
  assert.equal(chainVerdict({ ok: false, firstBadSeq: 3, problem: 'HASH_MISMATCH' }).title, 'Chain broken at record #3');
  assert.deepEqual(baselineVerdict({ ok: true }), { ok: true, text: 'Hash matches' });
  assert.equal(baselineVerdict({ ok: false, problem: 'HASH_MISMATCH' }).text, 'MISMATCH: stored data does not match the recorded hash');
});

test('health: summary picks the worst status', () => {
  assert.equal(healthSummary([{ status: 'pass' }, { status: 'info' }]).appearance, 'success');
  assert.equal(healthSummary([{ status: 'pass' }, { status: 'warn' }]).appearance, 'warning');
  assert.equal(healthSummary([{ status: 'warn' }, { status: 'fail' }]).title, '1 check failed: fix these first, top to bottom.');
});

test('api: unwraps {body}, retries a 429 after rateLimitReset, never throws', async () => {
  const waits = [];
  let n = 0;
  const call = makeCall(async (key, payload, meta) => {
    assert.deepEqual(meta, { rateLimitProperties: true });
    n++;
    if (n === 1) throw Object.assign(new Error('rate'), { statusCode: 429, metadata: { rateLimitProperties: { rateLimitReset: 105 } } });
    return { body: { ok: true, data: { key, payload } }, metadata: {} };
  }, { sleep: async (ms) => { waits.push(ms); }, now: () => 100000 });
  assert.deepEqual(await call('project.getView', { a: 1 }), { ok: true, data: { key: 'project.getView', payload: { a: 1 } } });
  assert.deepEqual(waits, [5000]);
  const plain = makeCall(async () => ({ ok: false, error: { code: 'STALE', message: 'm' } }));
  assert.equal((await plain('x')).error.code, 'STALE');
  const broken = makeCall(async () => { throw new Error('offline'); });
  const r = await broken('x');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INVOKE_FAILED');
  assert.ok(r.error.hint);
  const always429 = makeCall(async () => { throw Object.assign(new Error('rate'), { status: 429 }); }, { sleep: async () => {} });
  assert.equal((await always429('x')).error.code, 'RATE_LIMITED');
  const weird = makeCall(async () => 'nope');
  assert.equal((await weird('x')).error.code, 'INVOKE_FAILED');
});
