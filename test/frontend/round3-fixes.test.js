// Regression tests for review round 3 (frontend side): the consent error is not turned into an
// error banner, and Settings offers issue-type Selects filled from the project.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, cleanupAll, stopBundler } from './harness.js';
import { seededWorld } from '../backend/seeded.js';
import { projectCtx } from '../backend/fakes.js';
import { K } from '../../src/backend/keys.js';
import { makeCall, isConsentError } from '../../src/frontend/lib/api.js';
import { typeOptions } from '../../src/frontend/lib/forms.js';

const PROJECT_CTX = { ...projectCtx(), locale: 'en-US', moduleKey: 'tb-project-page' };
const viaHandlers = (h, context) => (key, payload) => h[key]({ payload, context });

afterEach(cleanupAll);
after(stopBundler);

test('makeCall rethrows the platform consent error instead of returning INVOKE_FAILED', async () => {
  const consent = Object.assign(new Error('Authentication Required'), { name: 'NEEDS_AUTHENTICATION_ERR' });
  await assert.rejects(makeCall(async () => { throw consent; })('project.getView'), { name: 'NEEDS_AUTHENTICATION_ERR' });
  // A bridge that flattens the error to its message is recognised too.
  const flat = new Error('Invocation failed: NEEDS_AUTHENTICATION_ERR');
  await assert.rejects(makeCall(async () => { throw flat; })('x'), /NEEDS_AUTHENTICATION_ERR/);
  assert.equal(isConsentError(consent), true);
  assert.equal(isConsentError(new Error('offline')), false);
  assert.equal(isConsentError(undefined), false);
  // Other failures are still results, never throws.
  assert.equal((await makeCall(async () => { throw new Error('offline'); })('x')).error.code, 'INVOKE_FAILED');
});

test('typeOptions lists the project types and keeps a saved name that is not among them', () => {
  assert.deepEqual(typeOptions(['Task', 'Bug', 'Task'], ''), [{ label: 'Task', value: 'Task' }, { label: 'Bug', value: 'Bug' }]);
  assert.deepEqual(typeOptions(['Task'], 'task'), [{ label: 'Task', value: 'Task' }]);
  assert.deepEqual(typeOptions(['Task'], 'Requirment')[0], { label: 'Requirment (not in this project)', value: 'Requirment' });
  assert.deepEqual(typeOptions(null, ''), []);
});

test('Settings in issue-type mode shows one Select per role with the project issue types', async () => {
  const w = await seededWorld();
  const cfg = (await w.call('project.getConfig')).data.config;
  await w.store.set(K.config('PUMP'), { schema: 1, ...cfg, roleMode: 'issueTypes', issueTypes: { test: 'Task' } });
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  await ui.act(async () => ui.find('Tabs').props.onChange(4));
  await ui.settle();
  assert.ok(ui.calls.some((c) => c.key === 'project.issueTypes'), 'the issue types are read');
  const roleSelects = ui.findAll('Select', (n) => /^tb-type-/.test(n.props.inputId ?? ''));
  assert.equal(roleSelects.length, 4);
  const testSelect = roleSelects.find((n) => n.props.inputId === 'tb-type-test');
  assert.deepEqual(testSelect.props.options.map((o) => o.value), ['Epic', 'Sub-task', 'Task']);
  assert.equal(testSelect.props.value.value, 'Task');
  // Choosing a type for another role and saving stores it.
  const reqSelect = roleSelects.find((n) => n.props.inputId === 'tb-type-req');
  await ui.act(async () => reqSelect.props.onChange({ label: 'Epic', value: 'Epic' }));
  await ui.click('Save settings');
  const saved = await w.store.get(K.config('PUMP'));
  assert.deepEqual(saved.issueTypes, { req: 'Epic', test: 'Task' });
});

test('Settings falls back to text fields when the issue types cannot be read', async () => {
  const w = await seededWorld();
  const cfg = (await w.call('project.getConfig')).data.config;
  await w.store.set(K.config('PUMP'), { schema: 1, ...cfg, roleMode: 'issueTypes', issueTypes: { test: 'Task' } });
  const invoke = (key, payload) => (key === 'project.issueTypes'
    ? { ok: false, error: { code: 'JIRA_ERROR', message: 'Jira returned 500', hint: null } }
    : w.h[key]({ payload, context: PROJECT_CTX }));
  const ui = await renderPage('project-page.jsx', { invokeImpl: invoke, context: PROJECT_CTX });
  await ui.act(async () => ui.find('Tabs').props.onChange(4));
  await ui.settle();
  assert.equal(ui.findAll('Select', (n) => /^tb-type-/.test(n.props.inputId ?? '')).length, 0);
  assert.equal(ui.findAll('Textfield', (n) => /^tb-type-/.test(n.props.id ?? '')).length, 4);
  assert.match(ui.text(), /could not be read \(Jira returned 500\)\. Type the exact names instead\./);
});
