// Jira timestamp parsing. Jira returns "2026-11-25T10:15:30.123+0000".

const ISO_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Parses a Jira or ISO-8601 timestamp to epoch milliseconds.
 * Accepts "+0000", "+00:00", "Z" and forms without milliseconds or seconds.
 * @param {string} s
 * @returns {number}
 * @throws {RangeError} on anything else
 */
export function parseJiraTime(s) {
  if (typeof s !== 'string') throw new RangeError(`Not a timestamp: ${String(s)}`);
  // Normalise "+hhmm" to "+hh:mm" explicitly instead of relying on engine leniency.
  const t = s.trim().replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3');
  const m = ISO_RE.exec(t);
  if (!m) throw new RangeError(`Not a timestamp: ${s}`);
  const secs = m[2] ?? '00';
  const frac = ((m[3] ?? '') + '000').slice(0, 3);
  const ms = Date.parse(`${m[1]}:${secs}.${frac}${m[4]}`);
  if (Number.isNaN(ms)) throw new RangeError(`Not a timestamp: ${s}`);
  return ms;
}

// Epoch values below this are seconds, at or above it milliseconds. 1e12 ms is 2001-09-09;
// 1e12 s is about the year 33658, so the two ranges cannot be confused for real Jira data.
const SECONDS_LIMIT = 1e12;

/**
 * Epoch seconds or milliseconds (a number, or a string of 9 to 13 digits) to epoch ms, or null.
 * The Jira v3 OpenAPI example for POST /rest/api/3/changelog/bulkfetch shows "created" as a
 * number (1492070429, seconds), while the per-issue changelog returns ISO strings.
 * @param {unknown} v
 * @returns {number|null}
 */
export function epochToMs(v) {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d{9,13}$/.test(v.trim())) n = Number(v.trim());
  // Below 1e8 (seconds: 1973) a value is not a plausible Jira change time.
  if (n === null || !Number.isFinite(n) || n < 1e8) return null;
  return n < SECONDS_LIMIT ? Math.round(n * 1000) : Math.round(n);
}

/**
 * Like parseJiraTime but returns null instead of throwing. Also accepts epoch seconds or
 * milliseconds (see epochToMs); parseJiraTime itself stays strict.
 * @param {unknown} s
 * @returns {number|null}
 */
export function tryParseJiraTime(s) {
  const epoch = epochToMs(s);
  if (epoch !== null) return epoch;
  try {
    return parseJiraTime(/** @type {string} */ (s));
  } catch {
    return null;
  }
}

/**
 * Formats epoch ms the way Jira does: 2026-11-25T10:15:30.123+0000 (UTC).
 * @param {number} ms
 * @returns {string}
 */
export function toJiraTime(ms) {
  return new Date(ms).toISOString().replace('Z', '+0000');
}
