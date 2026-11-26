// Jira write helpers shared by the seeder and the re-verification task.
import { AppError, CODES, expectOk, jiraErrorText } from './errors.js';
import { p, withQuery } from './util.js';
import { appAccessStep } from './hints.js';

const CREATEMETA_PAGE = 200; // the endpoint's maximum maxResults
const CREATEMETA_MAX_PAGES = 5;

/**
 * Every issue type the caller can create in a project. GET
 * /rest/api/3/issue/createmeta/{project}/issuetypes is paged (startAt, maxResults <= 200), so
 * pages are followed until isLast, total, or an empty page says there are no more (at most 5).
 * @returns {Promise<object[]>}
 */
export async function listCreatableIssueTypes(jira, projectKey) {
  const all = [];
  let startAt = 0;
  for (let page = 0; page < CREATEMETA_MAX_PAGES; page++) {
    const res = await jira.get(withQuery(p`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, { startAt, maxResults: CREATEMETA_PAGE }));
    const json = expectOk(res, {
      endpoint: `GET /rest/api/3/issue/createmeta/${projectKey}/issuetypes`, permission: 'Create issues', as: jira.mode, projectKey,
    });
    const types = json?.issueTypes ?? json?.values ?? [];
    all.push(...types);
    if (types.length === 0 || json?.isLast === true) break;
    const total = typeof json?.total === 'number' ? json.total : null;
    if (total !== null && startAt + types.length >= total) break;
    // Without isLast or total, a short page is the last one.
    const pageSize = typeof json?.maxResults === 'number' && json.maxResults > 0 ? json.maxResults : CREATEMETA_PAGE;
    if (total === null && json?.isLast !== false && types.length < pageSize) break;
    startAt += types.length;
  }
  return all;
}

/**
 * Issue type for new issues: "Task" if present, else the first standard (non-subtask,
 * hierarchy level 0) type. Uses GET /rest/api/3/issue/createmeta/{project}/issuetypes.
 * @returns {Promise<{id:string, name:string}>}
 */
export async function pickIssueType(jira, projectKey) {
  const types = await listCreatableIssueTypes(jira, projectKey);
  const standard = types.filter((t) => t && t.subtask !== true && (t.hierarchyLevel === undefined || t.hierarchyLevel === 0));
  const pick = standard.find((t) => String(t.name).toLowerCase() === 'task') ?? standard[0];
  if (!pick) {
    throw new AppError(CODES.JIRA_PERMISSION, `No issue type can be created in ${projectKey} by ${jira.mode === 'app' ? 'the app' : 'you'}.`,
      { hint: jira.mode === 'app' ? appAccessStep(projectKey) : `Check your "Create issues" permission in ${projectKey}.` });
  }
  return { id: String(pick.id), name: pick.name };
}

/**
 * "Relates" if the site has it, else the first link type (with a warning).
 * @returns {Promise<{name:string, warning:string|null}>}
 */
export async function resolveLinkType(jira) {
  const res = await jira.get('/rest/api/3/issueLinkType');
  const json = expectOk(res, { endpoint: 'GET /rest/api/3/issueLinkType', permission: 'Browse projects', as: jira.mode });
  const types = json?.issueLinkTypes ?? [];
  const relates = types.find((t) => String(t.name).toLowerCase() === 'relates');
  if (relates) return { name: relates.name, warning: null };
  if (!types.length) {
    throw new AppError(CODES.JIRA_ERROR, 'This Jira site has no issue link types.', { hint: 'Issue linking may be turned off in Jira settings > Issues > Issue linking.' });
  }
  return { name: types[0].name, warning: `There is no "Relates" link type, so "${types[0].name}" was used.` };
}

/** Creates a link with outward = downstream issue, inward = upstream issue. */
export async function createLink(jira, typeName, downKey, upKey, projectKey) {
  const res = await jira.post('/rest/api/3/issueLink', {
    type: { name: typeName }, outwardIssue: { key: downKey }, inwardIssue: { key: upKey },
  });
  expectOk(res, { endpoint: 'POST /rest/api/3/issueLink', permission: 'Link issues', as: jira.mode, projectKey });
}

/** Field names from a 400 create response, for "a required field blocks creation" errors. */
export function blockingFields(json) {
  return Object.keys(json?.errors ?? {});
}

export function createErrorText(json) {
  return jiraErrorText(json) || 'no details';
}

/**
 * Names of the issue types the caller can create in a project (createmeta), for validating
 * role-by-issue-type settings before they are saved.
 * @returns {Promise<string[]>}
 */
export async function projectIssueTypeNames(jira, projectKey) {
  const types = await listCreatableIssueTypes(jira, projectKey);
  return types.map((t) => String(t?.name ?? '')).filter(Boolean);
}
