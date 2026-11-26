// Rate-limit handling for resolver and action calls (25 s / 55 s budgets): one retry after
// min(Retry-After, 2) seconds. Queue jobs do NOT use this; they return an InvocationError instead.
import { realSleep } from './util.js';

/**
 * @param {{mode:string, get:Function, post:Function, put:Function, del:Function}} jira
 * @param {{sleep?:(ms:number)=>Promise<void>, maxWaitSec?:number, retries?:number}} [opts]
 */
export function withRateLimitRetry(jira, opts = {}) {
  const sleep = opts.sleep ?? realSleep;
  const maxWait = opts.maxWaitSec ?? 2;
  const retries = opts.retries ?? 1;
  const wrap = (fn) => async (...args) => {
    let res = await fn(...args);
    for (let i = 0; i < retries && res.status === 429; i++) {
      await sleep(1000 * Math.min(maxWait, res.retryAfter ?? maxWait));
      res = await fn(...args);
    }
    return res;
  };
  return { mode: jira.mode, get: wrap(jira.get), post: wrap(jira.post), put: wrap(jira.put), del: wrap(jira.del) };
}
