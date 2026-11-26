// Frozen, hashed snapshots of the trace matrix for a release.
import { ENGINE_VERSION } from './types.js';
import { canonicalJson } from './canonical.js';
import { sha256Hex } from './hash.js';
import { normalizeText } from './normalize.js';
import { adfToText } from './adf.js';
import { compareKeys } from './graph.js';

/**
 * Hash of an issue's substantive text (normalised summary + ADF description).
 * @param {string} summary
 * @param {object|null} descriptionAdf
 */
export function itemTextHash(summary, descriptionAdf) {
  return sha256Hex(normalizeText(summary) + '\n' + normalizeText(adfToText(descriptionAdf)));
}

/**
 * @param {ReturnType<import('./trace.js').computeTrace>} trace  computed WITHOUT onlyGaps
 * @param {{projectKey:string, name:string, release:string|null, createdAtIso:string, createdBy:string|null,
 *   textHashes:Object<string,string>, auditHead?:{seq:number, hash:string}|null, sample?:boolean}} meta
 */
export function buildBaseline(trace, meta) {
  const { textHashes = {}, ...rest } = meta;
  const payload = {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    ...rest,
    release: meta.release ?? null,
    readiness: trace.readiness,
    kpis: trace.kpis,
    items: trace.items.map((i) => ({
      key: i.key,
      role: i.role,
      summary: i.summary,
      state: i.state,
      textHash: textHashes[i.key] ?? null,
      tests: trace.links
        .filter((l) => l.itemKey === i.key)
        .map((l) => ({ key: l.testKey, state: l.state, passedAt: l.passedAt })),
    })),
    upstream: trace.upstream.map((u) => ({ ctrlKey: u.ctrlKey, reqKey: u.reqKey, state: u.state })),
  };
  const json = canonicalJson(payload);
  return { payload, json, hash: sha256Hex(json) };
}

/**
 * @param {string} json
 * @param {number} [size]
 * @returns {string[]}
 */
export function splitChunks(json, size = 200000) {
  if (!(size > 0)) throw new RangeError('chunk size must be positive');
  // size is in UTF-8 BYTES, because the KVS value limit (240 KiB) is in bytes and canonical
  // JSON keeps non-ASCII characters raw (a CJK character is 3 bytes). Chunks never split a
  // code point; a single code point larger than size gets a chunk of its own.
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of json) {
    const cp = ch.codePointAt(0);
    const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (curBytes + b > size && cur) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** UTF-8 byte length of a string (no Buffer, so the engine stays runtime-neutral). */
export function utf8Length(str) {
  let n = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** @param {string[]} chunks */
export function joinChunks(chunks) {
  return (chunks ?? []).join('');
}

/**
 * Re-hashes a stored baseline payload (as joined JSON) and compares it with the recorded hash.
 * @param {string} json
 * @param {string} expectedHash
 */
export function verifyBaselineJson(json, expectedHash) {
  const actual = sha256Hex(json);
  let canonical = false;
  try {
    canonical = canonicalJson(JSON.parse(json)) === json;
  } catch {
    canonical = false;
  }
  return { ok: actual === expectedHash && canonical, actual, expected: expectedHash, canonical };
}

/**
 * Differences between two baseline payloads (older a, newer b).
 */
export function compareBaselines(a, b) {
  const ai = new Map((a?.items ?? []).map((i) => [i.key, i]));
  const bi = new Map((b?.items ?? []).map((i) => [i.key, i]));
  const added = [...bi.keys()].filter((k) => !ai.has(k)).sort(compareKeys);
  const removed = [...ai.keys()].filter((k) => !bi.has(k)).sort(compareKeys);
  const stateChanged = [];
  const textChanged = [];
  const testChanges = [];
  for (const k of [...bi.keys()].filter((x) => ai.has(x)).sort(compareKeys)) {
    const x = ai.get(k);
    const y = bi.get(k);
    if (x.state !== y.state) stateChanged.push({ key: k, from: x.state, to: y.state });
    if (x.textHash !== y.textHash) textChanged.push(k);
    const xt = new Map(x.tests.map((t) => [t.key, t.state]));
    const yt = new Map(y.tests.map((t) => [t.key, t.state]));
    for (const t of new Set([...xt.keys(), ...yt.keys()])) {
      if (xt.get(t) !== yt.get(t)) testChanges.push({ itemKey: k, testKey: t, from: xt.get(t) ?? null, to: yt.get(t) ?? null });
    }
  }
  testChanges.sort((p, q) => compareKeys(p.itemKey, q.itemKey) || compareKeys(p.testKey, q.testKey));
  const pa = a?.readiness?.pct ?? null;
  const pb = b?.readiness?.pct ?? null;
  return {
    added,
    removed,
    stateChanged,
    textChanged,
    testChanges,
    readiness: { from: pa, to: pb, delta: pa === null || pb === null ? null : pb - pa },
  };
}
