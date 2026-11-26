// Changelog analysis: current status, last pass time, substantive changes, fingerprints.
import { tryParseJiraTime } from './time.js';
import { normalizeText, compareKey } from './normalize.js';
import { diffWords } from './diff.js';
import { canonicalJson } from './canonical.js';
import { sha256Hex } from './hash.js';

export const TEXT_NOT_AVAILABLE = '(text not available)';

function idNum(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Histories with parsed times, sorted by (createdMs asc, numeric id asc). Unparseable times are dropped.
 * @param {import('./types.js').ChangeHistory[]|undefined} histories
 * @returns {Array<{h: import('./types.js').ChangeHistory, ms: number, idx: number}>}
 */
export function sortHistories(histories) {
  const out = [];
  (histories ?? []).forEach((h, idx) => {
    const ms = tryParseJiraTime(h?.created);
    if (ms !== null) out.push({ h, ms, idx });
  });
  out.sort((x, y) => x.ms - y.ms || idNum(x.h.id) - idNum(y.h.id) || x.idx - y.idx
    || String(x.h.id).localeCompare(String(y.h.id)));
  return out;
}

function isStatusItem(item) {
  return item?.fieldId === 'status' || (!item?.fieldId && item?.field === 'status');
}

function itemMatches(item, fieldId) {
  if (item?.fieldId) return item.fieldId === fieldId;
  return item?.field === fieldId;
}

/** Created time of an issue in ms (0 if missing or unparseable). */
export function issueCreatedMs(issue) {
  return tryParseJiraTime(issue?.fields?.created) ?? 0;
}

/**
 * The status the issue is in now: the 'to' of the newest status change in the changelog
 * (fresher than the search index), else fields.status.id.
 * @returns {string}
 */
export function currentStatusId(issue, histories) {
  const sorted = sortHistories(histories);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const items = sorted[i].h.items ?? [];
    for (let k = items.length - 1; k >= 0; k--) {
      if (isStatusItem(items[k]) && items[k].to !== null && items[k].to !== undefined) return String(items[k].to);
    }
  }
  return String(issue?.fields?.status?.id ?? '');
}

/**
 * Category of the current status: statusCatById, else the issue's own status category
 * (only when the search result shows the same status id as the changelog), else 'new'.
 * An unknown status that differs from the search result is treated as not done, so a test
 * moved out of its passed status is never shown as verified because of index lag.
 * @returns {import('./types.js').StatusCat}
 */
export function currentStatusCat(issue, histories, statusCatById) {
  const id = currentStatusId(issue, histories);
  const known = statusCatById?.[id];
  if (known) return known;
  if (String(issue?.fields?.status?.id ?? '') !== id) return 'new';
  const ownCat = issue?.fields?.status?.statusCategory?.key;
  if (ownCat === 'new' || ownCat === 'indeterminate' || ownCat === 'done') return ownCat;
  return 'new';
}

/**
 * When the test last entered a Done-category status.
 * @returns {{at:number|null, source:'changelog'|'statusCategoryChangeDate'|'created'|null}}
 */
export function lastPassedAt(issue, histories, statusCatById) {
  if (currentStatusCat(issue, histories, statusCatById) !== 'done') return { at: null, source: null };
  const sorted = sortHistories(histories);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const items = sorted[i].h.items ?? [];
    // Unknown status ids (not in statusCatById) are ignored here.
    if (items.some((it) => isStatusItem(it) && statusCatById?.[String(it.to)] === 'done')) {
      return { at: sorted[i].ms, source: 'changelog' };
    }
  }
  const sccd = tryParseJiraTime(issue?.fields?.statuscategorychangedate);
  if (sccd !== null) return { at: sccd, source: 'statusCategoryChangeDate' };
  return { at: issueCreatedMs(issue), source: 'created' };
}

/**
 * An item's OWN value for key, or null. Changelog items are plain objects, so a missing
 * "toString" key would otherwise resolve to Object.prototype.toString.
 */
function own(item, key) {
  if (!item || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, key)) return null;
  const v = item[key];
  return v === undefined ? null : v;
}

/** An item's own text value (fromString/toString), or null when it is absent or not a string. */
function str(item, key) {
  const v = own(item, key);
  return typeof v === 'string' ? v : null;
}

/**
 * A substantive-field item without rendered text on either side. It is treated as a change
 * (conservative) unless the raw values are both present and identical, which is positive
 * evidence that nothing changed. An item whose four values are all null is therefore a change:
 * Jira may record rich-text (ADF) description edits that way (site check S6).
 */
function isOpaque(item) {
  if (str(item, 'fromString') !== null || str(item, 'toString') !== null) return false;
  const from = own(item, 'from');
  const to = own(item, 'to');
  const sameRaw = from !== null && to !== null && String(from) === String(to);
  return !sameRaw;
}

/**
 * Was the issue substantively changed at or after sinceMs (a tie counts as after)?
 * @param {import('./types.js').JiraIssue} issue
 * @param {import('./types.js').ChangeHistory[]} histories
 * @param {number} sinceMs
 * @param {string[]} fieldIds
 * @param {{allowCreatedAfter?: boolean}} [opts]
 * @returns {import('./types.js').ChangeSet}
 */
