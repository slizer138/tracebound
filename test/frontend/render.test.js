// Render tests: the real UI Kit pages, rendered with react-test-renderer, calling the real resolver
// handlers over a fake Jira and fake storage. They check states, the demo numbers and the flows a
// judge clicks through. They cannot show how Jira draws the components (site checks S8, S10).
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, textOf, cleanupAll, stopBundler } from './harness.js';
import { seededWorld } from '../backend/seeded.js';
import { makeWorld, projectCtx, issueCtx, drainQueue } from '../backend/fakes.js';
import { makeHandlers } from '../../src/backend/handlers.js';

const PROJECT_CTX = { ...projectCtx(), locale: 'en-US', moduleKey: 'tb-project-page' };

function viaHandlers(h, context) {
  return (key, payload) => {
    if (!h[key]) throw new Error(`UI called unknown resolver key ${key}`);
    return h[key]({ payload, context });
  };
}

afterEach(cleanupAll);
after(stopBundler);

const lozenges = (ui) => ui.findAll('Lozenge').map((n) => textOf(n));

test('project page: seeded sample shows 92%, the demo edit gives 75% with 3 suspect chips after Refresh', async () => {
  const w = await seededWorld();
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  assert.match(ui.text(), /92%/);
  assert.match(ui.text(), /Sample data loaded \(readiness 92% when loaded, expected 92%\)/);
  assert.match(ui.text(), /Next: open \[REQ-7\]/);
  assert.match(ui.text(), /Fictional sample data\. Not clinical guidance\./);
  assert.ok(lozenges(ui).includes('Ready 11/12'));
  assert.equal(lozenges(ui).filter((l) => l === 'SUSPECT').length, 0);

  w.demoEdit();
  await ui.click('Refresh');
  assert.match(ui.text(), /75%/);
  // The banner no longer claims 92% now or repeats the edit instruction.
  assert.doesNotMatch(ui.text(), /Next: open \[REQ-7\]/);
  assert.match(ui.text(), /Readiness is now 75%\. Click an amber test/);
  assert.ok(lozenges(ui).includes('Suspect links 3'));
  assert.ok(lozenges(ui).includes('Upstream changed 1'));
  const suspectButtons = ui.findAll('Button', (n) => ['TEST-14', 'TEST-15', 'TEST-16'].map(w.key).includes(textOf(n)));
  assert.equal(suspectButtons.length, 3, 'the three REQ-7 tests are clickable chips');
  assert.equal(lozenges(ui).filter((l) => l === 'SUSPECT').length, 4, '3 link chips + REQ-7 item state');
  assert.ok(lozenges(ui).includes('UPSTREAM CHANGED'));
});

test('project page: a suspect chip opens the word diff; clearing needs a 10-character reason and writes an audit record', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.click(w.key('TEST-14'));
  const title = textOf(ui.find('ModalTitle'));
  assert.equal(title, `${w.key('TEST-14')} is suspect against ${w.key('REQ-7')}`);
  const struck = ui.findAll('Text', (n) => n.props.as === 'strike').map(textOf);
  const strong = ui.findAll('Text', (n) => n.props.as === 'strong').map(textOf);
  assert.ok(struck.includes('25'), `struck: ${struck}`);
  assert.ok(strong.includes('20'), `strong: ${strong}`);
  assert.match(ui.text(), /A single bolus dose shall not exceed/);
  assert.match(ui.text(), /Control .*CTRL|Control/);

  await ui.click('Clear as not substantive');
  const area = ui.find('TextArea');
  await ui.act(async () => area.props.onChange({ target: { value: 'too short' } }));
  const confirm = ui.find('LoadingButton', (n) => textOf(n) === 'Confirm clearance');
  assert.equal(confirm.props.isDisabled, true, 'a 9-character reason cannot be confirmed');
  await ui.act(async () => ui.find('TextArea').props.onChange({ target: { value: 'Typo-level wording check only, limit reviewed with the test owner.' } }));
  assert.equal(ui.find('LoadingButton', (n) => textOf(n) === 'Confirm clearance').props.isDisabled, false);
  await ui.click('Confirm clearance');
  assert.match(ui.text(), /Cleared, audit record #\d+/);
  assert.ok(ui.calls.some((c) => c.key === 'link.clear'));
  assert.ok(ui.calls.filter((c) => c.key === 'project.getView').length >= 2, 'the view reloads after a clearance');
  assert.ok(lozenges(ui).includes('Suspect links 2'));
});

test('project page: create re-verification task from the modal, then a second click returns the same task', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.click(w.key('TEST-15'));
  await ui.click('Create re-verification task');
  const m = /Created (PUMP-\d+)/.exec(ui.text());
  assert.ok(m, ui.text().slice(0, 300));
  // After success the create button is gone from this modal.
  assert.equal(ui.findAll('LoadingButton', (n) => textOf(n) === 'Create re-verification task').length, 0);
  // Reopening the chip and clicking again returns the same task (KVS record + direct GET,
  // independent of the search index).
  await ui.click('Close');
  await ui.click(w.key('TEST-15'));
  await ui.click('Create re-verification task');
  assert.match(ui.text(), new RegExp(`An open task already exists: ${m[1]}`));
});

test('project page: NOT_CONFIGURED empty state, Load sample data, live progress, then 92%', async () => {
  const w = makeWorld();
  const h = makeHandlers(w.deps);
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(h, PROJECT_CTX), context: PROJECT_CTX });
  assert.match(ui.text(), /Tracebound is not set up for this project/);
  await ui.click('Load sample data');
  assert.match(ui.text(), /Loading sample data/);
  assert.match(ui.text(), /Waiting for the background job to start/);
  assert.ok(ui.find('ProgressBar'));
  await drainQueue(w.queue, w.jobDeps);
  // The page polls seed.status every 2 s.
  await new Promise((r) => setTimeout(r, 2300));
  await ui.settle();
  assert.match(ui.text(), /Sample data loaded \(readiness 92% when loaded, expected 92%\)/);
  assert.match(ui.text(), /92%/);
});

