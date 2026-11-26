// Loads config + Jira data + clearances and runs the engine. Shared by resolvers and actions.
import { computeTrace, buildGraph, compareKeys } from '../engine/index.js';
import { getConfig } from './config.js';
import { loadProjectSnapshot, loadNeighbourhood } from './loader.js';
import { listClearances } from './clearances.js';

/**
 * Whole project.
 * @param {{jira:object, jiraApp?:object, store:object, now:()=>Date}} deps  jiraApp (optional) fills the shared status cache
 * @param {string} projectKey
 * @param {{release?:string|null, onlyGaps?:boolean, includeDescription?:boolean, reconcileIssueIds?:string[]}} [opts]
 */
export async function loadProjectTrace(deps, projectKey, opts = {}) {
  const cfg = await getConfig(deps.store, projectKey);
  const nowMs = deps.now().getTime();
  const { snapshot, info } = await loadProjectSnapshot(deps.jira, projectKey, cfg.config, {
    store: deps.store, jiraApp: deps.jiraApp, nowMs, includeDescription: opts.includeDescription, reconcileIssueIds: opts.reconcileIssueIds,
  });
  const clearances = await listClearances(deps.store, projectKey);
  const trace = computeTrace(snapshot, cfg.config, clearances, { release: opts.release ?? null, onlyGaps: !!opts.onlyGaps });
  return { cfg, snapshot, info, clearances, trace };
}

/**
 * One issue and its neighbourhood.
 */
export async function loadTraceAround(deps, projectKey, issueKey, opts = {}) {
  const cfg = await getConfig(deps.store, projectKey);
  const nowMs = deps.now().getTime();
  const { snapshot, info } = await loadNeighbourhood(deps.jira, issueKey, cfg.config, {
    store: deps.store, jiraApp: deps.jiraApp, nowMs, includeDescription: opts.includeDescription,
  });
  const clearances = await listClearances(deps.store, projectKey);
  const trace = computeTrace(snapshot, cfg.config, clearances, {});
  const graph = buildGraph(snapshot, cfg.config);
  return { cfg, snapshot, info, clearances, trace, graph };
}

/** fixVersion names seen on requirements and controls (ignores any release filter), sorted. */
export function releasesOf(snapshot, config) {
  const names = new Set();
  for (const n of Object.values(buildGraph(snapshot, config).nodes)) {
    if (n.role !== 'req' && n.role !== 'ctrl') continue;
    for (const v of n.fixVersions) names.add(v);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export { compareKeys };
