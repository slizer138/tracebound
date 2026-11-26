// Sample-data seeder. startSeed/startRemove run in a resolver (as the user: permission checks,
// then enqueue). runSeed/removeSeed run in the queue consumer (as the app), resume from the
// SeedRun record on every retry, and never repeat recorded work.
import {
  SAMPLE_PLAN, DEFAULT_CONFIG, planSeed, parseSeedRef,
} from '../engine/index.js';
import { AppError, CODES, expectOk } from './errors.js';
import { K, queryAll } from './keys.js';
import { appendAudit } from './audit.js';
import { getConfig, saveConfig } from './config.js';
import { requirePermissions } from './permissions.js';
import { pickIssueType, resolveLinkType, createLink, blockingFields, createErrorText } from './jiraOps.js';
import { searchAll } from './loader.js';
import { freezeBaseline } from './baselines.js';
import { loadProjectTrace } from './traceService.js';
import { chunk, jqlQuote, p, withQuery, runId8 as toRunId8 } from './util.js';

export const SAMPLE_BASELINE_NAME = 'Release 2.0 (sample)';
export const PASS_SETTLE_MS = 1100;
export const MAX_RETRIES = 5;
export const SEED_PERMISSIONS = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'LINK_ISSUES', 'TRANSITION_ISSUES', 'EDIT_ISSUES'];
const ACTIVE = new Set(['queued', 'running', 'done', 'removing']);

export function runLabel(runId) {
  return `tb-run-${toRunId8(runId)}`;
}

function newRun({ runId, projectKey, requestedBy, nowIso, totalOps }) {
  return {
    schema: 1,
    runId,
    projectKey,
    requestedBy: requestedBy ?? null,
    kind: 'seed',
    status: 'queued',
    phase: 'create',
    progress: { done: 0, total: totalOps },
    refToKey: {},
    refToId: {},
    linkedPairs: [],
    passedRefs: [],
    notPassedRefs: [],
    removedKeys: [],
    warnings: [],
    error: null,
    jobId: null,
    startedAt: nowIso,
    updatedAt: nowIso,
    startedAudit: false,
    expected: { readinessPct: SAMPLE_PLAN.expected.before.pct },
    actual: null,
  };
}

// A run whose record has not been updated for this long is treated as dead. The consumer's
// timeout is 600 s and it saves progress every few operations, so 11 minutes is beyond any
// live run (a run waiting on an InvocationError retry saves before returning).
export const STALE_RUN_MS = 11 * 60 * 1000;
const UNFINISHED = new Set(['queued', 'running', 'removing']);

/**
 * Why an unfinished run is dead, or null when it may still be alive.
 * @param {object} run
 * @param {number} nowMs
 * @param {{success?:number, inProgress?:number, failed?:number}|null} stats  queue job stats
 */
export function staleReason(run, nowMs, stats) {
  if (!run || !UNFINISHED.has(run.status)) return null;
  if (stats && Number(stats.failed) > 0 && !(Number(stats.inProgress) > 0)) {
    return 'The background job failed (the queue reports it as failed).';
  }
  const updated = Date.parse(run.updatedAt ?? run.startedAt ?? '');
  const age = Number.isFinite(updated) ? nowMs - updated : 0;
  // How the queue counts an event that asked for a retry is not documented, so 'ended' also
  // needs two quiet minutes (retries here wait at most 60 s and save before returning).
  if (stats && Number(stats.success) > 0 && !(Number(stats.inProgress) > 0) && age > 2 * 60 * 1000) {
    return 'The background job ended without finishing the run.';
  }
  if (Number.isFinite(updated) && nowMs - updated > STALE_RUN_MS) {
    return `The background job has not reported progress for more than ${Math.round(STALE_RUN_MS / 60000)} minutes.`;
  }
  return null;
}

/**
 * Marks a dead unfinished run as failed (re-reading it first, so a run that finished meanwhile
 * is left alone), so the page shows Retry or Remove instead of waiting forever.
 * @returns {Promise<object>} the current run
 */
