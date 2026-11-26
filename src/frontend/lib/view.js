// Which state a view is in, the sample-data banner and the polling rule. Pure functions.

export const VIEW = Object.freeze({
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NO_TRACE_ISSUES: 'NO_TRACE_ISSUES',
  SEEDING: 'SEEDING',
  READY: 'READY',
});

export const SEED_ACTIVE = Object.freeze(['queued', 'running', 'removing']);
export const POLL_MS = 2000;
export const POLL_MAX_MS = 10 * 60 * 1000;
export const EXPECTED_SAMPLE_PCT = 92;

export const PHASE_TEXT = Object.freeze({
  create: 'Creating the 30 sample issues',
  link: 'Linking requirements, controls, risks and tests',
  pass: 'Moving the 13 linked tests to a Done status',
  baseline: 'Freezing the sample baseline and checking readiness',
  done: 'Finishing',
});

export function isSeedActive(run) {
  return !!run && SEED_ACTIVE.includes(run.status);
}

/**
 * State of the project page.
 * @param {{loading:boolean, error:object|null, view:object|null, seedRun?:object|null}} s
 *   seedRun is the freshest run from polling; it wins over view.seed.
 */
export function projectViewState(s) {
  const view = s?.view ?? null;
  if (!view) return s?.error ? VIEW.ERROR : VIEW.LOADING;
  const run = s.seedRun ?? view.seed ?? null;
  if (isSeedActive(run)) return VIEW.SEEDING;
  const issueCount = view.info?.issueCount ?? 0;
  if (!view.configured && issueCount === 0) return VIEW.NOT_CONFIGURED;
  if (issueCount === 0) return VIEW.NO_TRACE_ISSUES;
  return VIEW.READY;
}

/**
 * Progress of a sample-data run for the SeedPanel.
 * @returns {{value:number, label:string, phaseText:string, isIndeterminate:boolean}}
 */
export function seedProgress(run) {
  if (!run) return { value: 0, label: '', phaseText: '', isIndeterminate: true };
  if (run.status === 'removing') {
    return { value: 0, label: '', phaseText: 'Deleting the sample issues', isIndeterminate: true };
  }
  const done = run.progress?.done ?? 0;
  const total = run.progress?.total ?? 0;
  const value = total > 0 ? Math.min(1, done / total) : 0;
  const phaseText = run.status === 'queued' ? 'Waiting for the background job to start' : (PHASE_TEXT[run.phase] ?? 'Working');
  return { value, label: total > 0 ? `${done}/${total}` : '', phaseText, isIndeterminate: run.status === 'queued' && done === 0 };
}

/**
 * The SectionMessage shown above the matrix after a sample run (or null).
 * @param {object|null} run
 * @param {number|null} [currentPct]  live readiness, when known
 * @returns {null|{kind:'SEED_DONE'|'SEED_FAILED'|'REMOVE_FAILED', appearance:string, title:string, body:string, warnings:string[], hint:string|null}}
 */
export function seedBanner(run, currentPct) {
  if (!run) return null;
  if (run.status === 'done') {
    const actual = run.actual?.readinessPct ?? null;
    const expected = run.expected?.readinessPct ?? EXPECTED_SAMPLE_PCT;
    const match = actual === expected;
    // The title states the readiness AT LOAD TIME, so it never contradicts the live number
    // after the demo edit. The next step changes once the live readiness has moved.
    const moved = typeof currentPct === 'number' && actual !== null && currentPct !== actual;
    let body;
    if (!match) body = 'Some steps did not complete on this site. The reasons are listed below.';
    else if (moved) body = `Readiness is now ${currentPct}%. Click an amber test in the matrix to see exactly what changed.`;
    else body = 'Next: open [REQ-7] Bolus dose limit, change "25 units" to "20 units" in the description, save, then click Refresh here.';
    return {
      kind: 'SEED_DONE',
      appearance: match ? 'success' : 'warning',
      title: `Sample data loaded (readiness ${actual === null ? 'unknown' : `${actual}%`} when loaded, expected ${expected}%)`,
      body,
      warnings: Array.isArray(run.warnings) ? run.warnings : [],
      hint: null,
    };
  }
  if (run.status === 'failed') {
    const remove = run.error?.phase === 'remove';
    return {
      kind: remove ? 'REMOVE_FAILED' : 'SEED_FAILED',
      appearance: 'error',
      title: remove ? 'Removing the sample data failed' : 'Loading the sample data failed',
      body: run.error?.message ?? 'Unknown error.',
      warnings: Array.isArray(run.warnings) ? run.warnings : [],
      hint: run.error?.hint ?? null,
    };
  }
  return null;
}

/**
 * Whether to poll again.
 * @returns {'continue'|'finished'|'timeout'}
 */
export function pollDecision(run, startedMs, nowMs) {
  if (!isSeedActive(run)) return 'finished';
  if (nowMs - startedMs >= POLL_MAX_MS) return 'timeout';
  return 'continue';
}

/** Short run id shown to users (same 8 characters as the tb-run-xxxxxxxx label). */
export function runLabelOf(run) {
  const id = String(run?.runId ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return id ? `tb-run-${id}` : null;
}
