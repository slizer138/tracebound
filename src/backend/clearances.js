// Clearances ("not substantive" with a reason). The audit chain is the source of truth; the
// clr: keys are derived lookups written after the audit record.
import { AppError, CODES } from './errors.js';
import { K, queryAll } from './keys.js';
import { appendAudit } from './audit.js';
import { requirePermissions } from './permissions.js';
import { loadTraceAround } from './traceService.js';
import { findTraceEntry } from '../engine/index.js';

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export async function listClearances(store, projectKey) {
  const rows = await queryAll(store, K.clearancePrefix(projectKey));
  return rows.map((r) => r.value).filter((v) => v && v.fingerprint);
}

/**
 * @param {{jira:object, store:object, now:()=>Date}} deps   jira is asUser
 * @param {{projectKey:string, downKey:string, upKey:string, kind:'link'|'upstream', fingerprint:string, reason:string, actor:string|null}} args
 */
export async function clearEntry(deps, args) {
  const reason = String(args.reason ?? '').trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    throw new AppError(CODES.VALIDATION, `A reason of ${REASON_MIN} to ${REASON_MAX} characters is required (got ${reason.length}).`,
      { hint: 'Say why the change does not affect what the test verifies.' });
  }
  if (args.kind !== 'link' && args.kind !== 'upstream') {
    throw new AppError(CODES.VALIDATION, 'kind must be "link" or "upstream".');
  }
  const { trace } = await loadTraceAround(deps, args.projectKey, args.upKey);
  const found = findTraceEntry(trace, args.downKey, args.upKey);
  if (!found || found.kind !== args.kind) {
    throw new AppError(CODES.NOT_FOUND, `No ${args.kind} between ${args.downKey} and ${args.upKey} was found.`,
      { hint: 'Refresh the page: the link may have been removed.' });
  }
  const entry = found.entry;
  if (!entry.fingerprint || entry.fingerprint !== args.fingerprint) {
    throw new AppError(CODES.STALE, 'The change you were looking at is out of date (the issue changed again or the test was re-run).',
      { hint: 'The view will reload. Review the new change before clearing it.' });
  }
  if (entry.state === 'CLEARED') {
    return { alreadyCleared: true, clearance: entry.clearance, auditSeq: entry.clearance?.auditSeq ?? null };
  }
  await requirePermissions(deps.jira, args.projectKey, ['EDIT_ISSUES'], 'clear a suspect flag');
  const nowIso = deps.now().toISOString();
  const rec = await appendAudit(deps.store, args.projectKey, {
    type: args.kind === 'link' ? 'LINK_CLEARED' : 'UPSTREAM_CLEARED',
    actor: args.actor ?? null,
    subject: { downKey: args.downKey, upKey: args.upKey },
    data: {
      fingerprint: entry.fingerprint,
      reason,
      fields: (entry.change?.fields ?? []).map((f) => ({ fieldId: f.fieldId, before: f.before, after: f.after })),
      changeReason: entry.change?.reason ?? null,
    },
  }, nowIso);
  const clearance = {
    schema: 1,
    kind: args.kind,
    projectKey: args.projectKey,
    downKey: args.downKey,
    upKey: args.upKey,
    fingerprint: entry.fingerprint,
    reason,
    at: nowIso,
    by: args.actor ?? null,
    auditSeq: rec.seq,
  };
  await deps.store.set(K.clearance(args.projectKey, args.kind, args.downKey, args.upKey), clearance);
  return { alreadyCleared: false, clearance, auditSeq: rec.seq };
}
