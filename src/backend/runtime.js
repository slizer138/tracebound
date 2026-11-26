// Real Forge dependencies. Imported only by the entry points (resolvers.js, entry.js).
import { randomUUID } from 'node:crypto';
import { makeJira } from './jiraClient.js';
import { makeKvsStore } from './store.js';
import { makeQueue } from './queue.js';
import { withRateLimitRetry } from './retry.js';
import { realSleep } from './util.js';

let cached = null;

/** Dependencies for resolvers and Rovo actions (user-facing, 25 s / 55 s budgets). */
export function interactiveDeps() {
  if (!cached) {
    cached = {
      jiraUser: withRateLimitRetry(makeJira('user')),
      jiraApp: withRateLimitRetry(makeJira('app')),
      store: makeKvsStore(),
      queue: makeQueue(),
      now: () => new Date(),
      uuid: () => randomUUID(),
    };
  }
  return cached;
}

/** Dependencies for the queue consumer: the app identity, no in-call retry (InvocationError instead). */
export function jobDeps() {
  return { jira: makeJira('app'), store: makeKvsStore(), now: () => new Date(), sleep: realSleep };
}
