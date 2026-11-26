// B5 and hash-chain verification over the storage layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeStore } from './fakes.js';
import { appendAudit, listAudit, verifyAudit, readHead } from '../../src/backend/audit.js';
import { K } from '../../src/backend/keys.js';
import { GENESIS_HASH } from '../../src/engine/index.js';

const body = (i) => ({ type: 'LINK_CLEARED', actor: 'u', subject: { downKey: `P-${i}`, upKey: 'P-1' }, data: { reason: `reason number ${i}` } });
const AT = '2026-12-01T10:00:00.000Z';

test('B5 two appends racing for the same seq get seq 1 and 2 and a valid chain', async () => {
  const store = makeFakeStore();
  const [a, b] = await Promise.all([appendAudit(store, 'P', body(1), AT), appendAudit(store, 'P', body(2), AT)]);
  assert.deepEqual([a.seq, b.seq].sort(), [1, 2]);
  assert.ok(store.stats.setIfAbsentConflicts >= 1, 'the race really happened');
  const v = await verifyAudit(store, 'P');
  assert.deepEqual({ ok: v.ok, count: v.count }, { ok: true, count: 2 });
  const first = a.seq === 1 ? a : b;
  const second = a.seq === 1 ? b : a;
  assert.equal(first.prevHash, GENESIS_HASH);
  assert.equal(second.prevHash, first.hash);
});

test('five concurrent appends stay contiguous', async () => {
  const store = makeFakeStore();
  const recs = await Promise.all([1, 2, 3, 4, 5].map((i) => appendAudit(store, 'P', body(i), AT)));
  assert.deepEqual(recs.map((r) => r.seq).sort(), [1, 2, 3, 4, 5]);
  assert.equal((await verifyAudit(store, 'P')).ok, true);
});

test('a stale head hint is corrected by probing forward', async () => {
  const store = makeFakeStore();
  for (let i = 1; i <= 3; i++) await appendAudit(store, 'P', body(i), AT);
  await store.set(K.auditHead('P'), { seq: 1, hash: 'x' });
  assert.equal((await readHead(store, 'P')).seq, 3);
  const r = await appendAudit(store, 'P', body(4), AT);
  assert.equal(r.seq, 4);
  assert.equal((await verifyAudit(store, 'P')).ok, true);
});

test('listAudit pages newest first with beforeSeq', async () => {
  const store = makeFakeStore();
  for (let i = 1; i <= 30; i++) await appendAudit(store, 'P', body(i), AT);
  const p1 = await listAudit(store, 'P', { limit: 25 });
  assert.equal(p1.records.length, 25);
  assert.equal(p1.records[0].seq, 30);
  assert.equal(p1.nextBeforeSeq, 6);
  const p2 = await listAudit(store, 'P', { beforeSeq: p1.nextBeforeSeq });
  assert.deepEqual(p2.records.map((r) => r.seq), [5, 4, 3, 2, 1]);
  assert.equal(p2.nextBeforeSeq, null);
  assert.deepEqual((await listAudit(makeFakeStore(), 'P')).records, []);
});

test('tampering with a stored record is detected (HASH_MISMATCH)', async () => {
  const store = makeFakeStore();
  for (let i = 1; i <= 30; i++) await appendAudit(store, 'P', body(i), AT);
  const k = K.audit('P', 27);
  const rec = store.map.get(k);
  store.map.set(k, { ...rec, data: { reason: 'edited later' } });
  assert.deepEqual(await verifyAudit(store, 'P').then((v) => [v.ok, v.firstBadSeq, v.problem]), [false, 27, 'HASH_MISMATCH']);
});

test('deleting a record is detected (GAP), including the newest one', async () => {
  const store = makeFakeStore();
  for (let i = 1; i <= 5; i++) await appendAudit(store, 'P', body(i), AT);
  store.map.delete(K.audit('P', 3));
  let v = await verifyAudit(store, 'P');
  assert.deepEqual([v.ok, v.firstBadSeq, v.problem], [false, 3, 'GAP']);
  const s2 = makeFakeStore();
  for (let i = 1; i <= 5; i++) await appendAudit(s2, 'P', body(i), AT);
  s2.map.delete(K.audit('P', 5));
  v = await verifyAudit(s2, 'P');
  assert.deepEqual([v.ok, v.firstBadSeq, v.problem], [false, 5, 'GAP']);
});

test('audit records are written with FAIL_IF_EXISTS semantics, never overwritten', async () => {
  const store = makeFakeStore();
  await appendAudit(store, 'P', body(1), AT);
  const writes = store.ops.filter(([, k]) => k.startsWith('audit:P:0'));
  assert.deepEqual(writes, [['setIfAbsent', K.audit('P', 1)]]);
});
