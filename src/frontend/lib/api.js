// Resolver call wrapper. The bridge's invoke is injected so this can be unit-tested.
// - Unwraps the resolver result {ok, data} / {ok:false, error}.
// - Asks the bridge for rate-limit metadata; on a 429 waits until rateLimitReset and retries
//   (pattern from the Forge invocation-limits page).
// - makeCall never throws: a bridge failure becomes {ok:false, error:{code:'INVOKE_FAILED', ...}}.
//   The one exception is the platform consent error (NEEDS_AUTHENTICATION_ERR), which is rethrown
//   so it is never mistaken for an ordinary failure. guardConsent (used by ../api.js) then turns it
//   into a NEEDS_CONSENT result so no view waits forever on a rejected call.

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 30000;

/** The Forge consent error, by name or (when the bridge flattens it) by message. */
export function isConsentError(e) {
  return e?.name === 'NEEDS_AUTHENTICATION_ERR' || /NEEDS_AUTHENTICATION/.test(String(e?.message ?? ''));
}

function statusOf(e) {
  return e?.statusCode ?? e?.status ?? null;
}

/** Shown when Jira still needs the user to allow Tracebound to read Jira as them. */
export const CONSENT_ERROR = Object.freeze({
  code: 'NEEDS_CONSENT',
  message: 'Jira needs you to allow Tracebound to access Jira as you before this view can load.',
  hint: 'Reload the page. When Jira shows "Allow access", accept it; the view then loads.',
});

/**
 * Wraps a call function (from makeCall) so the consent error ends as a visible result instead of
 * a rejection. The rejection has already passed through the bridge, which is where the host can
 * show its "Allow access" screen; nothing above a view's loader would catch it, so without this
 * a loader that awaited it never left its loading state (an endless spinner).
 * @param {(key:string, payload?:object)=>Promise<any>} callFn
 */
export function guardConsent(callFn) {
  return async function call(key, payload) {
    try {
      return await callFn(key, payload);
    } catch (e) {
      if (isConsentError(e)) return { ok: false, error: { ...CONSENT_ERROR } };
      return {
        ok: false,
        error: { code: 'INVOKE_FAILED', message: `The app could not be reached (${e?.message ?? 'unknown error'}).`, hint: 'Reload the page, then click Retry.' },
      };
    }
  };
}

/**
 * @param {(key:string, payload?:object, metadata?:object)=>Promise<any>} invokeFn
 * @param {{sleep?:(ms:number)=>Promise<void>, now?:()=>number}} [opts]
 */
export function makeCall(invokeFn, opts = {}) {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  return async function call(key, payload = {}) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await invokeFn(key, payload, { rateLimitProperties: true });
        // With metadata requested the bridge wraps the result as {body, metadata}.
        const body = res && typeof res === 'object' && 'body' in res && !('ok' in res) ? res.body : res;
        if (body && typeof body === 'object' && typeof body.ok === 'boolean') return body;
        return { ok: false, error: { code: 'INVOKE_FAILED', message: `Unexpected response from ${key}.`, hint: 'Reload the page.' } };
      } catch (e) {
        // The platform consent error is never turned into an error banner: it is rethrown so the
        // host can show its "Allow access" prompt.
        if (isConsentError(e)) throw e;
        const status = statusOf(e);
        if (status === 429 && attempt < MAX_ATTEMPTS) {
          const reset = e?.metadata?.rateLimitProperties?.rateLimitReset;
          const wait = typeof reset === 'number' ? Math.min(MAX_WAIT_MS, Math.max(0, reset * 1000 - now())) : 2000;
          await sleep(wait);
          continue;
        }
        return {
          ok: false,
          error: {
            code: status === 429 ? 'RATE_LIMITED' : 'INVOKE_FAILED',
            message: status === 429 ? 'Too many requests to the app right now.' : `The app could not be reached (${e?.message ?? 'unknown error'}).`,
            hint: status === 429
              ? 'Wait a minute, then click Retry.'
              : 'Reload the page. If it repeats, a Jira admin can open Jira settings > Apps > Tracebound setup and click Check.',
          },
        };
      }
    }
    return { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests to the app right now.', hint: 'Wait a minute, then click Retry.' } };
  };
}
