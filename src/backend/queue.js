// The only file that imports @forge/events.
import { Queue, InvocationError, InvocationErrorCode } from '@forge/events';

export const QUEUE_KEY = 'tb-jobs';

export function makeQueue() {
  const queue = new Queue({ key: QUEUE_KEY });
  return {
    async push(body) {
      const { jobId } = await queue.push({ body });
      return jobId;
    },
    async stats(jobId) {
      return queue.getJob(jobId).getStats();
    },
  };
}

/** Converts the seeder's {retry:{retryAfter}} result into the platform's retry response. */
export function toInvocationResult(result) {
  if (result && result.retry) {
    return new InvocationError({
      retryAfter: Math.max(1, Math.min(900, Math.round(result.retry.retryAfter))),
      retryReason: InvocationErrorCode.FUNCTION_UPSTREAM_RATE_LIMITED,
    });
  }
  return undefined;
}
