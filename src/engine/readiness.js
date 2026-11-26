// Release readiness: the share of requirements and risk controls in state READY.

/**
 * Percentage of n out of total, rounded to the nearest whole number, except that 100 is shown
 * only when n equals total (199 of 200 is 99, not 100) and 0 only when n is 0 (1 of 300 is 1).
 * Null when total is 0.
 * @param {number} n
 * @param {number} total
 * @returns {number|null}
 */
export function pctOf(n, total) {
  if (total === 0) return null;
  if (n >= total) return 100;
  if (n <= 0) return 0;
  return Math.max(1, Math.min(99, Math.round((100 * n) / total)));
}

/**
 * @param {import('./types.js').ItemResult[]} items
 * @returns {import('./types.js').Readiness}
 */
export function readiness(items) {
  const total = (items ?? []).length;
  const ready = (items ?? []).filter((i) => i.state === 'READY').length;
  return { ready, total, pct: pctOf(ready, total) };
}
