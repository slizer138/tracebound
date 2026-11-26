// Regression tests for review round 4 (frontend side): the consent error never leaves a view on an
// endless spinner, an unreadable change shows no word counts, the admin page drops another
// project's results after a failed Check, and the panel names the project's own test label.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, textOf, cleanupAll, stopBundler } from './harness.js';
import { seededWorld } from '../backend/seeded.js';
import { projectCtx, issueCtx } from '../backend/fakes.js';
import { makeCall, guardConsent, CONSENT_ERROR } from '../../src/frontend/lib/api.js';
import { diffStats, changeReasonText, fieldChangeView, OPAQUE_FIELD_NOTE } from '../../src/frontend/lib/diff.js';
import { panelModel, testMarker } from '../../src/frontend/lib/panel.js';

const PROJECT_CTX = { ...projectCtx(), locale: 'en-US', moduleKey: 'tb-project-page' };
const viaHandlers = (h, context) => (key, payload) => h[key]({ payload, context });
const consent = () => Object.assign(new Error('Authentication Required'), { name: 'NEEDS_AUTHENTICATION_ERR' });
const alwaysConsent = () => { throw consent(); };

afterEach(cleanupAll);
after(stopBundler);

// ---------------------------------------------------------------- consent

test('guardConsent turns the rethrown consent error into a NEEDS_CONSENT result; makeCall still rethrows it', async () => {
  const raw = makeCall(async () => { throw consent(); });
  await assert.rejects(raw('project.getView'), { name: 'NEEDS_AUTHENTICATION_ERR' });
  const r = await guardConsent(raw)('project.getView');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NEEDS_CONSENT');
  assert.match(r.error.message, /allow Tracebound/);
  assert.match(r.error.hint, /Reload the page/);
  assert.equal(CONSENT_ERROR.code, 'NEEDS_CONSENT');
  // Results pass through untouched; any other throw is a result too.
  assert.deepEqual(await guardConsent(async () => ({ ok: true, data: 1 }))('x'), { ok: true, data: 1 });
  assert.equal((await guardConsent(async () => { throw new Error('boom'); })('x')).error.code, 'INVOKE_FAILED');
});

test('INVOKE_FAILED hint names an action a site admin can take (no "app logs")', async () => {
  const r = await makeCall(async () => { throw new Error('offline'); })('x');
  assert.doesNotMatch(r.error.hint, /logs/);
  assert.match(r.error.hint, /Tracebound setup/);
});

test('project page: a consent error shows the reload-and-allow message, not an endless spinner', async () => {
  const ui = await renderPage('project-page.jsx', { invokeImpl: alwaysConsent, context: PROJECT_CTX });
  assert.equal(ui.findAll('Spinner').length, 0, ui.text().slice(0, 200));
  assert.match(ui.text(), /Jira needs you to allow Tracebound/);
  assert.match(ui.text(), /NEEDS_CONSENT/);
  assert.match(ui.text(), /Reload the page/);
});

test('issue panel and admin page: a consent error shows the same message', async () => {
  const ictx = { ...issueCtx('PUMP-1'), locale: 'en-US' };
  const panel = await renderPage('issue-context.jsx', { invokeImpl: alwaysConsent, context: ictx });
  assert.match(panel.text(), /Jira needs you to allow Tracebound/);
  assert.equal(panel.findAll('Spinner').length, 0);
  const actx = { accountId: 'user-1', extension: {}, moduleKey: 'tb-admin', locale: 'en-US' };
  const admin = await renderPage('admin-page.jsx', { invokeImpl: alwaysConsent, context: actx });
  assert.match(admin.text(), /Jira needs you to allow Tracebound/);
  assert.doesNotMatch(admin.text(), /Running checks\.\.\./);
  assert.doesNotMatch(admin.text(), /Reading projects\.\.\./);
});

// ---------------------------------------------------------------- opaque change

const opaqueField = { fieldId: 'description', before: '(text not available)', after: '(text not available)', diff: [{ op: 'del', text: '(text not available)' }, { op: 'ins', text: '(text not available)' }], opaque: { rawTo: null, historyId: '9' } };

