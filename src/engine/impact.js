// Change impact: what changed, which verifications it affects, and the ripple through controls and risks.
import { compareKeys } from './graph.js';

/**
 * Merges the change sets of several links on the same item: per field, the change seen from
 * the oldest pass (the widest window) wins.
 * @param {Array<{passedAt:number|null, change:import('./types.js').ChangeSet|null}>} entries
 * @returns {import('./types.js').ChangeSet|null}
 */
export function mergeChanges(entries) {
  const withChange = entries.filter((e) => e.change && e.change.changed);
  if (withChange.length === 0) return null;
  const sorted = [...withChange].sort((a, b) => (a.passedAt ?? 0) - (b.passedAt ?? 0));
  const byField = new Map();
  let created = false;
  for (const e of sorted) {
    if (e.change.reason === 'CREATED_AFTER') created = true;
    for (const f of e.change.fields) if (!byField.has(f.fieldId)) byField.set(f.fieldId, f);
  }
  const fields = [...byField.values()];
  const latest = sorted.map((e) => e.change.latestAt).filter((x) => x !== null);
  return {
    changed: true,
    // An item created after a test passed is explained as such even when it was edited later
    // (its later edits stay in fields), matching the link's own reason.
    reason: created ? 'CREATED_AFTER' : fields.length ? 'TEXT_CHANGED' : 'NONE',
    fields,
    latestAt: latest.length ? Math.max(...latest) : null,
  };
}

function itemStateOf(trace, key) {
  return trace.items.find((i) => i.key === key)?.state ?? null;
}

function controlRipple(trace, graph, ctrlKey) {
  const up = trace.upstream.filter((u) => u.ctrlKey === ctrlKey);
  return {
    ctrlKey,
    summary: graph.nodes[ctrlKey]?.summary ?? '',
    state: itemStateOf(trace, ctrlKey),
    upstreamState: up.some((u) => u.state === 'UPSTREAM_CHANGED') ? 'UPSTREAM_CHANGED'
      : up.some((u) => u.state === 'CLEARED') ? 'CLEARED' : 'OK',
    tests: trace.links.filter((l) => l.itemKey === ctrlKey),
    risks: graph.mitigates.filter((m) => m.ctrlKey === ctrlKey).map((m) => m.riskKey).sort(compareKeys),
  };
}

/**
 * @param {ReturnType<import('./trace.js').computeTrace>} trace
 * @param {ReturnType<import('./graph.js').buildGraph>} graph
 * @param {string} key
 */
export function impactOf(trace, graph, key) {
  const node = graph?.nodes?.[key];
  if (!node) return null;
  const base = {
    key,
    role: node.role,
    summary: node.summary,
    state: itemStateOf(trace, key),
    changes: null,
    affectedLinks: [],
    upstream: [],
    derivedControls: [],
    risks: [],
  };
  if (node.role === 'req' || node.role === 'ctrl') {
    const affectedLinks = trace.links.filter((l) => l.itemKey === key);
    const suspect = affectedLinks.filter((l) => l.state === 'SUSPECT');
    const cleared = affectedLinks.filter((l) => l.state === 'CLEARED');
    const upstream = trace.upstream.filter((u) => u.ctrlKey === key);
    let changes = mergeChanges(suspect.length ? suspect : cleared);
    if (!changes && node.role === 'ctrl') {
      changes = mergeChanges(upstream.filter((u) => u.change).map((u) => ({ passedAt: u.since, change: u.change })));
    }
    const derivedControls = node.role === 'req'
      ? graph.derives.filter((d) => d.reqKey === key).map((d) => {
        const r = controlRipple(trace, graph, d.ctrlKey);
        const own = trace.upstream.find((u) => u.ctrlKey === d.ctrlKey && u.reqKey === key);
        return { ...r, state: own?.state ?? 'OK', itemState: r.state };
      })
      : [];
    const risks = node.role === 'ctrl'
      ? graph.mitigates.filter((m) => m.ctrlKey === key).map((m) => m.riskKey)
      : derivedControls.flatMap((c) => c.risks);
    return {
      ...base,
      changes,
      affectedLinks,
      upstream,
      derivedControls,
      risks: [...new Set(risks)].sort(compareKeys),
    };
  }
  if (node.role === 'test') {
    return { ...base, affectedLinks: trace.links.filter((l) => l.testKey === key) };
  }
  // risk
  const controls = graph.mitigates.filter((m) => m.riskKey === key).map((m) => controlRipple(trace, graph, m.ctrlKey));
  return { ...base, derivedControls: controls.map((c) => ({ ...c, itemState: c.state })), risks: [key] };
}

/**
 * The single link or upstream entry the impact modal is about.
 * @returns {{kind:'link'|'upstream', entry:object}|null}
 */
export function findTraceEntry(trace, downKey, upKey) {
  const link = trace.links.find((l) => l.testKey === downKey && l.itemKey === upKey);
  if (link) return { kind: 'link', entry: link };
  const up = trace.upstream.find((u) => u.ctrlKey === downKey && u.reqKey === upKey);
  if (up) return { kind: 'upstream', entry: up };
  return null;
}
