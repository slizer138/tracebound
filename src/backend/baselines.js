// Frozen, hashed baselines of the trace matrix.
//   bl:{p}:index           {items:[BaselineMeta]} (max 200)
//   bl:{p}:{id}:{chunkNo}  string chunks of the canonical JSON payload
import {
  buildBaseline, splitChunks, joinChunks, verifyBaselineJson, itemTextHash,
} from '../engine/index.js';
import { AppError, CODES } from './errors.js';
import { K } from './keys.js';
import { appendAudit, readHead, readAuditRecord } from './audit.js';
import { loadProjectTrace } from './traceService.js';

export const MAX_BASELINES = 200;
// UTF-8 bytes per chunk. The KVS value limit is 240 KiB (245,760 bytes). A chunk is stored as a
// JSON string, and escaping can at most double it (every quote or backslash gains one byte), so
// 120,000 raw bytes stays under the limit in the worst case.
export const CHUNK_SIZE = 120000;

export async function listBaselines(store, projectKey) {
  const idx = await store.get(K.baselineIndex(projectKey));
  return [...(idx?.items ?? [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * @param {{jira:object, store:object, now:()=>Date}} deps
 * @param {{projectKey:string, name:string, release?:string|null, actor:string|null, sample?:boolean, reconcileIssueIds?:string[]}} args
 */
export async function freezeBaseline(deps, args) {
  const name = String(args.name ?? '').trim();
  if (name.length < 1 || name.length > 80) {
    throw new AppError(CODES.VALIDATION, 'A baseline name of 1 to 80 characters is required.');
  }
  const { store } = deps;
  const projectKey = args.projectKey;
  const idx = (await store.get(K.baselineIndex(projectKey))) ?? { items: [] };
  if (idx.items.length >= MAX_BASELINES) {
    throw new AppError(CODES.TOO_LARGE, `This project already has ${MAX_BASELINES} baselines, the maximum.`,
      { hint: 'Older baselines are kept for audit and are not removed automatically.' });
  }
  const release = args.release ? String(args.release) : null;
  const { trace, snapshot, info } = await loadProjectTrace(deps, projectKey, {
    release, includeDescription: true, reconcileIssueIds: args.reconcileIssueIds,
  });
  const textHashes = {};
  const byKey = new Map(snapshot.issues.map((i) => [i.key, i]));
  for (const it of trace.items) {
    const issue = byKey.get(it.key);
    textHashes[it.key] = itemTextHash(issue?.fields?.summary ?? '', issue?.fields?.description ?? null);
  }
  const now = deps.now();
  const createdAtIso = now.toISOString();
  const auditHead = await readHead(store, projectKey);
  const built = buildBaseline(trace, {
    projectKey, name, release, createdAtIso, createdBy: args.actor ?? null, textHashes,
    auditHead, sample: !!args.sample,
  });
  const id = `${now.getTime().toString(36)}${built.hash.slice(0, 6)}`;
  const chunks = splitChunks(built.json, CHUNK_SIZE);
  for (let n = 0; n < chunks.length; n++) await store.set(K.baselineChunk(projectKey, id, n), chunks[n]);
  // The audit record comes before the index entry so the index can carry its auditSeq.
  const rec = await appendAudit(store, projectKey, {
    type: 'BASELINE_FROZEN',
    actor: args.actor ?? null,
    subject: { baselineId: id, name, release },
    data: { hash: built.hash, readinessPct: trace.readiness.pct, items: trace.items.length, sample: !!args.sample },
  }, createdAtIso);
  const meta = {
    id, name, release, createdAt: createdAtIso, createdBy: args.actor ?? null,
    readinessPct: trace.readiness.pct, hash: built.hash, chunks: chunks.length, auditSeq: rec.seq, sample: !!args.sample,
  };
  const fresh = (await store.get(K.baselineIndex(projectKey))) ?? { items: [] };
  await store.set(K.baselineIndex(projectKey), { items: [...fresh.items.filter((b) => b.id !== id), meta] });
  return { meta, trace, info };
}

async function findMeta(store, projectKey, id) {
  const items = await listBaselines(store, projectKey);
  const meta = items.find((b) => b.id === id);
  if (!meta) throw new AppError(CODES.NOT_FOUND, `Baseline ${id} was not found.`);
  return meta;
}

async function readJson(store, projectKey, meta) {
  const keys = Array.from({ length: meta.chunks }, (_, n) => K.baselineChunk(projectKey, meta.id, n));
  const chunks = [];
  for (let i = 0; i < keys.length; i += 25) {
    const got = await store.batchGet(keys.slice(i, i + 25));
    for (const k of keys.slice(i, i + 25)) chunks.push(got[k] ?? null);
  }
  if (chunks.some((c) => c === null)) return null;
  return joinChunks(chunks);
}

export async function getBaseline(store, projectKey, id) {
  const meta = await findMeta(store, projectKey, id);
  const json = await readJson(store, projectKey, meta);
  if (json === null) throw new AppError(CODES.STORAGE_ERROR, `Baseline ${id} is incomplete in storage.`);
  return { meta, payload: JSON.parse(json) };
}

/** Re-hashes the stored payload; compares with the index hash and the audit record's hash. */
export async function verifyBaseline(store, projectKey, id) {
  const meta = await findMeta(store, projectKey, id);
  const json = await readJson(store, projectKey, meta);
  if (json === null) return { ok: false, meta, problem: 'MISSING_CHUNKS', actual: null };
  const v = verifyBaselineJson(json, meta.hash);
  const rec = meta.auditSeq ? await readAuditRecord(store, projectKey, meta.auditSeq) : null;
  const auditMatches = !!rec && rec.type === 'BASELINE_FROZEN' && rec.data?.hash === v.actual;
  return {
    ok: v.ok && auditMatches,
    meta,
    actual: v.actual,
    expected: meta.hash,
    canonical: v.canonical,
    auditMatches,
    problem: !v.ok ? 'HASH_MISMATCH' : !auditMatches ? 'AUDIT_MISMATCH' : null,
  };
}