test('an opaque field gets no diff and no word counts, and is not called substantive', () => {
  assert.deepEqual(diffStats(opaqueField.diff), { removed: 3, added: 3 }, 'the counts the drawer used to show');
  const v = fieldChangeView(opaqueField);
  assert.equal(v.opaque, true);
  assert.equal(v.note, OPAQUE_FIELD_NOTE);
  assert.match(v.note, /without its text, so Tracebound treats it as a change\. Review the issue history\./);
  assert.equal(v.currentText, null);
  assert.equal(fieldChangeView({ ...opaqueField, after: 'New text' }).currentText, 'New text');
  const text = changeReasonText({ reason: 'TEXT_CHANGED', fields: [opaqueField] });
  assert.doesNotMatch(text, /substantively/);
  assert.match(text, /without its text/);
  assert.match(changeReasonText({ reason: 'TEXT_CHANGED', fields: [opaqueField, { ...opaqueField, fieldId: 'summary' }] }), /2 fields without their text/);
  const mixed = changeReasonText({ reason: 'TEXT_CHANGED', fields: [{ fieldId: 'summary', diff: [] }, opaqueField] });
  assert.match(mixed, /^One field changed substantively/);
  assert.match(mixed, /one more field/);
  // Ordinary text changes are unchanged.
  assert.equal(changeReasonText({ reason: 'TEXT_CHANGED', fields: [{}] }), 'One field changed substantively after the reference point.');
  assert.deepEqual(fieldChangeView({ diff: [{ op: 'del', text: '25' }, { op: 'ins', text: '20' }] }), { opaque: false, stats: { removed: 1, added: 1 } });
});

test('drawer: an all-null description edit shows the review note, no "3 words removed" and no struck placeholder', async () => {
  const w = await seededWorld();
  const req = w.key('REQ-7');
  w.demoEdit();
  // Jira recorded the edit without its text (site check S6).
  const last = w.jira.issue(req).changelog.at(-1);
  for (const it of last.items) Object.assign(it, { from: null, fromString: null, to: null, toString: null });
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.click(w.key('TEST-14'));
  const text = ui.text();
  assert.match(text, /without its text, so Tracebound treats it as a change\. Review the issue history\./);
  assert.doesNotMatch(text, /3 words removed/);
  assert.doesNotMatch(text, /changed substantively/);
  const struck = ui.findAll('Text', (n) => n.props.as === 'strike').map(textOf);
  assert.ok(!struck.includes('(text not available)'), `struck: ${struck}`);
});

// ---------------------------------------------------------------- admin page

test('admin page: a failed Check drops the previous project results and hides the sample-data section', async () => {
  const w = await seededWorld();
  // PUMPX does not exist (or the user cannot see it): Jira answers 404 for its permissions.
  w.jira.override(({ path, query }) => (/mypermissions/.test(path) && query.projectKey === 'PUMPX'
    ? { ok: false, status: 404, json: { errorMessages: ['No project could be found with key PUMPX.'] }, retryAfter: null } : undefined));
  const ctx = { accountId: 'user-1', extension: {}, moduleKey: 'tb-admin', locale: 'en-US' };
  const ui = await renderPage('admin-page.jsx', { invokeImpl: viaHandlers(w.h, ctx), context: ctx });
  const typeKey = async (k) => ui.act(async () => ui.find('Textfield').props.onChange({ target: { value: k } }));
  await typeKey('PUMP');
  await ui.click('Check');
  assert.match(ui.text(), /Project PUMP\./);
  assert.match(ui.text(), /Sample data in PUMP/);
  await typeKey('PUMPX');
  await ui.click('Check');
  assert.match(ui.text(), /The health check could not run/);
  assert.doesNotMatch(ui.text(), /Project PUMP\./, 'the old summary is gone');
  assert.doesNotMatch(ui.text(), /Sample data in PUMPX/);
  assert.equal(ui.findAll('LoadingButton', (n) => textOf(n) === 'Load sample data').length, 0);
  // A good key again brings everything back.
  await typeKey('PUMP');
  await ui.click('Check');
  assert.match(ui.text(), /Project PUMP\./);
  assert.doesNotMatch(ui.text(), /The health check could not run/);
});

// ---------------------------------------------------------------- panel label

test('panel: "no verification test" names the configured test label or issue type', () => {
  const data = (extra) => ({ role: 'req', links: [], upstream: [], ...extra });
  const fmt = () => 'x';
  assert.match(panelModel(data({ labels: { test: 'qa-test' } }), fmt).message.body, /\(label qa-test\)/);
  assert.match(panelModel(data({}), fmt).message.body, /\(label trace-test\)/);
  assert.match(panelModel(data({ roleMode: 'issueTypes', testIssueType: 'Test Case', labels: { test: 'qa-test' } }), fmt).message.body, /\(issue type Test Case\)/);
  assert.equal(testMarker({ roleMode: 'issueTypes', testIssueType: null, labels: { test: 'qa' } }), 'label qa');
});
