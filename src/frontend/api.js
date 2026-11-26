// The one place the frontend talks to the backend: resolver calls through @forge/bridge invoke.
import { invoke } from '@forge/bridge';
import { makeCall, guardConsent } from './lib/api.js';

/**
 * call(key, payload) -> {ok:true, data} | {ok:false, error:{code, message, hint}}. Never throws.
 * When Jira still needs the user's consent, the bridge call fails with the platform consent error
 * (the host can show "Allow access" at that point) and the view gets a NEEDS_CONSENT error that
 * tells the user to reload and allow access, instead of an endless loading spinner.
 */
export const call = guardConsent(makeCall(invoke));
