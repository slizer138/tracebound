// Error codes shared by resolvers, the queue consumer and Rovo actions.
// Handlers never throw to the UI: they return {ok:false, error:{code, message, hint}}. The one
// exception is the platform consent error (NEEDS_AUTHENTICATION_ERR), which is rethrown.

import { appAccessStep } from './hints.js';

export const CODES = Object.freeze({
  JIRA_PERMISSION: 'JIRA_PERMISSION',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  JIRA_ERROR: 'JIRA_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  VALIDATION: 'VALIDATION',
  STALE: 'STALE',
  FORBIDDEN: 'FORBIDDEN',
  TOO_LARGE: 'TOO_LARGE',
  CONFIG_INVALID: 'CONFIG_INVALID',
  INTERNAL: 'INTERNAL',
});

export class AppError extends Error {
  /**
   * @param {string} code one of CODES
   * @param {string} message
   * @param {{hint?:string, status?:number, retryAfter?:number|null, details?:object}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = extra.hint ?? null;
    this.status = extra.status ?? null;
    this.retryAfter = extra.retryAfter ?? null;
    this.details = extra.details ?? null;
  }
}

/** Collects Jira's errorMessages and errors{} into one readable string. */
export function jiraErrorText(json) {
  if (!json || typeof json !== 'object') return '';
  const parts = [];
  if (Array.isArray(json.errorMessages)) parts.push(...json.errorMessages.filter(Boolean));
  if (json.errors && typeof json.errors === 'object') {
    for (const [k, v] of Object.entries(json.errors)) parts.push(`${k}: ${v}`);
  }
  if (typeof json.message === 'string' && json.message) parts.push(json.message);
  return parts.join('; ');
}

const WHO = { user: 'you', app: 'the app' };

/**
 * Throws an AppError for a non-2xx Jira response. Returns the json otherwise.
 * @param {{ok:boolean, status:number, json:any, retryAfter?:number|null}} res
 * @param {{endpoint:string, permission?:string, as?:'user'|'app', projectKey?:string}} ctx
 */
export function expectOk(res, ctx) {
  if (res.ok) return res.json;
  const who = WHO[ctx.as] ?? 'the caller';
  const detail = jiraErrorText(res.json);
  const suffix = detail ? ` Jira said: ${detail}` : '';
  if (res.status === 401 || res.status === 403) {
    let hint;
    if (ctx.as === 'app') {
      hint = `The app needs ${ctx.permission ?? 'the needed permission'}${ctx.projectKey ? ` in project ${ctx.projectKey}` : ''}. `
        + `${appAccessStep(ctx.projectKey ?? 'the project')} Also check that the app was installed with the read:jira-work and write:jira-work scopes.`;
    } else {
      hint = `Ask a Jira admin for the "${ctx.permission ?? 'needed'}" permission${ctx.projectKey ? ` in project ${ctx.projectKey}` : ''}.`;
    }
    throw new AppError(CODES.JIRA_PERMISSION,
      `Jira returned ${res.status} for ${ctx.endpoint} as ${who}.${suffix}`, { hint, status: res.status });
  }
  if (res.status === 404) {
    throw new AppError(CODES.NOT_FOUND, `Jira returned 404 for ${ctx.endpoint}.${suffix}`,
      { hint: 'Check that the issue or project exists and that you can browse it.', status: 404 });
  }
  if (res.status === 429) {
    throw new AppError(CODES.RATE_LIMITED, `Jira rate-limited ${ctx.endpoint}.`,
      { hint: 'Wait a few seconds and try again.', status: 429, retryAfter: res.retryAfter ?? null });
  }
  if (res.status >= 500 || res.status === 0) {
    throw new AppError(CODES.JIRA_ERROR, `Jira returned ${res.status || 'no response'} for ${ctx.endpoint}.${suffix}`,
      { hint: 'This is usually temporary. Try again in a minute.', status: res.status });
  }
  throw new AppError(CODES.JIRA_ERROR, `Jira returned ${res.status} for ${ctx.endpoint}.${suffix}`,
    { status: res.status, details: res.json ?? null });
}

/** The Forge platform error raised when the user has not yet granted the app access (asUser). */
export const NEEDS_AUTHENTICATION_ERR = 'NEEDS_AUTHENTICATION_ERR';

/** True for @forge/api's NeedsAuthenticationError (matched by name, as @forge/api itself does). */
export function isNeedsAuth(e) {
  return !!e && typeof e === 'object' && e.name === NEEDS_AUTHENTICATION_ERR;
}

/**
 * Turns anything thrown into the {ok:false,error} shape. The one exception: the platform consent
 * error is rethrown, because only the platform can show the "Allow access" prompt.
 */
export function toErrorResult(e) {
  if (isNeedsAuth(e)) throw e;
  if (e instanceof AppError) {
    return { ok: false, error: { code: e.code, message: e.message, hint: e.hint, ...(e.details ? { details: e.details } : {}) } };
  }
  return {
    ok: false,
    error: { code: CODES.INTERNAL, message: `Unexpected error: ${e?.message ?? String(e)}`, hint: 'Click Retry. If it repeats, a Jira admin can open Jira settings > Apps > Tracebound setup and click Check to see which part of the setup fails.' },
  };
}

/**
 * Runs fn and returns {ok:true,data} or {ok:false,error}. Never throws, except the platform
 * consent error (NEEDS_AUTHENTICATION_ERR), which is rethrown so the "Allow access" prompt appears.
 */
export async function toResult(fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isNeedsAuth(e)) throw e;
    return toErrorResult(e);
  }
}
