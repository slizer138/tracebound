// Project permission checks via GET /rest/api/3/mypermissions (read:jira-work).
import { AppError, CODES, expectOk } from './errors.js';
import { withQuery } from './util.js';

export const PERMISSION_LABELS = Object.freeze({
  BROWSE_PROJECTS: 'Browse projects',
  CREATE_ISSUES: 'Create issues',
  EDIT_ISSUES: 'Edit issues',
  LINK_ISSUES: 'Link issues',
  TRANSITION_ISSUES: 'Transition issues',
  DELETE_ISSUES: 'Delete issues',
  ADMINISTER_PROJECTS: 'Administer projects',
});

/**
 * @returns {Promise<{all:boolean, have:string[], missing:string[]}>}
 */
export async function checkPermissions(jira, projectKey, perms) {
  const path = withQuery('/rest/api/3/mypermissions', { projectKey, permissions: perms.join(',') });
  const res = await jira.get(path);
  const json = expectOk(res, { endpoint: 'GET /rest/api/3/mypermissions', permission: 'Browse projects', as: jira.mode, projectKey });
  const have = [];
  const missing = [];
  for (const perm of perms) {
    if (json?.permissions?.[perm]?.havePermission === true) have.push(perm);
    else missing.push(perm);
  }
  return { all: missing.length === 0, have, missing };
}

/** Throws FORBIDDEN naming each missing permission. */
export async function requirePermissions(jira, projectKey, perms, action) {
  const r = await checkPermissions(jira, projectKey, perms);
  if (!r.all) {
    const names = r.missing.map((m) => PERMISSION_LABELS[m] ?? m);
    throw new AppError(CODES.FORBIDDEN, `To ${action} you need these permissions in ${projectKey}: ${names.join(', ')}.`,
      { hint: 'Ask a Jira admin to grant them in the project\'s permission scheme (or project access for team-managed projects).', details: { missing: r.missing } });
  }
  return r;
}
