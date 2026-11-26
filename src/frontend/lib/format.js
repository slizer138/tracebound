// Pure display formatting for the UI. No React, no @forge imports: unit-tested with node:test.

/** Forge contexts give locales like "en-US" or "en_US"; Intl wants the dash form. */
export function normalizeLocale(locale) {
  const s = String(locale ?? '').replace('_', '-').trim();
  if (!s) return undefined;
  try {
    return Intl.getCanonicalLocales(s)[0];
  } catch {
    return undefined;
  }
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "25 Nov 2026, 10:15" style date and time. Returns "-" for missing or invalid values.
 * @param {number|string|null|undefined} value epoch ms or ISO string
 * @param {{locale?:string, timeZone?:string}} [opts]
 */
export function formatDateTime(value, opts = {}) {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat(normalizeLocale(opts.locale), {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: opts.timeZone,
  }).format(d);
}

/** "10:15" (24-hour). */
export function formatTime(value, opts = {}) {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat(normalizeLocale(opts.locale), {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: opts.timeZone,
  }).format(d);
}

/** First n hex characters of a hash. */
export function shortHash(hash, n = 12) {
  return typeof hash === 'string' && hash ? hash.slice(0, n) : '-';
}

/** Readiness as text; null (no items) shows a dash, never 0%. */
export function pctText(pct) {
  return typeof pct === 'number' && Number.isFinite(pct) ? `${pct}%` : '-';
}

/** ProgressBar value in [0, 1]. */
export function pctValue(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 0;
  return Math.min(1, Math.max(0, pct / 100));
}

/** "1 test", "3 tests". */
export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

/** Normalises a typed project key the way the backend does; returns null when it is not a key. */
export function cleanProjectKey(input) {
  const s = String(input ?? '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,49}$/.test(s) ? s : null;
}

/** Relative Jira path of an issue (relative paths open inside the site, no external URL). */
export function issuePath(key) {
  return `/browse/${encodeURIComponent(key)}`;
}