export async function reconcileRun(deps, run) {
  if (!run || !UNFINISHED.has(run.status)) return run;
  let stats = null;
  if (run.jobId && deps.queue?.stats) {
    try {
      stats = await deps.queue.stats(run.jobId);
    } catch {
      stats = null;
    }
  }
  const reason = staleReason(run, deps.now().getTime(), stats);
  if (!reason) return run;
  const fresh = (await deps.store.get(K.seedRun(run.runId))) ?? run;
  if (!UNFINISHED.has(fresh.status) || (fresh.updatedAt !== run.updatedAt && !staleReason(fresh, deps.now().getTime(), stats))) return fresh;
  const removing = fresh.status === 'removing';
  const failed = {
    ...fresh,
    status: 'failed',
    updatedAt: deps.now().toISOString(),
    error: {
      code: 'STALE_JOB',
      message: reason,
      hint: removing
        ? `Click "Remove sample data" again, or bulk-delete in Jira with JQL labels = ${runLabel(fresh.runId)}.`
        : 'Click "Load sample data" again to resume. Issues already created are adopted, not duplicated.',
      phase: removing ? 'remove' : fresh.phase,
    },
  };
  await deps.store.set(K.seedRun(fresh.runId), failed);
  return failed;
}

/** Pushes a job; if the push fails, the run is marked failed so it never stays queued forever. */
async function pushOrFail(deps, run, body) {
  try {
    return await deps.queue.push(body);
  } catch (e) {
    const failed = {
      ...run,
      status: 'failed',
      updatedAt: deps.now().toISOString(),
      error: {
        code: 'QUEUE_ERROR',
        message: `The background job could not be queued: ${e?.message ?? e}`,
        hint: body.kind === 'remove' ? 'Click "Remove sample data" again.' : 'Click "Load sample data" again.',
        phase: body.kind === 'remove' ? 'remove' : run.phase,
      },
    };
    await deps.store.set(K.seedRun(run.runId), failed).catch(() => {});
    throw new AppError(CODES.INTERNAL, failed.error.message, { hint: failed.error.hint });
  }
}

/**
 * Resolver side of "Load sample data". Idempotent: an active run is returned as is; a failed
 * seed run is resumed with the same runId (so its issues are adopted, not duplicated).
 * @param {{jira:object, store:object, queue:object, now:()=>Date, uuid:()=>string}} deps  jira is asUser
 */
export async function startSeed(deps, { projectKey, actor }) {
  const { store } = deps;
  await requirePermissions(deps.jira, projectKey, SEED_PERMISSIONS, 'load sample data');
  const nowIso = deps.now().toISOString();
  const cfg = await getConfig(store, projectKey);
  if (cfg.configured && cfg.config.roleMode !== 'labels') {
    throw new AppError(CODES.CONFIG_INVALID, 'Sample data uses role labels, but this project is set to issue-type roles.',
      { hint: 'Switch Settings > Role mode to labels, load the sample, then switch back.' });
  }
  if (!cfg.configured) await saveConfig(store, projectKey, DEFAULT_CONFIG, actor, nowIso);

  const existing = await store.get(K.seedProj(projectKey));
  if (existing?.runId) {
    const run = await reconcileRun(deps, await store.get(K.seedRun(existing.runId)));
    if (run && ACTIVE.has(run.status)) return run;
    if (run && run.status === 'failed' && run.error?.phase === 'remove') return run;
    if (run && run.status === 'failed') {
      const resumed = { ...run, status: 'queued', error: null, updatedAt: nowIso };
      await store.set(K.seedRun(run.runId), resumed);
      resumed.jobId = await pushOrFail(deps, resumed, { kind: 'seed', runId: run.runId, projectKey });
      await store.set(K.seedRun(run.runId), resumed);
      return resumed;
    }
  }
  const runId = deps.uuid();
  const plan = planSeed(SAMPLE_PLAN, DEFAULT_CONFIG, toRunId8(runId));
  const run = newRun({ runId, projectKey, requestedBy: actor, nowIso, totalOps: plan.totalOps });
  await store.set(K.seedRun(runId), run);
  if (existing?.runId) {
    await store.set(K.seedProj(projectKey), { runId });
  } else {
    const claim = await store.setIfAbsent(K.seedProj(projectKey), { runId });
    if (!claim.ok) {
      // Another click won the race: return its run.
      const other = await store.get(K.seedProj(projectKey));
      const otherRun = other?.runId ? await store.get(K.seedRun(other.runId)) : null;
      if (otherRun) return otherRun;
      await store.set(K.seedProj(projectKey), { runId });
    }
  }
  run.jobId = await pushOrFail(deps, run, { kind: 'seed', runId, projectKey });
  await store.set(K.seedRun(runId), run);
  return run;
}

