// Turns the engine's TraceResult (sent unchanged by project.getView) into table rows.
// Pure data in, pure data out; the JSX files only map these rows to components.
import { isActionable } from './states.js';

function keyNum(key) {
  const m = /-(\d+)$/.exec(String(key));
  return m ? Number(m[1]) : 0;
}

/** Jira-style key order: project part, then the number. */
export function compareKeys(a, b) {
  const pa = String(a).replace(/-\d+$/, '');
  const pb = String(b).replace(/-\d+$/, '');
  if (pa !== pb) return pa < pb ? -1 : 1;
  return keyNum(a) - keyNum(b);
}

const STATE_ORDER = { SUSPECT: 0, UPSTREAM_CHANGED: 1, CLEARED: 2 };

/**
 * One row per requirement and control (trace.items is already filtered by release and onlyGaps).
 * @param {object} trace TraceResult
 */
export function matrixRows(trace) {
  const links = trace?.links ?? [];
  const upstream = trace?.upstream ?? [];
  const risks = trace?.risks ?? [];
  return (trace?.items ?? []).map((item) => {
    const chips = links
      .filter((l) => l.itemKey === item.key)
      .map((l) => ({ testKey: l.testKey, state: l.state, actionable: isActionable(l.state) }))
      .sort((a, b) => compareKeys(a.testKey, b.testKey));
    const upstreamFlags = item.role === 'ctrl'
      ? upstream.filter((u) => u.ctrlKey === item.key)
        .map((u) => ({ reqKey: u.reqKey, state: u.state, actionable: isActionable(u.state) }))
        .sort((a, b) => compareKeys(a.reqKey, b.reqKey))
      : [];
    let related;
    if (item.role === 'req') {
      related = upstream.filter((u) => u.reqKey === item.key).map((u) => u.ctrlKey);
    } else {
      related = [
        ...upstream.filter((u) => u.ctrlKey === item.key).map((u) => u.reqKey),
        ...risks.filter((r) => (r.controls ?? []).includes(item.key)).map((r) => r.key),
      ];
    }
    return {
      key: item.key,
      role: item.role,
      summary: item.summary,
      state: item.state,
      fixVersions: item.fixVersions ?? [],
      chips,
      upstream: upstreamFlags,
      related: [...new Set(related)].sort(compareKeys),
    };
  });
}

/**
 * Flat list of everything that needs a decision: suspect or cleared links and upstream flags.
 * Open problems first (SUSPECT, then UPSTREAM CHANGED), then cleared ones, then by key.
 */
export function suspectRows(trace) {
  const rows = [];
  for (const l of trace?.links ?? []) {
    if (l.state !== 'SUSPECT' && l.state !== 'CLEARED') continue;
    rows.push({
      kind: 'link', downKey: l.testKey, upKey: l.itemKey, state: l.state,
      changedAt: l.change?.latestAt ?? null, fields: (l.change?.fields ?? []).map((f) => f.fieldId),
      reason: l.change?.reason ?? null, clearedReason: l.clearance?.reason ?? null,
    });
  }
  for (const u of trace?.upstream ?? []) {
    if (u.state !== 'UPSTREAM_CHANGED' && u.state !== 'CLEARED') continue;
    rows.push({
      kind: 'upstream', downKey: u.ctrlKey, upKey: u.reqKey, state: u.state,
      changedAt: u.change?.latestAt ?? null, fields: (u.change?.fields ?? []).map((f) => f.fieldId),
      reason: u.change?.reason ?? null, clearedReason: u.clearance?.reason ?? null,
    });
  }
  return rows.sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state])
    || compareKeys(a.upKey, b.upKey) || compareKeys(a.downKey, b.downKey));
}

/** Gaps outside the matrix rows: unmitigated risks and orphan tests. */
export function otherGaps(trace) {
  return {
    unmitigatedRisks: (trace?.risks ?? []).filter((r) => !r.mitigated).map((r) => ({ key: r.key, summary: r.summary })),
    orphanTests: [...(trace?.orphanTests ?? [])],
  };
}

/** Options for the release Select: "All items" plus every fixVersion seen on items. */
export function releaseOptions(releases) {
  return [{ label: 'All items', value: '' }, ...(releases ?? []).map((r) => ({ label: r, value: r }))];
}
