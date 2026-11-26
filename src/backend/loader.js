// Builds engine Snapshots from Jira: search/jql (nextPageToken paging) plus changelogs
// (bulkfetch, with a capped per-issue fallback).
import { AppError, CODES, expectOk } from './errors.js';
import { jqlQuote, mapLimit, p, withQuery, chunk } from './util.js';
import { statusCatsFor } from './statusCache.js';
import { epochToMs, toJiraTime } from '../engine/index.js';

export const MAX_ISSUES = 500;
export const PAGE_SIZE = 100;
export const PER_ISSUE_CAP = 150;
export const PER_ISSUE_CONCURRENCY = 8;
export const NEIGHBOURHOOD_CAP = 200;

export const SEARCH_FIELDS = Object.freeze([
  'summary', 'status', 'labels', 'issuetype', 'issuelinks', 'fixVersions', 'created',
  'statuscategorychangedate', 'assignee',
]);

/** JQL selecting the trace issues of one project under a config. */
export function traceJql(projectKey, config) {
  const values = config.roleMode === 'issueTypes'
    ? Object.values(config.issueTypes ?? {}).filter(Boolean)
    : Object.values(config.labels);
  const field = config.roleMode === 'issueTypes' ? 'issuetype' : 'labels';
  if (!values.length) return null;
  return `project = ${jqlQuote(projectKey)} AND ${field} in (${values.map(jqlQuote).join(', ')}) ORDER BY key ASC`;
}

/**
 * Paged POST /rest/api/3/search/jql.
 * @returns {Promise<{issues:object[], truncated:boolean}>}
 */
export async function searchAll(jira, jql, { fields = SEARCH_FIELDS, max = MAX_ISSUES, reconcileIssues, projectKey } = {}) {
  const issues = [];
  let nextPageToken;
  let truncated = false;
  for (let page = 0; page < 1000; page++) {
    const body = { jql, maxResults: PAGE_SIZE, fields: [...fields] };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    if (reconcileIssues?.length) body.reconcileIssues = reconcileIssues.slice(0, 50).map(Number);
    const res = await jira.post('/rest/api/3/search/jql', body);
    const json = expectOk(res, { endpoint: 'POST /rest/api/3/search/jql', permission: 'Browse projects', as: jira.mode, projectKey });
    for (const i of json?.issues ?? []) {
      if (issues.length >= max) {
        truncated = true;
        break;
      }
      issues.push(i);
    }
    nextPageToken = json?.nextPageToken;
    if (truncated) break;
    if (!nextPageToken || !(json?.issues?.length)) break;
    if (issues.length >= max) {
      truncated = true;
      break;
    }
  }
  return { issues, truncated };
}

function keepItem(item, fieldIds) {
  const id = item.fieldId ?? item.field;
  return id === 'status' || fieldIds.includes(id);
}

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const ownOrNull = (o, k) => (hasOwn(o, k) && o[k] !== undefined ? o[k] : null);
const ownText = (o, k) => (hasOwn(o, k) && typeof o[k] === 'string' ? o[k] : null);

/** A changelog item with exactly the keys the engine reads, each an own value or null. */
export function cleanItem(it) {
  const out = {
    field: ownOrNull(it, 'field'),
    from: ownOrNull(it, 'from'),
    fromString: ownText(it, 'fromString'),
    to: ownOrNull(it, 'to'),
    toString: ownText(it, 'toString'),
  };
  if (hasOwn(it, 'fieldId') && it.fieldId !== undefined && it.fieldId !== null) out.fieldId = it.fieldId;
  if (hasOwn(it, 'fieldtype')) out.fieldtype = it.fieldtype;
  return out;
}

/**
 * History "created" as a Jira time string. Bulkfetch may return epoch seconds or ms (the v3
 * OpenAPI example shows a number); every snapshot carries the string form, which baselines and
 * the UI already understand.
 */
export function cleanCreated(created) {
  const ms = epochToMs(created);
  return ms === null ? created : toJiraTime(ms);
}

function filterHistories(histories, fieldIds) {
  const out = [];
  for (const h of histories ?? []) {
    const items = (h.items ?? []).filter((it) => it && keepItem(it, fieldIds)).map(cleanItem);
    if (items.length) out.push({ id: String(h.id), created: cleanCreated(h.created), author: h.author ? { accountId: h.author.accountId } : undefined, items });
  }
  return out;
}

/**
 * Whether a non-ok bulkfetch response means "use the per-issue changelog instead". Every client
 * error falls back (400, 401, 403, 404, 405, 410 ...: Forge access to this endpoint is not
 * verified on a site, see risk R3). Rate limits (429), server errors (5xx) and no response (0)
 * are temporary, so they are reported instead of silently switching paths. The health check
 * uses the same predicate.
 * @param {{ok:boolean, status:number}} res
 */
