// Regression tests for the reviewer findings of 2026-11-25 (frontend side).
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPage, cleanupAll, stopBundler } from './harness.js';
import { seededWorld } from '../backend/seeded.js';
import { projectCtx } from '../backend/fakes.js';
import { K } from '../../src/backend/keys.js';
import { tidy, diffSegments } from '../../src/frontend/lib/diff.js';
import { seedBanner } from '../../src/frontend/lib/view.js';

const PROJECT_CTX = { ...projectCtx(), locale: 'en-US', moduleKey: 'tb-project-page' };
const viaHandlers = (h, context) => (key, payload) => h[key]({ payload, context });

afterEach(cleanupAll);
after(stopBundler);

test('diff display joins hyphens and slashes between words', () => {
  assert.equal(tidy('in 0.05 - unit steps'), 'in 0.05-unit steps');
  assert.equal(tidy('and / or'), 'and/or');
  assert.equal(tidy('a - b - c'), 'a-b-c');
  assert.equal(tidy('units per request .'), 'units per request.');
  // Across styled segments: "0.05 -" | ins "unit" renders as "0.05-unit".
  const segs = diffSegments([{ op: 'eq', text: '0.05 -' }, { op: 'ins', text: 'unit' }, { op: 'eq', text: 'steps' }]);
  assert.deepEqual(segs.map((s) => [s.text, s.lead]), [['0.05-', false], ['unit', false], ['steps', true]]);
});

test('seed banner states load-time readiness and changes its next step once readiness moved', () => {
  const run = { status: 'done', actual: { readinessPct: 92 }, expected: { readinessPct: 92 }, warnings: [] };
  assert.match(seedBanner(run, 92).body, /Next: open \[REQ-7\]/);
  const moved = seedBanner(run, 75);
  assert.match(moved.title, /92% when loaded/);
  assert.match(moved.body, /Readiness is now 75%/);
});

test('no deprecated Lozenge isBold and no undocumented Toggle event field in the UI', () => {
  for (const f of ['src/frontend/components/MatrixTable.jsx', 'src/frontend/issue-context.jsx', 'src/frontend/project-page.jsx']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /isBold/, f);
    assert.doesNotMatch(src, /target\.checked/, f);
  }
});

test('Only gaps toggle works with an onChange that carries no event data', async () => {
  const w = await seededWorld();
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  const toggle = ui.find('Toggle');
  await ui.act(async () => toggle.props.onChange());
  await ui.settle();
  assert.equal(ui.find('Toggle').props.isChecked, true);
  const last = ui.calls.filter((c) => c.key === 'project.getView').pop();
  assert.equal(last.payload.onlyGaps, true);
});

test('project page with a bad issue-type config shows the error AND the Settings form', async () => {
  const w = await seededWorld();
  const cfg = (await w.call('project.getConfig')).data.config;
  await w.store.set(K.config('PUMP'), { schema: 1, ...cfg, roleMode: 'issueTypes', issueTypes: { req: 'Requirment' } });
  w.jira.override(({ method, path, body }) => (method === 'POST' && path === '/rest/api/3/search/jql' && /issuetype in/.test(body?.jql ?? '')
    ? { ok: false, status: 400, json: { errorMessages: ['bad issuetype'] }, retryAfter: null } : null));
  const ui = await renderPage('project-page.jsx', { invokeImpl: viaHandlers(w.h, PROJECT_CTX), context: PROJECT_CTX });
  assert.match(ui.text(), /could not read this project/);
  assert.match(ui.text(), /How Tracebound finds the role of an issue/);
  assert.ok(ui.findAll('Select').length > 0);
});