/** Resolver side of "Remove sample data". */
export async function startRemove(deps, { projectKey, runId }) {
  const { store } = deps;
  const stored = await store.get(K.seedRun(runId));
  if (!stored || stored.projectKey !== projectKey) throw new AppError(CODES.NOT_FOUND, 'That sample-data run was not found in this project.');
  const run = await reconcileRun(deps, stored);
  if (run.status === 'removed' || run.status === 'removing') return run;
  if (run.status === 'queued' || run.status === 'running') {
    throw new AppError(CODES.VALIDATION, 'Sample data is still loading. Remove it after it finishes.');
  }
  const perm = await requirePermissions(deps.jira, projectKey, ['DELETE_ISSUES'], 'remove sample data').catch((e) => {
    if (e.code === CODES.FORBIDDEN) {
      e.hint = `You can also bulk-delete in Jira: search with JQL labels = ${runLabel(runId)} and use Bulk change > Delete.`;
    }
    throw e;
  });
  void perm;
  const updated = { ...run, kind: 'remove', status: 'removing', error: null, updatedAt: deps.now().toISOString() };
  await store.set(K.seedRun(runId), updated);
  updated.jobId = await pushOrFail(deps, updated, { kind: 'remove', runId, projectKey });
  await store.set(K.seedRun(runId), updated);
  return updated;
}

function isRetryable(e) {
  return e instanceof AppError && (e.code === CODES.RATE_LIMITED
    || (e.code === CODES.JIRA_ERROR && (e.status === 0 || e.status >= 500)));
}

function progressOf(run, plan) {
  const passTried = run.passedRefs.length + run.notPassedRefs.length;
  const done = Object.keys(run.refToKey).length + run.linkedPairs.length + passTried + (run.phase === 'done' ? 1 : 0);
  return { done: Math.min(done, plan.totalOps), total: plan.totalOps };
}

/**
 * Moves an issue into a Done-category status, via at most 3 intermediate hops, choosing
 * transitions by status category (works with any workflow).
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function transitionToDone(jira, key, projectKey) {
  const visited = new Set();
  let typeName = 'unknown';
  for (let hop = 0; hop <= 3; hop++) {
    const st = await jira.get(withQuery(p`/rest/api/3/issue/${key}`, { fields: 'status,issuetype' }));
    const issue = expectOk(st, { endpoint: `GET /rest/api/3/issue/${key}`, permission: 'Browse projects', as: jira.mode, projectKey });
    typeName = issue?.fields?.issuetype?.name ?? typeName;
    const statusId = issue?.fields?.status?.id;
    if (issue?.fields?.status?.statusCategory?.key === 'done') return { ok: true };
    if (statusId) visited.add(String(statusId));
    const tr = await jira.get(p`/rest/api/3/issue/${key}/transitions`);
    const list = expectOk(tr, { endpoint: `GET /rest/api/3/issue/${key}/transitions`, permission: 'Transition issues', as: jira.mode, projectKey })?.transitions ?? [];
    const usable = list.filter((t) => t && t.isAvailable !== false && t.to);
    for (const t of usable.filter((x) => x.to.statusCategory?.key === 'done')) {
      const res = await jira.post(p`/rest/api/3/issue/${key}/transitions`, { transition: { id: String(t.id) } });
      if (res.ok) return { ok: true };
      if (res.status === 400 || res.status === 409) continue;
      expectOk(res, { endpoint: `POST /rest/api/3/issue/${key}/transitions`, permission: 'Transition issues', as: jira.mode, projectKey });
    }
    if (hop === 3) break;
    let moved = false;
    for (const t of usable.filter((x) => x.to.statusCategory?.key === 'indeterminate' && !visited.has(String(x.to.id)))) {
      const res = await jira.post(p`/rest/api/3/issue/${key}/transitions`, { transition: { id: String(t.id) } });
      if (res.ok) {
        visited.add(String(t.to.id));
        moved = true;
        break;
      }
      if (res.status === 400 || res.status === 409) continue;
      expectOk(res, { endpoint: `POST /rest/api/3/issue/${key}/transitions`, permission: 'Transition issues', as: jira.mode, projectKey });
    }
    if (!moved) break;
  }
  return { ok: false, reason: `${key} could not reach a Done status: the workflow for issue type "${typeName}" has no available transition path (at most 3 steps) to a Done-category status, or a transition screen needs fields.` };
}

/**
 * Queue consumer side of "Load sample data".
 * @param {{jira:object, store:object, now:()=>Date, sleep:(ms:number)=>Promise<void>}} deps  jira is asApp
 * @param {{runId:string, retryCount?:number}} args
 * @returns {Promise<{status:string}|{retry:{retryAfter:number}}>}
 */