export function substantiveChangeSince(issue, histories, sinceMs, fieldIds, opts = {}) {
  const allowCreatedAfter = opts.allowCreatedAfter !== false;
  const createdMs = issueCreatedMs(issue);
  const fields = fieldChangesSince(histories, sinceMs, fieldIds);
  if (allowCreatedAfter && createdMs > sinceMs) {
    // The issue did not exist when the test passed. Its later edits are still collected, so they
    // enter the fingerprint (a clearance goes stale when the text changes again) and the diff.
    const latest = fields.length ? Math.max(createdMs, ...fields.map((f) => f.changedAt)) : createdMs;
    return { changed: true, reason: 'CREATED_AFTER', fields, latestAt: latest };
  }
  if (fields.length === 0) return { changed: false, reason: 'NONE', fields: [], latestAt: null };
  return {
    changed: true,
    reason: 'TEXT_CHANGED',
    fields,
    latestAt: Math.max(...fields.map((f) => f.changedAt)),
  };
}

/** FieldChange entries for histories at or after sinceMs (a tie counts as after). */
function fieldChangesSince(histories, sinceMs, fieldIds) {
  const sorted = sortHistories(histories).filter((x) => x.ms >= sinceMs);
  const fields = [];
  for (const fieldId of fieldIds ?? []) {
    const hits = [];
    for (const x of sorted) {
      for (const item of x.h.items ?? []) {
        if (itemMatches(item, fieldId)) hits.push({ x, item });
      }
    }
    if (hits.length === 0) continue;
    const first = hits[0];
    const last = hits[hits.length - 1];
    const opaque = hits.some((hit) => isOpaque(hit.item));
    let before;
    let after;
    let diff;
    let opaqueRef;
    if (opaque) {
      before = TEXT_NOT_AVAILABLE;
      const lastText = str(last.item, 'toString');
      after = lastText === null ? TEXT_NOT_AVAILABLE : normalizeText(lastText);
      diff = [{ op: 'del', text: before }, { op: 'ins', text: after }];
      // The rendered text is unknown, so identify this exact change by its raw value and
      // history id; any later opaque change produces a different fingerprint.
      const rawTo = own(last.item, 'to');
      opaqueRef = { rawTo: rawTo === null ? null : String(rawTo), historyId: String(last.x.h.id) };
    } else {
      before = normalizeText(str(first.item, 'fromString'));
      after = normalizeText(str(last.item, 'toString'));
      // Formatting-only change, whitespace-only change or net revert: same tokens, empty diff.
      if (compareKey(before) === compareKey(after)) continue;
      diff = diffWords(before, after);
    }
    fields.push({
      fieldId,
      before,
      after,
      diff,
      changedAt: last.x.ms,
      changedBy: last.x.h.author?.accountId ?? null,
      historyIds: [...new Set(hits.map((hit) => String(hit.x.h.id)))],
      ...(opaqueRef ? { opaque: opaqueRef } : {}),
    });
  }
  return fields;
}

/**
 * When the issue's CURRENT substantive text came into being, or null when its current text is the
 * text it had before any recorded edit. This compares net text, as the link rule does: an edit
 * that a later edit reverts (a typo that is fixed, A -> B -> A) does not count, so a control
 * cannot hide an upstream requirement change by editing and reverting itself.
 *
 * Per field, the text after each history is tracked (normalised). The field's version start is
 * the first history after which the field held its current text, or null when the current text
 * equals the text before the first edit. An opaque item (no rendered text) starts a new, unique
 * version (conservative). The result is the latest version start over all fields.
 * @returns {number|null}
 */
export function latestSubstantiveEditMs(histories, fieldIds) {
  const sorted = sortHistories(histories);
  let latest = null;
  for (const fieldId of fieldIds ?? []) {
    /** @type {Array<{ms:number, state:string}>} */
    const states = [];
    let initial;
    for (const x of sorted) {
      let after;
      for (const item of x.h.items ?? []) {
        if (!itemMatches(item, fieldId)) continue;
        const opaque = isOpaque(item);
        if (initial === undefined) {
          initial = opaque ? '\u0000opaque:initial' : `t:${compareKey(str(item, 'fromString'))}`;
        }
        after = opaque ? `\u0000opaque:${x.idx}:${String(x.h.id)}` : `t:${compareKey(str(item, 'toString'))}`;
      }
      if (after !== undefined) states.push({ ms: x.ms, state: after });
    }
    if (states.length === 0) continue;
    const current = states[states.length - 1].state;
    if (initial === current) continue; // net revert to the original text: no own edit
    const start = states.find((s) => s.state === current).ms;
    if (latest === null || start > latest) latest = start;
  }
  return latest;
}

/**
 * Stable identity of one specific change: a clearance is valid only for this exact fingerprint.
 * @param {{kind:string, downKey:string, upKey:string, sinceMs:number, fields:import('./types.js').FieldChange[], reason:string}} parts
 * @returns {string}
 */
export function fingerprint(parts) {
  return sha256Hex(canonicalJson({
    v: 1,
    kind: parts.kind,
    down: parts.downKey,
    up: parts.upKey,
    since: parts.sinceMs,
    reason: parts.reason,
    // opaque is undefined for ordinary text changes and is then dropped by canonicalJson, so
    // fingerprints of text changes are unchanged by this field.
    fields: (parts.fields ?? []).map((f) => ({ id: f.fieldId, after: f.after, opaque: f.opaque })),
  }));
}

