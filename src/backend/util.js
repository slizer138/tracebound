// Small helpers with no Forge imports.
import { AppError, CODES } from './errors.js';

/**
 * Tagged template for Jira REST paths: every interpolated value is URI-encoded, the same rule
 * as @forge/api route``. jiraClient.js turns the resulting string into a Route.
 */
export function p(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += encodeURIComponent(String(values[i])) + strings[i + 1];
  return out;
}

/** Appends an encoded query string. Undefined and null values are skipped. */
export function withQuery(path, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{0,49}$/;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,49}-\d{1,10}$/;

/** Validates and upper-cases a project key. Keys are validated before they go into JQL. */
export function checkProjectKey(v, name = 'projectKey') {
  const s = String(v ?? '').trim().toUpperCase();
  if (!PROJECT_KEY_RE.test(s)) throw new AppError(CODES.VALIDATION, `${name} "${v ?? ''}" is not a Jira project key.`, { hint: 'Use the key shown in the project, for example PUMP.' });
  return s;
}

export function checkIssueKey(v, name = 'issueKey') {
  const s = String(v ?? '').trim().toUpperCase();
  if (!ISSUE_KEY_RE.test(s)) throw new AppError(CODES.VALIDATION, `${name} "${v ?? ''}" is not a Jira issue key.`, { hint: 'Use a key like PUMP-7.' });
  return s;
}

export function projectOf(issueKey) {
  return String(issueKey).replace(/-\d+$/, '');
}

/** Quotes a value for JQL: "..." with backslash and double quote escaped. */
export function jqlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function pad10(n) {
  return String(n).padStart(10, '0');
}

export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs fn over items with at most `limit` in flight. Results keep input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Shortens a runId (UUID) to the 8 characters used in labels. */
export function runId8(runId) {
  return String(runId).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
}

export function isoDate(ms) {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}
