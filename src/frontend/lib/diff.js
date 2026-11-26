// Word-diff display. The engine sends DiffOp[] = [{op:'eq'|'del'|'ins', text}] where tokens are
// joined by single spaces (punctuation is its own token). This module only tidies spacing and
// decides where a space goes between styled segments.

const NO_SPACE_BEFORE = /^[,.;:!?)\]}%]/;
const NO_SPACE_AFTER = /[([{]$/;

// A hyphen or slash between two words or numbers is shown without spaces ("0.05-unit", "and/or").
// The engine tokenises them as separate tokens and joins tokens with single spaces.
const JOIN_INNER = /([\p{L}\p{N}]) ([-/]) (?=[\p{L}\p{N}])/gu;
const JOIN_TAIL = /([\p{L}\p{N}]) ([-/])$/u;
const JOIN_HEAD = /^([-/]) (?=[\p{L}\p{N}])/u;
const ENDS_JOINER = /[\p{L}\p{N}][-/]$/u;
const STARTS_WORD = /^[\p{L}\p{N}]/u;
const STARTS_JOINER = /^[-/][\p{L}\p{N}]/u;
const ENDS_WORD = /[\p{L}\p{N}]$/u;

/** "units per request ." -> "units per request." ; "( a )" -> "(a)" ; "0.05 - unit" -> "0.05-unit". */
export function tidy(text) {
  return String(text ?? '')
    .replace(/\s+([,.;:!?)\]}%])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(JOIN_INNER, '$1$2')
    .replace(JOIN_INNER, '$1$2') // second pass for chains such as "a - b - c"
    .replace(JOIN_TAIL, '$1$2')
    .replace(JOIN_HEAD, '$1');
}

/**
 * @param {Array<{op:string, text:string}>} ops
 * @returns {Array<{op:'eq'|'del'|'ins', text:string, lead:boolean}>} lead = render a plain space before it
 */
export function diffSegments(ops) {
  const out = [];
  let prev = null;
  for (const o of ops ?? []) {
    const text = tidy(o?.text);
    if (!text) continue;
    const op = o.op === 'del' || o.op === 'ins' ? o.op : 'eq';
    const joined = prev !== null && ((ENDS_JOINER.test(prev) && STARTS_WORD.test(text))
      || (ENDS_WORD.test(prev) && STARTS_JOINER.test(text)));
    const lead = prev !== null && !joined && !NO_SPACE_BEFORE.test(text) && !NO_SPACE_AFTER.test(prev);
    out.push({ op, text, lead });
    prev = text;
  }
  return out;
}

/** Counts of deleted and inserted words, for a one-line summary ("1 word removed, 1 added"). */
export function diffStats(ops) {
  let removed = 0;
  let added = 0;
  for (const o of ops ?? []) {
    const n = String(o?.text ?? '').split(/\s+/).filter(Boolean).length;
    if (o?.op === 'del') removed += n;
    if (o?.op === 'ins') added += n;
  }
  return { removed, added };
}

/** Human field name for a substantive field id. */
export function fieldLabel(fieldId) {
  if (fieldId === 'summary') return 'Summary';
  if (fieldId === 'description') return 'Description';
  return `Field ${fieldId}`;
}

/** Shown instead of a word diff when Jira recorded a field change without its text. */
export const OPAQUE_FIELD_NOTE = 'Jira recorded a change to this field without its text, so Tracebound treats it as a change. Review the issue history.';

/** Is this FieldChange one Jira recorded without its text (the engine sets f.opaque)? */
export function isOpaqueField(f) {
  return !!(f && f.opaque);
}

/**
 * How to show one changed field. An opaque field gets no diff and no word counts (they would
 * only count the placeholder words); its current text is shown when Jira gave it.
 * @returns {{opaque:true, note:string, currentText:string|null}|{opaque:false, stats:{removed:number, added:number}}}
 */
export function fieldChangeView(f, notAvailable = '(text not available)') {
  if (isOpaqueField(f)) {
    const after = typeof f.after === 'string' && f.after && f.after !== notAvailable ? f.after : null;
    return { opaque: true, note: OPAQUE_FIELD_NOTE, currentText: after };
  }
  return { opaque: false, stats: diffStats(f?.diff) };
}

/** One sentence explaining why a link or flag is raised. */
export function changeReasonText(change) {
  if (!change) return '';
  if (change.reason === 'CREATED_AFTER') return 'This item was created after the test last passed, so the test never ran against it.';
  const fields = change.fields ?? [];
  const n = fields.length;
  if (n === 0) return 'Jira recorded a change without its text.';
  const opaque = fields.filter(isOpaqueField).length;
  if (opaque === n) {
    return n === 1
      ? 'Jira recorded a change to one field without its text, so Tracebound treats it as a change.'
      : `Jira recorded changes to ${n} fields without their text, so Tracebound treats them as changes.`;
  }
  const textual = n - opaque;
  const lead = `${textual === 1 ? 'One field' : `${textual} fields`} changed substantively after the reference point.`;
  if (opaque === 0) return lead;
  return `${lead} Jira recorded ${opaque === 1 ? 'a change to one more field' : `changes to ${opaque} more fields`} without the text.`;
}

/** Where the pass time came from, when it is not read directly from the changelog. */
export function passSourceNote(source) {
  if (source === 'statusCategoryChangeDate') return 'Pass time taken from Jira\'s status-category change date (no status history found).';
  if (source === 'created') return 'Pass time taken from the test\'s creation date (no status history found).';
  return null;
}