export async function runSeed(deps, { runId, retryCount = 0 }) {
  const { store, jira } = deps;
  const run = await store.get(K.seedRun(runId));
  if (!run) return { status: 'missing' };
  if (run.status !== 'queued' && run.status !== 'running') return { status: run.status };
  const projectKey = run.projectKey;
  const label = runLabel(runId);
  let ops = 0;
  const save = async () => {
    run.updatedAt = deps.now().toISOString();
    await store.set(K.seedRun(runId), run);
  };
  let plan;
  const tick = async () => {
    ops++;
    run.progress = progressOf(run, plan);
    if (ops % 5 === 0) await save();
  };
  try {
    const cfg = (await getConfig(store, projectKey)).config;
    plan = planSeed(SAMPLE_PLAN, cfg, toRunId8(runId));
    if (run.status === 'queued') {
      run.status = 'running';
      if (!run.startedAudit) {
        await appendAudit(store, projectKey, {
          type: 'SEED_STARTED', actor: run.requestedBy, subject: { runId }, data: { label, plannedOps: plan.totalOps },
        }, deps.now().toISOString());
        run.startedAudit = true;
      }
      await save();
    }

    if (run.phase === 'create') {
      const issueType = await pickIssueType(jira, projectKey);
      const planRefs = new Set(plan.creates.map((c) => c.ref));
      // Adopt issues from a crashed attempt.
      const found = await searchAll(jira, `project = ${jqlQuote(projectKey)} AND labels = ${jqlQuote(label)}`,
        { fields: ['summary'], max: 200, projectKey });
      for (const i of found.issues) {
        const ref = parseSeedRef(i.fields?.summary);
        if (ref && planRefs.has(ref) && !run.refToKey[ref]) {
          run.refToKey[ref] = i.key;
          run.refToId[ref] = String(i.id);
        }
      }
      const fieldsOf = (c) => ({
        project: { key: projectKey }, issuetype: { id: issueType.id }, summary: c.summary, description: c.descriptionAdf, labels: c.labels,
      });
      const remaining = plan.creates.filter((c) => !run.refToKey[c.ref]);
      for (const group of chunk(remaining, 50)) {
        const res = await jira.post('/rest/api/3/issue/bulk', { issueUpdates: group.map((c) => ({ fields: fieldsOf(c) })) });
        if (res.ok || res.status === 400) {
          const created = res.json?.issues ?? [];
          const errors = res.json?.errors ?? [];
          if (res.ok && errors.length === 0 && created.length === group.length) {
            group.forEach((c, i) => {
              run.refToKey[c.ref] = created[i].key;
              run.refToId[c.ref] = String(created[i].id);
            });
          } else {
            for (const ci of created) {
              const g = await jira.get(withQuery(p`/rest/api/3/issue/${ci.key}`, { fields: 'summary' }));
              const issue = expectOk(g, { endpoint: `GET /rest/api/3/issue/${ci.key}`, permission: 'Browse projects', as: jira.mode, projectKey });
              const ref = parseSeedRef(issue?.fields?.summary);
              if (ref && planRefs.has(ref)) {
                run.refToKey[ref] = ci.key;
                run.refToId[ref] = String(ci.id ?? issue.id);
              }
            }
          }
        } else {
          expectOk(res, { endpoint: 'POST /rest/api/3/issue/bulk', permission: 'Create issues', as: jira.mode, projectKey });
        }
        run.progress = progressOf(run, plan);
        await save();
        // Retry the elements that failed, one at a time.
        for (const c of group.filter((x) => !run.refToKey[x.ref])) {
          const one = await jira.post('/rest/api/3/issue', { fields: fieldsOf(c) });
          if (one.status === 400) {
            const names = blockingFields(one.json);
            throw new AppError(CODES.JIRA_ERROR,
              `Jira refused to create ${c.summary}: ${createErrorText(one.json)}`,
              { status: 400, hint: names.length ? `Required or invalid fields in this project: ${names.join(', ')}. Make them optional for the "${issueType.name}" type, or use another project.` : 'Check the project\'s create screen for required fields.' });
          }
          const ji = expectOk(one, { endpoint: 'POST /rest/api/3/issue', permission: 'Create issues', as: jira.mode, projectKey });
          run.refToKey[c.ref] = ji.key;
          run.refToId[c.ref] = String(ji.id);
          await tick();
        }
      }
      run.phase = 'link';
      run.progress = progressOf(run, plan);
      await save();
    }

    if (run.phase === 'link') {
      const lt = await resolveLinkType(jira);
      if (lt.warning && !run.warnings.includes(lt.warning)) run.warnings.push(lt.warning);
      for (const l of plan.links) {
        const pair = `${l.downRef}>${l.upRef}`;
        if (run.linkedPairs.includes(pair)) continue;
        await createLink(jira, lt.name, run.refToKey[l.downRef], run.refToKey[l.upRef], projectKey);
        run.linkedPairs.push(pair);
        await tick();
      }
      run.phase = 'pass';
      run.progress = progressOf(run, plan);
      await save();
    }

    if (run.phase === 'pass') {
      for (const ref of plan.passRefs) {
        if (run.passedRefs.includes(ref) || run.notPassedRefs.includes(ref)) continue;
        const r = await transitionToDone(jira, run.refToKey[ref], projectKey);
        if (r.ok) run.passedRefs.push(ref);
        else {
          run.notPassedRefs.push(ref);
          run.warnings.push(`${ref}: ${r.reason}`);
        }
        await tick();
      }
      // No later human edit can share a timestamp with a pass.
      await deps.sleep(PASS_SETTLE_MS);
      run.phase = 'baseline';
      run.progress = progressOf(run, plan);
      await save();
    }

    if (run.phase === 'baseline') {
      const ids = Object.values(run.refToId).slice(0, 50);
      let actual = null;
      try {
        const { meta } = await freezeBaseline({ jira, store, now: deps.now }, {
          projectKey, name: SAMPLE_BASELINE_NAME, release: null, actor: run.requestedBy, sample: true, reconcileIssueIds: ids,
        });
        actual = meta.readinessPct;
      } catch (e) {
        if (isRetryable(e)) throw e;
        run.warnings.push(`The sample baseline was not frozen: ${e.message}`);
        try {
          actual = (await loadProjectTrace({ jira, store, now: deps.now }, projectKey, { reconcileIssueIds: ids })).trace.readiness.pct;
        } catch (e2) {
          if (isRetryable(e2)) throw e2;
          run.warnings.push(`Readiness could not be computed: ${e2.message}`);
        }
      }
      run.actual = { readinessPct: actual };
      if (actual !== run.expected.readinessPct) {
        const reasons = run.warnings.length ? run.warnings.join(' ') : 'no warnings were recorded; Jira search may not show the new issues yet, so refresh in a minute.';
        run.warnings.push(`Readiness is ${actual ?? 'unknown'}%, expected ${run.expected.readinessPct}%: ${reasons}`);
      }
      run.phase = 'done';
    }

    run.status = 'done';
    run.progress = progressOf(run, plan);
    await save();
    await appendAudit(store, projectKey, {
      type: 'SEED_FINISHED', actor: run.requestedBy, subject: { runId },
      data: { status: 'done', expectedPct: run.expected.readinessPct, actualPct: run.actual?.readinessPct ?? null, warnings: run.warnings.length },
    }, deps.now().toISOString());
    return { status: 'done' };
  } catch (e) {
    if (isRetryable(e) && retryCount < MAX_RETRIES) {
      await save().catch(() => {});
      return { retry: { retryAfter: Math.min(60, e.retryAfter ?? 10) } };
    }
    run.status = 'failed';
    run.error = { code: e?.code ?? CODES.INTERNAL, message: e?.message ?? String(e), hint: e?.hint ?? null, phase: run.phase };
    await save().catch(() => {});
    await appendAudit(store, projectKey, {
      type: 'SEED_FINISHED', actor: run.requestedBy, subject: { runId },
      data: { status: 'failed', code: run.error.code, phase: run.phase },
    }, deps.now().toISOString()).catch(() => {});
    return { status: 'failed' };
  }
}