test('project page: Remove sample data starts the remove job and shows progress', async () => {
  const w = await seededWorld();
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.click('Remove sample data');
  assert.match(ui.text(), /Removing sample data/);
  assert.ok(ui.calls.some((c) => c.key === 'seed.remove'));
});

test('project page: Jira 403 shows the error state with the next step and Retry', async () => {
  const w = makeWorld();
  w.jira.override(() => ({ ok: false, status: 403, json: { errorMessages: ['nope'] }, retryAfter: null }));
  const h = makeHandlers(w.deps);
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(h, PROJECT_CTX), context: PROJECT_CTX });
  assert.match(ui.text(), /Tracebound could not read this project/);
  assert.match(ui.text(), /Next step: /);
  assert.match(ui.text(), /JIRA_PERMISSION/);
  w.jira.clearOverrides();
  await ui.click('Retry');
  assert.match(ui.text(), /Tracebound is not set up for this project/);
});

test('project page: Baselines tab freezes and verifies; Audit tab verifies the chain', async () => {
  const w = await seededWorld();
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.act(async () => ui.find('Tabs').props.onChange(2));
  await ui.settle();
  assert.match(ui.text(), /Release 2\.0 \(sample\)/);
  await ui.act(async () => ui.find('Textfield', (n) => n.props.id === 'tb-baseline-name').props.onChange({ target: { value: 'Release 2.1' } }));
  await ui.click('Freeze baseline');
  assert.match(ui.text(), /Froze "Release 2\.1" at 92% readiness/);
  const verifyButtons = ui.findAll('LoadingButton', (n) => textOf(n) === 'Verify');
  assert.equal(verifyButtons.length, 2);
  await ui.act(async () => verifyButtons[0].props.onClick());
  await ui.settle();
  assert.ok(lozenges(ui).includes('Hash matches'));
  await ui.click('View');
  assert.match(ui.text(), /SHA-256 of the canonical JSON/);
  assert.match(ui.text(), /Use your browser's print to save this report\./);

  await ui.act(async () => ui.find('Tabs').props.onChange(3));
  await ui.settle();
  assert.match(ui.text(), /Baseline frozen/);
  await ui.click('Verify chain');
  assert.match(ui.text(), /\d+ records, chain intact/);
});

test('project page: Settings tab is read-only without Administer projects', async () => {
  const w = await seededWorld({ perms: { ADMINISTER_PROJECTS: false } });
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.act(async () => ui.find('Tabs').props.onChange(4));
  await ui.settle();
  assert.match(ui.text(), /Saving settings needs the Administer projects permission/);
  assert.equal(ui.find('LoadingButton', (n) => textOf(n) === 'Save settings').props.isDisabled, true);
});

test('issue panel: REQ-7 after the edit shows 3 suspect tests; a no-role issue shows the empty state', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const ctx = { ...issueCtx(w.key('REQ-7')), locale: 'en-US' };
  const ui = await renderPage('issue-context.jsx', { invokeImpl: viaHandlers(w.h, ctx), context: ctx });
  assert.match(ui.text(), /Changed after verification: 3 tests suspect/);
  await ui.click(w.key('TEST-16'));
  assert.equal(textOf(ui.find('ModalTitle')), `${w.key('TEST-16')} is suspect against ${w.key('REQ-7')}`);

  const t = { ...issueCtx(w.key('TEST-14')), locale: 'en-US' };
  const ui2 = await renderPage('issue-context.jsx', { invokeImpl: viaHandlers(w.h, t), context: t });
  assert.match(ui2.text(), new RegExp(`SUSPECT: ${w.key('REQ-7')} changed`));

  const plain = w.jira.addIssue({ summary: 'No role' });
  const p = { ...issueCtx(plain.key), locale: 'en-US' };
  const ui3 = await renderPage('issue-context.jsx', { invokeImpl: viaHandlers(w.h, p), context: p });
  assert.match(ui3.text(), /No Tracebound role/);
});

test('admin page: get-started steps, health checks for a typed project, sample data controls', async () => {
  const w = await seededWorld();
  const ctx = { accountId: 'user-1', extension: {}, moduleKey: 'tb-get-started', locale: 'en-US' };
  const ui = await renderPage('admin-page.jsx', { invokeImpl: viaHandlers(w.h, ctx), context: ctx });
  assert.match(ui.text(), /Get started in three steps/);
  assert.match(ui.text(), /Site checks only/);
  await ui.act(async () => ui.find('Textfield').props.onChange({ target: { value: 'pump' } }));
  await ui.click('Check');
  assert.match(ui.text(), /Project PUMP\./);
  assert.match(ui.text(), /All \d+ checks passed\./);
  assert.ok(lozenges(ui).filter((l) => l === 'PASS').length >= 8);
  assert.match(ui.text(), /Sample data in PUMP/);
  assert.ok(ui.findAll('LoadingButton', (n) => textOf(n) === 'Remove sample data').length === 1);
  assert.match(ui.text(), /Projects using Tracebound/);

  const plainCtx = { ...ctx, moduleKey: 'tb-admin' };
  const ui2 = await renderPage('admin-page.jsx', { invokeImpl: viaHandlers(w.h, plainCtx), context: plainCtx });
  assert.doesNotMatch(ui2.text(), /Get started in three steps/);
  assert.match(ui2.text(), /Tracebound setup/);
});
