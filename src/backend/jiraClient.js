// The only file that imports @forge/api. All other backend code receives a client with
// {mode, get, post, put, del}, each returning {ok, status, json, retryAfter} and never throwing
// on an HTTP status. The one exception is the platform consent error (NEEDS_AUTHENTICATION_ERR),
// which is rethrown. Paths are built with util.p`` (values URI-encoded, as route`` does).
import api, { assumeTrustedRoute } from '@forge/api';
import { isNeedsAuth } from './errors.js';

function parseRetryAfter(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : null;
}

/**
 * @param {'user'|'app'} mode
 */
export function makeJira(mode) {
  const requester = () => (mode === 'app' ? api.asApp() : api.asUser());
  async function call(method, path, body) {
    const init = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    try {
      const res = await requester().requestJira(assumeTrustedRoute(path), init);
      const text = await res.text();
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { message: text.slice(0, 500) };
        }
      }
      return { ok: res.ok, status: res.status, json, retryAfter: parseRetryAfter(res.headers?.get?.('Retry-After')) };
    } catch (e) {
      // The user has not granted the app access yet. @forge/api throws NeedsAuthenticationError
      // (name NEEDS_AUTHENTICATION_ERR); it must leave the function so the platform can show the
      // "Allow access" prompt. Checked by name so test fakes need no @forge/api.
      if (isNeedsAuth(e)) throw e;
      // Network or platform error (for example asUser() without a user context).
      return { ok: false, status: 0, json: { message: String(e?.message ?? e) }, retryAfter: null };
    }
  }
  return {
    mode,
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
    put: (path, body) => call('PUT', path, body ?? {}),
    del: (path) => call('DELETE', path),
  };
}
