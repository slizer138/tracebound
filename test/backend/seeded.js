// Helper (not a test file): a fake site with the sample data loaded, optionally after the demo edit.
import assert from 'node:assert/strict';
import { makeWorld, drainQueue, projectCtx } from './fakes.js';
import { makeHandlers } from '../../src/backend/handlers.js';
import { makeActions } from '../../src/backend/actions.js';
import { K } from '../../src/backend/keys.js';
import { SAMPLE_PLAN } from '../../src/engine/index.js';

export const REQ7 = SAMPLE_PLAN.issues.find((i) => i.ref === 'REQ-7').paragraphs;

export async function seededWorld(opts = {}) {
  const w = makeWorld(opts);
  const h = makeHandlers(w.deps);
  const start = await h['seed.start']({ payload: {}, context: projectCtx() });
  assert.equal(start.ok, true, JSON.stringify(start.error));
  await drainQueue(w.queue, w.jobDeps);
  const run = await w.store.get(K.seedRun(start.data.runId));
  assert.equal(run.status, 'done');
  const key = (ref) => run.refToKey[ref];
  const actions = makeActions(w.deps);
  const ctx = projectCtx();
  const call = (name, payload = {}, context = ctx) => h[name]({ payload, context });
  const demoEdit = () => w.jira.edit(key('REQ-7'), 'description', [REQ7[0].replace('25 units', '20 units'), REQ7[1]]);
  return { ...w, h, run, key, actions, call, demoEdit, runId: start.data.runId };
}
