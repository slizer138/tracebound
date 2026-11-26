// B6 link.clear and B7 re-verification tasks, plus the A3/A4 numbers on the fake site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededWorld } from './seeded.js';
import { K } from '../../src/backend/keys.js';
import { verifyAudit } from '../../src/backend/audit.js';

test('B6 link.clear: short reason gives VALIDATION, wrong fingerprint gives STALE', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const down = w.key('TEST-14');
  const up = w.key('REQ-7');
  const short = await w.call('link.clear', { downKey: down, upKey: up, kind: 'link', fingerprint: 'x', reason: 'too short' });
  assert.equal(short.error.code, 'VALIDATION');
  const stale = await w.call('link.clear', { downKey: down, upKey: up, kind: 'link', fingerprint: 'f'.repeat(64), reason: 'Typo fix only, the limit is unchanged.' });
  assert.equal(stale.error.code, 'STALE');
  assert.equal(w.store.ops.filter(([, k]) => k.startsWith('clr:')).length, 0);
});

test('B6 link.clear success: audit record written before the clr key; link shows CLEARED', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const down = w.key('TEST-14');
  const up = w.key('REQ-7');
  const imp = await w.call('link.getImpact', { downKey: down, upKey: up });
  assert.equal(imp.ok, true, JSON.stringify(imp.error));
  assert.equal(imp.data.entry.kind, 'link');
  assert.equal(imp.data.entry.entry.state, 'SUSPECT');
  assert.equal(imp.data.impact.derivedControls[0].ctrlKey, w.key('CTRL-2'));
  assert.deepEqual(imp.data.impact.risks, [w.key('RSK-3')]);
  const fp = imp.data.entry.entry.fingerprint;
  const r = await w.call('link.clear', { downKey: down, upKey: up, kind: 'link', fingerprint: fp, reason: 'Reviewed: test already covers 20 units.' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const iAudit = w.store.ops.findIndex(([op, k]) => op === 'setIfAbsent' && k === K.audit('PUMP', r.data.auditSeq));
  const iClr = w.store.ops.findIndex(([, k]) => k === K.clearance('PUMP', 'link', down, up));
  assert.ok(iAudit >= 0 && iClr > iAudit, 'audit before clearance');
  const view = await w.call('project.getView');
  const link = view.data.trace.links.find((l) => l.testKey === down && l.itemKey === up);
  assert.equal(link.state, 'CLEARED');
  assert.equal(link.clearance.reason, 'Reviewed: test already covers 20 units.');
  assert.equal(view.data.trace.kpis.suspectLinks, 2);
  // Clearing again is idempotent.
  const again = await w.call('link.clear', { downKey: down, upKey: up, kind: 'link', fingerprint: fp, reason: 'Reviewed: test already covers 20 units.' });
  assert.equal(again.data.alreadyCleared, true);
  // A later edit makes the clearance stale again (fingerprint changes).
  w.jira.edit(up, 'summary', '[REQ-7] Bolus dose limit (revised)');
  const v2 = await w.call('project.getView');
  assert.equal(v2.data.trace.links.find((l) => l.testKey === down && l.itemKey === up).state, 'SUSPECT');
  assert.equal((await verifyAudit(w.store, 'PUMP')).ok, true);
});

test('A3/A4 on the fake site: re-run the 3 tests gives 83%, clearing CTRL-2 upstream gives 92%', async () => {
  const w = await seededWorld();
  w.demoEdit();
  for (const ref of ['TEST-14', 'TEST-15', 'TEST-16']) {
    w.jira.transition(w.key(ref), 1);
    w.jira.transition(w.key(ref), 3);
  }
  const v = await w.call('project.getView');
  assert.equal(v.data.trace.readiness.pct, 83);
  assert.equal(v.data.trace.kpis.suspectLinks, 0);
  const up = v.data.trace.upstream.find((u) => u.ctrlKey === w.key('CTRL-2'));
  assert.equal(up.state, 'UPSTREAM_CHANGED');
  const r = await w.call('link.clear', { downKey: up.ctrlKey, upKey: up.reqKey, kind: 'upstream', fingerprint: up.fingerprint, reason: 'Firmware cap is configurable; 20 units is within it.' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const v2 = await w.call('project.getView');
  assert.equal(v2.data.trace.readiness.pct, 92);
  assert.equal(v2.data.trace.upstream.find((u) => u.ctrlKey === w.key('CTRL-2')).state, 'CLEARED');
  const list = await w.call('audit.list');
  assert.equal(list.data.records[0].type, 'UPSTREAM_CLEARED');
});

test('link.clear without Edit issues gives FORBIDDEN and writes nothing', async () => {
  const w = await seededWorld();
  w.demoEdit();
  w.jira.state.perms.EDIT_ISSUES = false;
  const imp = await w.call('link.getImpact', { downKey: w.key('TEST-15'), upKey: w.key('REQ-7') });
  const r = await w.call('link.clear', { downKey: w.key('TEST-15'), upKey: w.key('REQ-7'), kind: 'link', fingerprint: imp.data.entry.entry.fingerprint, reason: 'Not substantive at all, honestly.' });
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.message, /Edit issues/);
});

test('keys outside the context project are refused', async () => {
  const w = await seededWorld();
  const r = await w.call('link.clear', { downKey: 'OTHER-1', upKey: w.key('REQ-7'), kind: 'link', fingerprint: 'x', reason: 'long enough reason' });
  assert.equal(r.error.code, 'VALIDATION');
});

test('B7 re-verification task: created, linked to the test, labelled, audited; second call returns it', async () => {
  const w = await seededWorld();
  w.demoEdit();
  const test15 = w.key('TEST-15');
  const req7 = w.key('REQ-7');
  const r = await w.call('link.createReverifyTask', { downKey: test15, upKey: req7 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.created, true);
  const task = w.jira.issue(r.data.taskKey);
  assert.equal(task.fields.summary, `Re-verify ${test15} against changed ${req7}`);
  assert.deepEqual(task.fields.labels, ['tb-reverify', `tb-run-${w.runId.replace(/-/g, '').slice(0, 8)}`]);
  assert.ok(task.fields.issuelinks.some((l) => (l.inwardIssue ?? l.outwardIssue).key === test15));
  const link = w.jira.calls('POST', /issueLink$/).at(-1).body;
  assert.deepEqual([link.outwardIssue.key, link.inwardIssue.key], [r.data.taskKey, test15]);
  const text = JSON.stringify(task.fields.description);
  assert.match(text, /changed after .* last passed on 2026-12-01 \d\d:\d\d UTC/);
  assert.match(text, /Before: A single bolus dose shall not exceed 25 units/);
  assert.match(text, /After: A single bolus dose shall not exceed 20 units/);
  assert.match(text, /Re-run the test and move it to a Done status/);
  for (const c of w.jira.calls('POST', /^\/rest\/api\/3\/issue$/)) assert.equal(c.mode, 'user');

  const creates = w.jira.calls('POST', /^\/rest\/api\/3\/issue$/).length;
  const again = await w.call('link.createReverifyTask', { downKey: test15, upKey: req7 });
  assert.deepEqual([again.data.created, again.data.taskKey], [false, r.data.taskKey]);
  assert.equal(w.jira.calls('POST', /^\/rest\/api\/3\/issue$/).length, creates);
  const list = await w.call('audit.list');
  assert.equal(list.data.records.filter((x) => x.type === 'REVERIFY_TASK_CREATED').length, 1);
});

test('B7 assignee rejected: retried without the assignee', async () => {
  const w = await seededWorld({ assigneeInvalid: true });
  w.demoEdit();
  w.jira.issue(w.key('TEST-16')).fields.assignee = { accountId: 'gone-user' };
  const r = await w.call('link.createReverifyTask', { downKey: w.key('TEST-16'), upKey: w.key('REQ-7') });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.assigneeDropped, true);
  const posts = w.jira.calls('POST', /^\/rest\/api\/3\/issue$/);
  assert.equal(posts.at(-2).body.fields.assignee.accountId, 'gone-user');
  assert.equal(posts.at(-1).body.fields.assignee, undefined);
});

test('re-verification for a verified link is refused; for an upstream flag it creates a review task', async () => {
  const w = await seededWorld();
  const r = await w.call('link.createReverifyTask', { downKey: w.key('TEST-1'), upKey: w.key('REQ-1') });
  assert.equal(r.error.code, 'VALIDATION');
  w.demoEdit();
  const up = await w.call('link.createReverifyTask', { downKey: w.key('CTRL-2'), upKey: w.key('REQ-7') });
  assert.equal(up.ok, true, JSON.stringify(up.error));
  assert.equal(up.data.kind, 'upstream');
  assert.match(JSON.stringify(w.jira.issue(up.data.taskKey).fields.description), /Review the control/);
});
