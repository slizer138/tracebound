// Append-only, hash-chained audit log in KVS.
//   audit:{p}:head            {seq, hash}  (a hint; readers probe forward)
//   audit:{p}:{seq 10 digits} AuditRecord, written with keyPolicy FAIL_IF_EXISTS
// The FAIL_IF_EXISTS write is the concurrency lock: two writers racing for the same seq cannot
// both succeed, and the loser re-reads and retries on top of the winner.
import { GENESIS_HASH, makeAuditRecord, verifyChain } from '../engine/index.js';
import { AppError, CODES } from './errors.js';
import { K } from './keys.js';
import { chunk } from './util.js';

const MAX_PROBES = 25;
const MAX_ATTEMPTS = 5;

/** Reads the head hint, then probes seq+1.. until a key is missing. */
export async function readHead(store, projectKey) {
  const hint = (await store.get(K.auditHead(projectKey))) ?? { seq: 0, hash: GENESIS_HASH };
  let head = { seq: hint.seq, hash: hint.hash };
  for (let i = 0; i < MAX_PROBES; i++) {
    const next = await store.get(K.audit(projectKey, head.seq + 1));
    if (!next) break;
    head = { seq: next.seq, hash: next.hash };
  }
  return head;
}

/**
 * @param {object} store
 * @param {string} projectKey
 * @param {{type:string, actor:string|null, subject:object, data:object}} body
 * @param {string} nowIso
 */
export async function appendAudit(store, projectKey, body, nowIso) {
  let head = await readHead(store, projectKey);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rec = makeAuditRecord(head.seq === 0 ? null : head, { ...body, projectKey }, nowIso);
    const res = await store.setIfAbsent(K.audit(projectKey, rec.seq), rec);
    if (res.ok) {
      try {
        await store.set(K.auditHead(projectKey), { seq: rec.seq, hash: rec.hash });
      } catch {
        // The head is only a hint; readers probe forward from it.
      }
      return rec;
    }
    const winner = await store.get(K.audit(projectKey, rec.seq));
    head = winner ? { seq: winner.seq, hash: winner.hash } : await readHead(store, projectKey);
  }
  throw new AppError(CODES.STORAGE_ERROR, 'Could not append to the audit log after 5 attempts (concurrent writes).',
    { hint: 'Try again.' });
}

/**
 * Newest first. beforeSeq is exclusive.
 * @returns {Promise<{records:object[], headSeq:number, nextBeforeSeq:number|null}>}
 */
export async function listAudit(store, projectKey, { beforeSeq, limit = 25 } = {}) {
  const head = await readHead(store, projectKey);
  const n = Math.max(1, Math.min(25, Number(limit) || 25));
  const start = beforeSeq ? Math.min(head.seq, Number(beforeSeq) - 1) : head.seq;
  if (start < 1) return { records: [], headSeq: head.seq, nextBeforeSeq: null };
  const end = Math.max(1, start - n + 1);
  const keys = [];
  for (let s = start; s >= end; s--) keys.push(K.audit(projectKey, s));
  const got = await store.batchGet(keys);
  const records = keys.map((k) => got[k]).filter(Boolean);
  return { records, headSeq: head.seq, nextBeforeSeq: end > 1 ? end : null };
}

export async function readAuditRecord(store, projectKey, seq) {
  return (await store.get(K.audit(projectKey, seq))) ?? null;
}

/** Reads the whole chain in batches of 25 and verifies it. */
export async function verifyAudit(store, projectKey) {
  const head = await readHead(store, projectKey);
  const seqs = Array.from({ length: head.seq }, (_, i) => i + 1);
  const records = [];
  for (const group of chunk(seqs, 25)) {
    const keys = group.map((s) => K.audit(projectKey, s));
    const got = await store.batchGet(keys);
    for (const k of keys) if (got[k]) records.push(got[k]);
  }
  const result = verifyChain(records);
  if (result.ok && records.length < head.seq) {
    // The newest records are missing (verifyChain cannot see a gap at the end).
    return { ok: false, count: records.length, firstBadSeq: records.length + 1, problem: 'GAP', headSeq: head.seq };
  }
  // verifyChain only checks the links between records, so a rewritten NEWEST record with a
  // recomputed hash still forms a valid chain. The stored head hint is written with the hash of
  // the record at its seq (after that record), so when it points at the newest record it must
  // carry that record's hash. (Older records are covered by the next record's prevHash.)
  const hint = await store.get(K.auditHead(projectKey));
  const last = records[records.length - 1];
  if (result.ok && hint && last && hint.seq === last.seq) {
    if (hint.hash !== last.hash) {
      return { ok: false, count: records.length, firstBadSeq: hint.seq, problem: 'HASH_MISMATCH', headSeq: head.seq };
    }
  }
  return { ...result, headSeq: head.seq, headHash: head.hash };
}