export function bulkFallsBack(res) {
  return !res.ok && res.status !== 0 && res.status !== 429 && res.status < 500;
}

/**
 * POST /rest/api/3/changelog/bulkfetch. Returns null when the endpoint is unavailable (any
 * client error, see bulkFallsBack, or an unexpected response shape), so the caller can fall back.
 */
export async function bulkChangelogs(jira, issueIds, fieldIds) {
  const out = Object.fromEntries(issueIds.map((id) => [String(id), []]));
  const fields = ['status', ...fieldIds.filter((f) => f !== 'status')].slice(0, 10);
  for (const ids of chunk(issueIds.map(String), 1000)) {
    let nextPageToken;
    for (let page = 0; page < 1000; page++) {
      const body = { issueIdsOrKeys: ids, fieldIds: fields, maxResults: 1000 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const res = await jira.post('/rest/api/3/changelog/bulkfetch', body);
      if (bulkFallsBack(res)) return null;
      const json = expectOk(res, { endpoint: 'POST /rest/api/3/changelog/bulkfetch', permission: 'Browse projects', as: jira.mode });
      if (!json || !Array.isArray(json.issueChangeLogs)) return null;
      for (const log of json.issueChangeLogs) {
        const id = String(log.issueId);
        (out[id] ??= []).push(...filterHistories(log.changeHistories, fields));
      }
      nextPageToken = json.nextPageToken;
      if (!nextPageToken) break;
    }
  }
  return out;
}

/** GET /rest/api/3/issue/{id}/changelog, all pages. */
export async function issueChangelog(jira, issueId, fieldIds) {
  const out = [];
  let startAt = 0;
  for (let page = 0; page < 100; page++) {
    const res = await jira.get(withQuery(p`/rest/api/3/issue/${issueId}/changelog`, { startAt, maxResults: 100 }));
    const json = expectOk(res, { endpoint: 'GET /rest/api/3/issue/{id}/changelog', permission: 'Browse projects', as: jira.mode });
    const values = json?.values ?? [];
    out.push(...filterHistories(values, ['status', ...fieldIds]));
    startAt += values.length;
    if (json?.isLast === true || values.length === 0 || (typeof json?.total === 'number' && startAt >= json.total)) break;
  }
  return out;
}

/**
 * Changelogs for a list of issues: bulk first, per-issue fallback (capped).
 * @returns {Promise<{changelogs:Object<string,object[]>, source:'bulk'|'per-issue', warnings:string[], missing:number}>}
 */
export async function loadChangelogs(jira, issueIds, fieldIds) {
  if (!issueIds.length) return { changelogs: {}, source: 'bulk', warnings: [], missing: 0 };
  const bulk = await bulkChangelogs(jira, issueIds, fieldIds);
  if (bulk) return { changelogs: bulk, source: 'bulk', warnings: [], missing: 0 };
  const changelogs = {};
  const capped = issueIds.slice(0, PER_ISSUE_CAP);
  const lists = await mapLimit(capped, PER_ISSUE_CONCURRENCY, (id) => issueChangelog(jira, id, fieldIds));
  capped.forEach((id, i) => { changelogs[String(id)] = lists[i]; });
  const warnings = [];
  const missing = issueIds.length - capped.length;
  if (missing > 0) {
    for (const id of issueIds.slice(PER_ISSUE_CAP)) changelogs[String(id)] = [];
    warnings.push(`The bulk changelog endpoint is not available, so changelogs were read per issue for the first ${PER_ISSUE_CAP} issues only; ${missing} issues have no change history in this view and may show as verified or not run incorrectly.`);
  }
  return { changelogs, source: 'per-issue', warnings, missing };
}

/**
 * @param {object} jira
 * @param {string} projectKey
 * @param {object} config  engine Config
 * @param {{store:object, nowMs:number, jiraApp?:object, includeDescription?:boolean, reconcileIssueIds?:string[], maxIssues?:number}} opts  jiraApp fills the shared status cache
 */
export async function loadProjectSnapshot(jira, projectKey, config, opts) {
  const jql = traceJql(projectKey, config);
  if (!jql) {
    return {
      snapshot: { issues: [], changelogs: {}, statusCatById: {}, projectKey },
      info: { issueCount: 0, truncated: false, changelogSource: 'bulk', warnings: ['No role labels or issue types are configured.'] },
    };
  }
  const fields = opts.includeDescription ? [...SEARCH_FIELDS, 'description'] : SEARCH_FIELDS;
  let found;
  try {
    found = await searchAll(jira, jql, {
      fields, max: opts.maxIssues ?? MAX_ISSUES, reconcileIssues: opts.reconcileIssueIds, projectKey,
    });
  } catch (e) {
    // JQL with an issue type name that does not exist fails with 400. Report it as a config
    // problem so the page shows the Settings form next to the error.
    if (config.roleMode === 'issueTypes' && e?.status === 400) {
      throw new AppError(CODES.CONFIG_INVALID,
        `Jira rejected the issue-type names in Tracebound's settings: ${e.message}`,
        { hint: 'Fix the issue-type names in Settings below, or switch Role mode back to labels.' });
    }
    throw e;
  }
  const { issues, truncated } = found;
  const cl = await loadChangelogs(jira, issues.map((i) => i.id), config.substantiveFieldIds);
  const statusCatById = await statusCatsFor({ jira, jiraApp: opts.jiraApp, store: opts.store, nowMs: opts.nowMs }, issues, cl.changelogs);
  const warnings = [...cl.warnings];
  if (truncated) warnings.push(`Showing the first ${opts.maxIssues ?? MAX_ISSUES} trace issues.`);
  return {
    snapshot: { issues, changelogs: cl.changelogs, statusCatById, projectKey },
    info: { issueCount: issues.length, truncated, changelogSource: cl.source, warnings },
  };
}

function linkedKeys(issue) {
  const out = [];
  for (const l of issue?.fields?.issuelinks ?? []) {
    const other = l.inwardIssue ?? l.outwardIssue;
    if (other?.key) out.push(other.key);
  }
  return out;
}

async function fetchByKeys(jira, keys, fields, projectKey) {
  const out = [];
  for (const group of chunk(keys, 100)) {
    const jql = `key in (${group.map(jqlQuote).join(', ')})`;
    const { issues } = await searchAll(jira, jql, { fields, max: 100, projectKey });
    out.push(...issues);
  }
  return out;
}

/**
 * The issue, its 1-hop neighbours, and the neighbours of neighbouring controls (their tests,
 * requirements and risks). Enough to compute every link and upstream entry that touches the issue.
 */
export async function loadNeighbourhood(jira, issueKey, config, opts) {
  const projectKey = issueKey.replace(/-\d+$/, '');
  const fields = opts.includeDescription ? [...SEARCH_FIELDS, 'description'] : SEARCH_FIELDS;
  const byKey = new Map();
  const sameProject = (k) => k.replace(/-\d+$/, '') === projectKey;
  const root = await fetchByKeys(jira, [issueKey], fields, projectKey);
  if (!root.length) {
    throw new AppError(CODES.NOT_FOUND, `Issue ${issueKey} was not found or you cannot browse it.`,
      { hint: 'Check the key and your Browse projects permission.' });
  }
  for (const i of root) byKey.set(i.key, i);
  const hop1 = [...new Set(linkedKeys(root[0]).filter(sameProject))].filter((k) => !byKey.has(k));
  for (const i of await fetchByKeys(jira, hop1.slice(0, NEIGHBOURHOOD_CAP), fields, projectKey)) byKey.set(i.key, i);
  const ctrlLabel = String(config.labels?.ctrl ?? '').toLowerCase();
  const ctrlType = String(config.issueTypes?.ctrl ?? '').toLowerCase();
  const isCtrl = (i) => (config.roleMode === 'issueTypes'
    ? ctrlType && String(i.fields?.issuetype?.name ?? '').toLowerCase() === ctrlType
    : (i.fields?.labels ?? []).some((l) => String(l).toLowerCase() === ctrlLabel));
  const hop2 = new Set();
  for (const i of byKey.values()) {
    if (!isCtrl(i)) continue;
    for (const k of linkedKeys(i)) if (sameProject(k) && !byKey.has(k)) hop2.add(k);
  }
  const room = Math.max(0, NEIGHBOURHOOD_CAP - byKey.size);
  for (const i of await fetchByKeys(jira, [...hop2].slice(0, room), fields, projectKey)) byKey.set(i.key, i);
  const issues = [...byKey.values()];
  const cl = await loadChangelogs(jira, issues.map((i) => i.id), config.substantiveFieldIds);
  const statusCatById = await statusCatsFor({ jira, jiraApp: opts.jiraApp, store: opts.store, nowMs: opts.nowMs }, issues, cl.changelogs);
  return {
    snapshot: { issues, changelogs: cl.changelogs, statusCatById, projectKey },
    info: { issueCount: issues.length, truncated: hop2.size > room, changelogSource: cl.source, warnings: cl.warnings },
  };
}
