// Audit-log and baseline display helpers.

export const AUDIT_ACTIONS = Object.freeze({
  CONFIG_SAVED: 'Settings saved',
  SEED_STARTED: 'Sample data started',
  SEED_FINISHED: 'Sample data finished',
  SEED_REMOVED: 'Sample data removed',
  LINK_CLEARED: 'Suspect link cleared',
  UPSTREAM_CLEARED: 'Upstream flag cleared',
  REVERIFY_TASK_CREATED: 'Re-verification task created',
  BASELINE_FROZEN: 'Baseline frozen',
});

export function auditAction(type) {
  return AUDIT_ACTIONS[type] ?? String(type ?? '-');
}

/** Issue keys or object the record is about, as one short string. */
export function auditSubject(rec) {
  const s = rec?.subject ?? {};
  if (s.taskKey) return `${s.taskKey} for ${s.downKey} / ${s.upKey}`;
  if (s.downKey && s.upKey) return `${s.downKey} / ${s.upKey}`;
  if (s.baselineId) return `${s.name ?? s.baselineId}${s.release ? ` (${s.release})` : ''}`;
  if (s.runId) return `tb-run-${String(s.runId).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
  if (s.projectKey) return s.projectKey;
  return '-';
}

/** The most useful detail of a record (reason, readiness, result). */
export function auditDetail(rec) {
  const d = rec?.data ?? {};
  switch (rec?.type) {
    case 'LINK_CLEARED':
    case 'UPSTREAM_CLEARED':
      return d.reason ? `Reason: ${d.reason}` : '';
    case 'BASELINE_FROZEN':
      return `Readiness ${d.readinessPct ?? '-'}%${d.sample ? ' (sample)' : ''}`;
    case 'SEED_FINISHED':
      return d.status === 'done' ? `Readiness ${d.actualPct ?? '-'}% (expected ${d.expectedPct ?? '-'}%)` : `Failed (${d.code ?? 'error'})`;
    case 'SEED_REMOVED':
      return `${d.deleted ?? 0} issues deleted`;
    default:
      return '';
  }
}

/** Text for the result of audit.verify. */
export function chainVerdict(result) {
  if (!result) return null;
  if (result.ok) {
    return { appearance: 'success', title: `${result.count} records, chain intact`, body: 'Every record\'s hash matches its content and links to the record before it.' };
  }
  const why = {
    GAP: 'a record is missing',
    HASH_MISMATCH: 'a record\'s content no longer matches its hash',
    PREV_MISMATCH: 'a record does not link to the record before it',
  }[result.problem] ?? 'the chain does not verify';
  return { appearance: 'error', title: `Chain broken at record #${result.firstBadSeq}`, body: `At record #${result.firstBadSeq}, ${why}.` };
}

/** Text for the result of baseline.verify. */
export function baselineVerdict(result) {
  if (!result) return null;
  if (result.ok) return { ok: true, text: 'Hash matches' };
  const why = {
    MISSING_CHUNKS: 'stored data is incomplete',
    HASH_MISMATCH: 'stored data does not match the recorded hash',
    AUDIT_MISMATCH: 'the audit record does not match',
  }[result.problem] ?? 'does not verify';
  return { ok: false, text: `MISMATCH: ${why}` };
}
