// THE SUSPECT RULE. A verification link is SUSPECT when the requirement or control it verifies
// was substantively changed at or after the moment the test last entered a Done-category status.
import { ENGINE_VERSION } from './types.js';
import { buildGraph, compareKeys } from './graph.js';
import {
  lastPassedAt, substantiveChangeSince, latestSubstantiveEditMs, fingerprint,
} from './changes.js';
import { readiness, pctOf } from './readiness.js';

const ROLE_ORDER = { req: 0, ctrl: 1 };

function findClearance(clearances, kind, downKey, upKey, fp) {
  return (clearances ?? []).find((c) => c && c.kind === kind && c.downKey === downKey
    && c.upKey === upKey && c.fingerprint === fp) ?? null;
}

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {import('./types.js').Config} cfg
 * @param {import('./types.js').Clearance[]} [clearances]
 * @param {{release?: string|null, onlyGaps?: boolean}} [opts]
 */
export function computeTrace(snapshot, cfg, clearances = [], opts = {}) {
  const graph = buildGraph(snapshot, cfg);
  const fieldIds = cfg?.substantiveFieldIds?.length ? cfg.substantiveFieldIds : ['summary', 'description'];
  const statusCatById = snapshot?.statusCatById ?? {};
  const changelogs = snapshot?.changelogs ?? {};
  const issueByKey = {};
  for (const issue of snapshot?.issues ?? []) if (!issueByKey[issue.key]) issueByKey[issue.key] = issue;
  const hist = (key) => changelogs[issueByKey[key]?.id] ?? [];

  // Link rule.
  /** @type {import('./types.js').LinkResult[]} */
  const allLinks = graph.verifies.map(({ testKey, itemKey }) => {
    const t = graph.nodes[testKey];
    const base = { testKey, itemKey, passedAt: null, passSource: null, change: null, fingerprint: null, clearance: null };
    if (t.statusCat !== 'done') return { ...base, state: 'NOT_RUN' };
    const lp = lastPassedAt(issueByKey[testKey], hist(testKey), statusCatById);
    if (lp.at === null) return { ...base, state: 'NOT_RUN' };
    const cs = substantiveChangeSince(issueByKey[itemKey], hist(itemKey), lp.at, fieldIds);
    if (!cs.changed) return { ...base, state: 'VERIFIED', passedAt: lp.at, passSource: lp.source };
    const fp = fingerprint({ kind: 'link', downKey: testKey, upKey: itemKey, sinceMs: lp.at, fields: cs.fields, reason: cs.reason });
    const clr = findClearance(clearances, 'link', testKey, itemKey, fp);
    return {
      ...base,
      state: clr ? 'CLEARED' : 'SUSPECT',
      passedAt: lp.at,
      passSource: lp.source,
      change: cs,
      fingerprint: fp,
      clearance: clr,
    };
  });

  // Upstream rule (one hop: requirement -> control; never propagates to the control's tests).
  // DEVIATION FROM CONTRACT v1 (deliberate): the reference point is max(control created, the
  // control's own latest substantive edit, measured as when its CURRENT text came into being, so an
  // edit that is later reverted does not move the reference). The contract also listed "latest clearance time",
  // but that would move the reference past the requirement's change, so a cleared flag would show
  // OK instead of CLEARED and acceptance test A4 ("upstream state CLEARED") could not hold.
  // A clearance is matched by fingerprint instead, which goes stale on any further change.
  /** @type {import('./types.js').UpstreamResult[]} */
  const allUpstream = graph.derives.map(({ ctrlKey, reqKey }) => {
    const c = graph.nodes[ctrlKey];
    const ownEdit = latestSubstantiveEditMs(hist(ctrlKey), fieldIds);
    const since = Math.max(c.createdMs, ownEdit ?? Number.NEGATIVE_INFINITY);
    const cs = substantiveChangeSince(issueByKey[reqKey], hist(reqKey), since, fieldIds, { allowCreatedAfter: false });
    const base = { ctrlKey, reqKey, since, change: null, fingerprint: null, clearance: null };
    if (!cs.changed) return { ...base, state: 'OK' };
    const fp = fingerprint({ kind: 'upstream', downKey: ctrlKey, upKey: reqKey, sinceMs: since, fields: cs.fields, reason: cs.reason });
    const clr = findClearance(clearances, 'upstream', ctrlKey, reqKey, fp);
    return { ...base, state: clr ? 'CLEARED' : 'UPSTREAM_CHANGED', change: cs, fingerprint: fp, clearance: clr };
  });

  // Items (requirements and controls).
  const release = opts?.release ?? null;
  const itemNodes = Object.values(graph.nodes)
    .filter((n) => n.role === 'req' || n.role === 'ctrl')
    .filter((n) => release === null || n.fixVersions.includes(release))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || compareKeys(a.key, b.key));
  const kept = new Set(itemNodes.map((n) => n.key));
  const links = allLinks.filter((l) => kept.has(l.itemKey));
  const upstream = allUpstream.filter((u) => kept.has(u.ctrlKey));

  /** @type {import('./types.js').ItemResult[]} */
  const items = itemNodes.map((n) => {
    const own = links.filter((l) => l.itemKey === n.key);
    const ups = upstream.filter((u) => u.ctrlKey === n.key);
    const flags = {
      missing: own.length === 0,
      suspect: own.filter((l) => l.state === 'SUSPECT').length,
      upstream: ups.filter((u) => u.state === 'UPSTREAM_CHANGED').length,
      notRun: own.filter((l) => l.state === 'NOT_RUN').length,
    };
    let state = 'READY';
    if (flags.missing) state = 'MISSING_TESTS';
    else if (flags.suspect > 0) state = 'SUSPECT';
    else if (flags.upstream > 0) state = 'UPSTREAM_CHANGED';
    else if (flags.notRun > 0) state = 'NOT_RUN';
    return {
      key: n.key,
      role: n.role,
      summary: n.summary,
      fixVersions: [...n.fixVersions],
      tests: own.map((l) => l.testKey).sort(compareKeys),
      state,
      flags,
    };
  });

  // Risks and orphan tests. With a release filter, a risk belongs to the release when its own
  // fixVersions include it or one of its controls is a kept item; an orphan test belongs to the
  // release when its own fixVersions include it. Without a filter, all are counted.
  const inRelease = (n) => release === null || n.fixVersions.includes(release);
  const riskNodes = Object.values(graph.nodes).filter((n) => n.role === 'risk').sort((a, b) => compareKeys(a.key, b.key));
  const risks = riskNodes
    .map((r) => {
      const controls = graph.mitigates.filter((m) => m.riskKey === r.key).map((m) => m.ctrlKey).sort(compareKeys);
      return { node: r, key: r.key, summary: r.summary, controls, mitigated: controls.length > 0 };
    })
    .filter((r) => inRelease(r.node) || r.controls.some((c) => kept.has(c)))
    .map(({ node, ...r }) => (void node, r));
  const verifiedTests = new Set(graph.verifies.map((v) => v.testKey));
  const orphanTests = Object.values(graph.nodes)
    .filter((n) => n.role === 'test' && !verifiedTests.has(n.key) && inRelease(n))
    .map((n) => n.key)
    .sort(compareKeys);

  const ready = readiness(items);
  const kpis = {
    items: items.length,
    ready: ready.ready,
    missingTests: items.filter((i) => i.state === 'MISSING_TESTS').length,
    suspectLinks: links.filter((l) => l.state === 'SUSPECT').length,
    clearedLinks: links.filter((l) => l.state === 'CLEARED').length,
    upstreamChanged: upstream.filter((u) => u.state === 'UPSTREAM_CHANGED').length,
    notRunLinks: links.filter((l) => l.state === 'NOT_RUN').length,
    risks: risks.length,
    unmitigatedRisks: risks.filter((r) => !r.mitigated).length,
    orphanTests: orphanTests.length,
    coveragePct: pctOf(items.filter((i) => i.tests.length > 0).length, items.length),
  };

  return {
    items: opts?.onlyGaps ? items.filter((i) => i.state !== 'READY') : items,
    links,
    upstream,
    risks,
    orphanTests,
    kpis,
    readiness: ready,
    warnings: [...graph.warnings],
    externalLinksIgnored: graph.externalLinksIgnored,
    release,
    engineVersion: ENGINE_VERSION,
  };
}
