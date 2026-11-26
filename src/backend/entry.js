// Queue consumer and Rovo action entry points, wired to the real Forge dependencies.
import { handleJob } from './seeder.js';
import { makeActions } from './actions.js';
import { interactiveDeps, jobDeps } from './runtime.js';
import { toInvocationResult } from './queue.js';

/** Async event consumer for queue tb-jobs. */
export async function jobConsumer(event) {
  const result = await handleJob(jobDeps(), event);
  return toInvocationResult(result);
}

let actions = null;
const acts = () => (actions ??= makeActions(interactiveDeps()));

export const getReadinessAction = (payload, context) => acts().getReadiness(payload, context);
export const listSuspectsAction = (payload, context) => acts().listSuspects(payload, context);
export const getTraceGapsAction = (payload, context) => acts().getTraceGaps(payload, context);
export const getChangeImpactAction = (payload, context) => acts().getChangeImpact(payload, context);
export const createReverificationAction = (payload, context) => acts().createReverification(payload, context);
