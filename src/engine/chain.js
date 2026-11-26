// Hash-chained audit records. Tamper-evident (not tamper-proof): editing, deleting or
// reordering a stored record breaks verification.
import { canonicalJson } from './canonical.js';
import { sha256Hex, GENESIS_HASH } from './hash.js';

export const AUDIT_TYPES = Object.freeze([
  'CONFIG_SAVED', 'SEED_STARTED', 'SEED_FINISHED', 'SEED_REMOVED', 'LINK_CLEARED',
  'UPSTREAM_CLEARED', 'REVERIFY_TASK_CREATED', 'BASELINE_FROZEN',
]);

function hashOf(record) {
  const rest = { ...record };
  delete rest.hash;
  return sha256Hex(canonicalJson(rest));
}

/**
 * @param {{seq:number, hash:string}|null} head
 * @param {{projectKey:string, type:string, actor:string|null, subject:object, data:object}} body
 * @param {string} atIso
 */
export function makeAuditRecord(head, body, atIso) {
  if (!AUDIT_TYPES.includes(body?.type)) throw new RangeError(`Unknown audit type ${body?.type}`);
  const rec = {
    v: 1,
    seq: (head?.seq ?? 0) + 1,
    projectKey: body.projectKey,
    type: body.type,
    at: atIso,
    actor: body.actor ?? null,
    subject: body.subject ?? {},
    data: body.data ?? {},
    prevHash: head?.hash ?? GENESIS_HASH,
  };
  return { ...rec, hash: hashOf(rec) };
}

/**
 * @param {object[]} records any order
 * @returns {{ok:boolean, count:number, firstBadSeq:number|null, problem:'GAP'|'HASH_MISMATCH'|'PREV_MISMATCH'|null}}
 */
export function verifyChain(records) {
  const sorted = [...(records ?? [])].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const expectedSeq = i + 1;
    if (r.seq !== expectedSeq) return { ok: false, count: sorted.length, firstBadSeq: expectedSeq, problem: 'GAP' };
    let actual;
    try {
      actual = hashOf(r);
    } catch {
      actual = null;
    }
    if (actual !== r.hash) return { ok: false, count: sorted.length, firstBadSeq: r.seq, problem: 'HASH_MISMATCH' };
    if (r.prevHash !== prev) return { ok: false, count: sorted.length, firstBadSeq: r.seq, problem: 'PREV_MISMATCH' };
    prev = r.hash;
  }
  return { ok: true, count: sorted.length, firstBadSeq: null, problem: null };
}