/**
 * Queue consumer side of "Remove sample data": deletes every issue with the run label
 * (re-verification tasks on sample tests carry it too). Audit records and the sample baseline
 * are kept (append-only) and stay flagged as sample.
 */
export async function removeSeed(deps, { runId, retryCount = 0 }) {
  const { store, jira } = deps;
  const run = await store.get(K.seedRun(runId));
  if (!run) return { status: 'missing' };
  if (run.status !== 'removing') return { status: run.status };
  const projectKey = run.projectKey;
  const label = runLabel(runId);
  const save = async () => {
    run.updatedAt = deps.now().toISOString();
    await store.set(K.seedRun(runId), run);
  };
  try {
    const found = await searchAll(jira, `project = ${jqlQuote(projectKey)} AND labels = ${jqlQuote(label)}`,
      { fields: ['summary'], max: 500, projectKey });
    const keys = [...new Set([...Object.values(run.refToKey ?? {}), ...found.issues.map((i) => i.key)])];
    const removed = new Set(run.removedKeys ?? []);
    for (const key of keys) {
      if (removed.has(key)) continue;
      const res = await jira.del(withQuery(p`/rest/api/3/issue/${key}`, { deleteSubtasks: 'true' }));
      if (res.status === 401 || res.status === 403) {
        throw new AppError(CODES.JIRA_PERMISSION, `Jira returned ${res.status} when the app deleted ${key}.`,
          { status: res.status, hint: `Bulk-delete in Jira with JQL labels = ${label} (Filters > search, then Bulk change > Delete). The app's project role may lack Delete issues.` });
      }
      if (res.status !== 404) expectOk(res, { endpoint: `DELETE /rest/api/3/issue/${key}`, permission: 'Delete issues', as: jira.mode, projectKey });
      removed.add(key);
      run.removedKeys = [...removed];
      if (removed.size % 5 === 0) await save();
    }
    const clr = await queryAll(store, K.clearancePrefix(projectKey));
    for (const r of clr) {
      if (removed.has(r.value?.downKey) || removed.has(r.value?.upKey)) await store.delete(r.key);
    }
    // Re-verification task records (rv:{project}:{down}:{up}) of removed issues.
    for (const r of await queryAll(store, K.reverifyPrefix(projectKey))) {
      const [down, up] = r.key.slice(K.reverifyPrefix(projectKey).length).split(':');
      if (removed.has(down) || removed.has(up) || removed.has(r.value?.taskKey)) await store.delete(r.key);
    }
    run.status = 'removed';
    run.removedKeys = [...removed];
    await save();
    const pointer = await store.get(K.seedProj(projectKey));
    if (pointer?.runId === runId) await store.delete(K.seedProj(projectKey));
    await appendAudit(store, projectKey, {
      type: 'SEED_REMOVED', actor: run.requestedBy, subject: { runId }, data: { deleted: removed.size, label },
    }, deps.now().toISOString());
    return { status: 'removed' };
  } catch (e) {
    if (isRetryable(e) && retryCount < MAX_RETRIES) {
      await save().catch(() => {});
      return { retry: { retryAfter: Math.min(60, e.retryAfter ?? 10) } };
    }
    run.status = 'failed';
    run.error = { code: e?.code ?? CODES.INTERNAL, message: e?.message ?? String(e), hint: e?.hint ?? `Bulk-delete in Jira with JQL labels = ${label}.`, phase: 'remove' };
    await save().catch(() => {});
    return { status: 'failed' };
  }
}

/** Consumer entry: dispatches on event.body.kind. */
export async function handleJob(deps, event) {
  const body = event?.body ?? {};
  const retryCount = event?.retryContext?.retryCount ?? 0;
  if (body.kind === 'seed') return runSeed(deps, { runId: body.runId, retryCount });
  if (body.kind === 'remove') return removeSeed(deps, { runId: body.runId, retryCount });
  return { status: 'ignored' };
}
