// Status id -> status category ('new'|'indeterminate'|'done'), from GET /rest/api/3/status,
// cached in KVS for 10 minutes. Needs only read:jira-work (statuses/search would need
// manage:jira-configuration, which Tracebound does not request).
import { expectOk } from './errors.js';
import { K } from './keys.js';

export const STATUS_TTL_MINUTES = 10;
const CATS = new Set(['new', 'indeterminate', 'done']);

export function mapStatuses(list) {
  const byId = {};
  for (const s of Array.isArray(list) ? list : []) {
    const cat = s?.statusCategory?.key;
    if (s?.id !== undefined && CATS.has(cat)) byId[String(s.id)] = cat;
  }
  return byId;
}

/**
 * @param {object} jira
 * @param {object} store
 * @param {number} nowMs
 * @returns {Promise<Object<string,string>>}
 */
export async function getStatusCats(jira, store, nowMs, { force = false } = {}) {
  let cached;
  try {
    cached = force ? undefined : await store.get(K.statuses);
  } catch {
    cached = undefined;
  }
  if (cached && cached.byId && nowMs - cached.at < STATUS_TTL_MINUTES * 60000) return cached.byId;
  const res = await jira.get('/rest/api/3/status');
  const json = expectOk(res, { endpoint: 'GET /rest/api/3/status', permission: 'Browse projects', as: jira.mode });
  const byId = mapStatuses(json);
  try {
    await store.set(K.statuses, { at: nowMs, byId }, { ttlMinutes: STATUS_TTL_MINUTES });
  } catch {
    // The cache is an optimisation; a storage failure must not break the view.
  }
  return byId;
}

/** Status ids referenced by the issues' current status and by status items in their changelogs. */
export function referencedStatusIds(issues, changelogs) {
  const ids = new Set();
  for (const i of issues ?? []) if (i?.fields?.status?.id !== undefined) ids.add(String(i.fields.status.id));
  for (const list of Object.values(changelogs ?? {})) {
    for (const h of list ?? []) {
      for (const it of h.items ?? []) {
        const isStatus = it?.fieldId === 'status' || (!it?.fieldId && it?.field === 'status');
        if (!isStatus) continue;
        if (it.to !== null && it.to !== undefined) ids.add(String(it.to));
      }
    }
  }
  return ids;
}

/**
 * Status categories for a snapshot. The cache is shared by every user and project, so it is
 * filled AS THE APP (GET /rest/api/3/status returns only statuses the caller can browse); if the
 * app read fails, the user's view is used for this call only and NOT cached. When a referenced
 * status id is missing (a status created after the cache was filled), the list is refetched once.
 * @param {{jira:object, jiraApp?:object, store:object, nowMs:number}} deps
 */
export async function statusCatsFor({ jira, jiraApp, store, nowMs }, issues, changelogs) {
  const reader = jiraApp ?? jira;
  const load = async (force) => {
    try {
      return await getStatusCats(reader, store, nowMs, { force });
    } catch (e) {
      if (reader === jira) throw e;
      const res = await jira.get('/rest/api/3/status');
      return mapStatuses(expectOk(res, { endpoint: 'GET /rest/api/3/status', permission: 'Browse projects', as: jira.mode }));
    }
  };
  let byId = await load(false);
  const missing = [...referencedStatusIds(issues, changelogs)].some((id) => !byId[id]);
  if (missing) byId = await load(true);
  return byId;
}
