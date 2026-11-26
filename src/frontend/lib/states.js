// State names, labels and Lozenge appearances (appearance values from the UI Kit Lozenge docs).

export const ITEM_STATES = Object.freeze({
  READY: { label: 'READY', appearance: 'success', help: 'Every linked test passed after the last substantive change.' },
  SUSPECT: { label: 'SUSPECT', appearance: 'moved', help: 'Changed after at least one linked test last passed.' },
  UPSTREAM_CHANGED: { label: 'UPSTREAM CHANGED', appearance: 'moved', help: 'The requirement this control derives from changed after the control was last edited.' },
  NOT_RUN: { label: 'NOT RUN', appearance: 'default', help: 'At least one linked test is not in a Done status.' },
  MISSING_TESTS: { label: 'MISSING TESTS', appearance: 'removed', help: 'No verification test is linked.' },
});

export const LINK_STATES = Object.freeze({
  VERIFIED: { label: 'VERIFIED', appearance: 'success', help: 'Passed after the last substantive change.' },
  SUSPECT: { label: 'SUSPECT', appearance: 'moved', help: 'The item changed after this test last passed.' },
  CLEARED: { label: 'CLEARED', appearance: 'inprogress', help: 'The change was cleared as not substantive, with a recorded reason.' },
  NOT_RUN: { label: 'NOT RUN', appearance: 'default', help: 'The test is not in a Done status.' },
});

export const UPSTREAM_STATES = Object.freeze({
  OK: { label: 'UPSTREAM OK', appearance: 'success', help: 'No requirement change since the control was last edited.' },
  UPSTREAM_CHANGED: { label: 'UPSTREAM CHANGED', appearance: 'moved', help: 'Review the control against the changed requirement.' },
  CLEARED: { label: 'CLEARED', appearance: 'inprogress', help: 'Cleared as not substantive, with a recorded reason.' },
});

export const ROLES = Object.freeze({
  req: { label: 'REQ', name: 'Requirement' },
  ctrl: { label: 'CTRL', name: 'Risk control' },
  risk: { label: 'RISK', name: 'Risk' },
  test: { label: 'TEST', name: 'Verification test' },
});

export const HEALTH = Object.freeze({
  pass: { label: 'PASS', appearance: 'success' },
  warn: { label: 'WARN', appearance: 'moved' },
  fail: { label: 'FAIL', appearance: 'removed' },
  info: { label: 'INFO', appearance: 'default' },
});

/** Looks up a state in one of the maps above; unknown states render as a default Lozenge. */
export function stateOf(map, state) {
  return map[state] ?? { label: String(state ?? '-'), appearance: 'default', help: '' };
}

/** Link and upstream states a user can act on (open the change, clear it, create a task). */
export function isActionable(state) {
  return state === 'SUSPECT' || state === 'CLEARED' || state === 'UPSTREAM_CHANGED';
}

/**
 * The counters shown in the readiness strip, in display order. Zero counts of a problem use the
 * neutral appearance so the strip only draws the eye to real gaps.
 * @param {object} kpis TraceResult.kpis
 */
export function kpiLozenges(kpis) {
  const k = kpis ?? {};
  const n = (v) => (typeof v === 'number' ? v : 0);
  const problem = (count, appearance) => (count > 0 ? appearance : 'default');
  return [
    { id: 'ready', label: `Ready ${n(k.ready)}/${n(k.items)}`, appearance: n(k.items) > 0 && n(k.ready) === n(k.items) ? 'success' : 'default' },
    { id: 'missing', label: `Missing tests ${n(k.missingTests)}`, appearance: problem(n(k.missingTests), 'removed') },
    { id: 'suspect', label: `Suspect links ${n(k.suspectLinks)}`, appearance: problem(n(k.suspectLinks), 'moved') },
    { id: 'upstream', label: `Upstream changed ${n(k.upstreamChanged)}`, appearance: problem(n(k.upstreamChanged), 'moved') },
    { id: 'notrun', label: `Not run ${n(k.notRunLinks)}`, appearance: 'default' },
    { id: 'cleared', label: `Cleared ${n(k.clearedLinks)}`, appearance: n(k.clearedLinks) > 0 ? 'inprogress' : 'default' },
    { id: 'risks', label: `Unmitigated risks ${n(k.unmitigatedRisks)}`, appearance: problem(n(k.unmitigatedRisks), 'removed') },
    { id: 'orphans', label: `Orphan tests ${n(k.orphanTests)}`, appearance: problem(n(k.orphanTests), 'moved') },
  ];
}
