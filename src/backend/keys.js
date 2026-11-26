// KVS key builders. Keys must match /^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/ and be at most 500 chars;
// project and issue keys are validated (letters, digits, _ and -) before they reach here.
import { pad10 } from './util.js';

export const K = Object.freeze({
  config: (p) => `cfg:proj:${p}`,
  configPrefix: 'cfg:proj:',
  statuses: 'cache:statuses',
  health: (id) => `health:${id}`,
  seedProj: (p) => `seed:proj:${p}`,
  seedRun: (runId) => `seed:run:${runId}`,
  clearance: (p, kind, down, up) => `clr:${p}:${kind}:${down}:${up}`,
  clearancePrefix: (p) => `clr:${p}:`,
  reverify: (p, down, up) => `rv:${p}:${down}:${up}`,
  reverifyPrefix: (p) => `rv:${p}:`,
  auditHead: (p) => `audit:${p}:head`,
  audit: (p, seq) => `audit:${p}:${pad10(seq)}`,
  baselineIndex: (p) => `bl:${p}:index`,
  baselineChunk: (p, id, n) => `bl:${p}:${id}:${n}`,
});

export const KEY_RE = /^(?!\s+$)[a-zA-Z0-9:._\s\-#]+$/;

/**
 * Reads every value under a prefix, following cursors (capped at 5,000 values). Pages hold 20,
 * the lower of the two maxima the KVS query reference states.
 */
export const QUERY_PAGE = 20;
export async function queryAll(store, prefix, { limit = QUERY_PAGE, maxPages = 250 } = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await store.queryPrefix(prefix, { limit, cursor });
    out.push(...page.results);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}
