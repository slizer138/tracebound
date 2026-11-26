// The only file that imports @forge/kvs. Backend modules receive a store with this shape:
//   get(key) -> value|undefined
//   set(key, value, {ttlMinutes?}) -> void
//   setIfAbsent(key, value) -> {ok:true} | {ok:false, exists:true}   (keyPolicy FAIL_IF_EXISTS)
//   delete(key) -> void
//   batchGet(keys<=25) -> {[key]: value}   (missing keys are absent)
//   queryPrefix(prefix, {limit, cursor}) -> {results:[{key,value}], nextCursor}
import { kvs, WhereConditions } from '@forge/kvs';
import { AppError, CODES } from './errors.js';

function storageError(op, key, e) {
  return new AppError(CODES.STORAGE_ERROR, `Forge storage ${op} failed for "${key}": ${e?.message ?? e}`,
    { hint: 'Check that the app has the storage:app scope (reinstall after a scope change) and try again.' });
}

export function makeKvsStore() {
  return {
    async get(key) {
      try {
        return await kvs.get(key);
      } catch (e) {
        throw storageError('get', key, e);
      }
    },
    async set(key, value, opts = {}) {
      try {
        const o = opts.ttlMinutes ? { ttl: { unit: 'MINUTES', value: opts.ttlMinutes } } : undefined;
        await kvs.set(key, value, o);
      } catch (e) {
        throw storageError('set', key, e);
      }
    },
    async setIfAbsent(key, value) {
      try {
        await kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
        return { ok: true };
      } catch (e) {
        // The exact error code for "key exists" is not documented; confirm by reading the key.
        let existing;
        try {
          existing = await kvs.get(key);
        } catch {
          existing = undefined;
        }
        if (existing !== undefined) return { ok: false, exists: true };
        throw storageError('set (FAIL_IF_EXISTS)', key, e);
      }
    },
    async delete(key) {
      try {
        await kvs.delete(key);
      } catch (e) {
        throw storageError('delete', key, e);
      }
    },
    async batchGet(keys) {
      if (!keys.length) return {};
      try {
        const res = await kvs.batchGet(keys.map((key) => ({ key })));
        const out = {};
        for (const r of res.successfulKeys ?? []) if (r.value !== undefined) out[r.key] = r.value;
        // Partial success: re-read each failed key with get(). A missing key comes back
        // undefined (absent); a real storage error throws STORAGE_ERROR instead of returning a
        // partial map that the audit verifier would report as a broken chain.
        for (const f of res.failedKeys ?? []) {
          const key = f?.key ?? f?.item?.key;
          if (key === undefined) throw new Error(`batchGet reported a failure without a key: ${JSON.stringify(f).slice(0, 200)}`);
          const v = await kvs.get(key);
          if (v !== undefined) out[key] = v;
        }
        return out;
      } catch (e) {
        throw storageError('batchGet', keys[0], e);
      }
    },
    // 20 per page: the KVS query reference states both 100 and 20 as the maximum, so the lower
    // value is used and callers follow the cursor (site check S11 confirms the real cap).
    async queryPrefix(prefix, { limit = 20, cursor } = {}) {
      try {
        let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(limit);
        if (cursor) q = q.cursor(cursor);
        const res = await q.getMany();
        return { results: res.results ?? [], nextCursor: res.nextCursor ?? null };
      } catch (e) {
        throw storageError('query', prefix, e);
      }
    },
  };
}
