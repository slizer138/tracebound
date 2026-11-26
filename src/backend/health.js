// Setup / Health checks for the admin page. Each check says what to click next.
import { K } from './keys.js';
import { withQuery, p, jqlQuote } from './util.js';
import { getConfig } from './config.js';
import { traceJql, bulkFallsBack } from './loader.js';
import { tryParseJiraTime } from '../engine/index.js';
import { appAccessStep } from './hints.js';
import { PERMISSION_LABELS } from './permissions.js';
import { SEED_PERMISSIONS } from './seeder.js';

const check = (id, label, status, detail, nextStep = null) => ({ id, label, status, detail, nextStep });

/** No response, a rate limit or a server error: usually temporary, not an access problem. */
const isTemporary = (status) => !status || status === 429 || status >= 500;

function scopeHint(res, what) {
  if (res.status === 401 || res.status === 403) {
    return `Jira returned ${res.status} for ${what}. Reinstall the app so the read:jira-work, write:jira-work and storage:app scopes are granted, or check the project permission named here.`;
  }
  if (res.status === 429) return `Jira rate-limited ${what}. Run the check again in a minute.`;
  return `Jira returned ${res.status || 'no response'} for ${what}.`;
}

/**
 * @param {{jiraUser:object, jiraApp:object, store:object, now:()=>Date}} deps
 * @param {string|null} projectKey
 */
export async function runHealth(deps, projectKey) {
  const { jiraUser, jiraApp, store } = deps;
  const checks = [];
  const nowMs = deps.now().getTime();

  // 1. Storage round trip.
  try {
    const id = `${nowMs}`;
    await store.set(K.health(id), { at: nowMs }, { ttlMinutes: 1 });
    const back = await store.get(K.health(id));
    checks.push(back?.at === nowMs
      ? check('storage', 'App storage', 'pass', 'Wrote and read back a test value.')
      : check('storage', 'App storage', 'fail', 'A test value was written but could not be read back.', 'Reinstall the app to grant storage:app, then run the check again.'));
  } catch (e) {
    checks.push(check('storage', 'App storage', 'fail', e.message, 'Reinstall the app to grant storage:app, then run the check again.'));
  }

  // 2. Jira read as the app.
  const st = await jiraApp.get('/rest/api/3/status');
  checks.push(st.ok
    ? check('jira-app-read', 'Jira read as the app', 'pass', `Read ${Array.isArray(st.json) ? st.json.length : 0} workflow statuses.`)
    : check('jira-app-read', 'Jira read as the app', 'fail', scopeHint(st, 'GET /rest/api/3/status as the app'), 'Reinstall the app from Manage apps and accept the read:jira-work scope.'));

  // 3. Jira read as you.
  const me = await jiraUser.get(withQuery('/rest/api/3/mypermissions', { permissions: 'BROWSE_PROJECTS' }));
  checks.push(me.ok
    ? check('jira-user-read', 'Jira read as you', 'pass', 'Your permissions could be read.')
    : check('jira-user-read', 'Jira read as you', 'fail', scopeHint(me, 'GET /rest/api/3/mypermissions as you'), 'Open the app once from a project page and accept the consent prompt, then run the check again.'));

  checks.push(check('rovo', 'Rovo (optional)', 'info',
    'Tracebound works fully without Rovo. On sites with Rovo, the "Tracebound Audit Prep" agent and the MCP tools use the same checks.', null));

  if (!projectKey) {
    checks.push(check('project', 'Project checks', 'info', 'Enter a project key and click Check to run the project checks.', 'Type a project key (for example PUMP) and click Check.'));
    return { projectKey: null, checks };
  }

  // 4. Project config.
  let cfg;
  try {
    cfg = await getConfig(store, projectKey);
    checks.push(cfg.configured
      ? (cfg.errors.length
        ? check('config', 'Project settings', 'warn', `Saved settings have problems: ${cfg.errors.join(' ')}`, `Open ${projectKey} > Traceability > Settings and save valid settings.`)
        : check('config', 'Project settings', 'pass', `Role mode: ${cfg.config.roleMode}.`))
      : check('config', 'Project settings', 'warn', 'Tracebound is not set up for this project yet; default labels are assumed.', `Open ${projectKey} > Traceability and click "Use default labels" or "Load sample data".`));
  } catch (e) {
    checks.push(check('config', 'Project settings', 'fail', e.message, 'Check the storage check above first.'));
  }

  // 5. Role-labelled issue count.
  let firstIssueId = null;
  if (cfg) {
    const jql = traceJql(projectKey, cfg.config);
    const res = jql ? await jiraUser.post('/rest/api/3/search/jql', { jql, maxResults: 1, fields: ['summary'] }) : null;
    if (!res) {
      checks.push(check('trace-issues', 'Trace issues', 'warn', 'No role labels or issue types are configured.', `Open ${projectKey} > Traceability > Settings.`));
    } else if (res.ok) {
      const n = res.json?.issues?.length ?? 0;
      firstIssueId = res.json?.issues?.[0]?.id ?? null;
      checks.push(n > 0
        ? check('trace-issues', 'Trace issues', 'pass', 'At least one issue carries a Tracebound role.')
        : check('trace-issues', 'Trace issues', 'warn', `No issue in ${projectKey} has a role label (${Object.values(cfg.config.labels).join(', ')}).`, `Open ${projectKey} > Traceability and click "Load sample data", or add the labels to your issues.`));
    } else {
      checks.push(check('trace-issues', 'Trace issues', 'fail', scopeHint(res, `POST /rest/api/3/search/jql for ${projectKey}`), `Check that the project ${projectKey} exists and that you have Browse projects.`));
    }
  }

  // 6. Changelog bulkfetch probe.
  if (firstIssueId) {
    const res = await jiraUser.post('/rest/api/3/changelog/bulkfetch', { issueIdsOrKeys: [String(firstIssueId)], fieldIds: ['status', 'summary', 'description'], maxResults: 10 });
    if (res.ok && Array.isArray(res.json?.issueChangeLogs)) {
      // Every history time must be readable; one that is not would be ignored by the engine.
      const created = res.json.issueChangeLogs.flatMap((l) => (l?.changeHistories ?? []).map((h) => h?.created));
      const bad = created.filter((c) => tryParseJiraTime(c) === null);
      checks.push(bad.length
        ? check('changelog', 'Change history', 'warn', `Bulk changelog read works, but ${bad.length} change time(s) are in an unknown format (for example ${JSON.stringify(bad[0])}). Changes with such times would not be counted.`, `Run the check again later. Until it passes, review suspect links in ${projectKey} against each issue's History tab, and report the example value as an issue on the Tracebound source repository.`)
        : check('changelog', 'Change history', 'pass', created.length
          ? `Bulk changelog read works and its change times are readable (${typeof created[0] === 'number' ? 'epoch numbers' : 'timestamps'}).`
          : 'Bulk changelog read works.'));
    } else if (!res.ok && !bulkFallsBack(res)) {
      // The same rule as the loader: 429, 5xx and no response are temporary and are NOT bypassed.
      checks.push(check('changelog', 'Change history', 'warn',
        `Bulk changelog read returned ${res.status || 'no response'}. This is usually temporary; while it lasts, project views can fail with a Jira error.`,
        'Run the check again in a minute.'));
    } else {
      const one = await jiraUser.get(withQuery(p`/rest/api/3/issue/${firstIssueId}/changelog`, { maxResults: 1 }));
      checks.push(one.ok
        ? check('changelog', 'Change history', 'warn', `Bulk changelog read returned ${res.ok ? 'an unexpected response' : res.status}; Tracebound reads change history per issue instead (slower, first 150 issues per view).`, 'No action needed for projects under 150 trace issues.')
        : check('changelog', 'Change history', 'fail', scopeHint(one, 'the issue changelog'), 'Reinstall the app to grant read:jira-work.'));
    }
  } else {
    checks.push(check('changelog', 'Change history', 'warn', 'Skipped: there is no trace issue to probe yet.', 'Run the check again after loading sample data.'));
  }

  // 7. Your permissions for seeding.
  const perms = [...SEED_PERMISSIONS, 'DELETE_ISSUES', 'ADMINISTER_PROJECTS'];
  const pr = await jiraUser.get(withQuery('/rest/api/3/mypermissions', { projectKey, permissions: perms.join(',') }));
  if (pr.ok) {
    const missing = perms.filter((x) => pr.json?.permissions?.[x]?.havePermission !== true);
    const seedMissing = missing.filter((x) => SEED_PERMISSIONS.includes(x));
    checks.push(seedMissing.length === 0
      ? check('user-perms', 'Your project permissions', missing.length ? 'warn' : 'pass',
        missing.length ? `You can load sample data. Missing: ${missing.map((m) => PERMISSION_LABELS[m]).join(', ')} (needed to remove sample data or save settings).` : 'You can load and remove sample data and save settings.',
        missing.length ? 'Ask a Jira admin for the missing permissions if you need those actions.' : null)
      : check('user-perms', 'Your project permissions', 'fail', `To load sample data you are missing: ${seedMissing.map((m) => PERMISSION_LABELS[m]).join(', ')}.`, `Ask a Jira admin to grant them in ${projectKey}.`));
  } else {
    checks.push(check('user-perms', 'Your project permissions', 'fail', scopeHint(pr, 'GET /rest/api/3/mypermissions'), `Check that project ${projectKey} exists.`));
  }

  // 8. App write access (createmeta as the app). Only CREATE access is probed; link, transition
  // and delete access are not checked here (a failure shows up in the sample-data warnings).
  const cm = await jiraApp.get(withQuery(p`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, { maxResults: 50 }));
  if (cm.ok) {
    const types = cm.json?.issueTypes ?? cm.json?.values ?? [];
    checks.push(types.length
      ? check('app-write', 'App can create issues', 'pass', `The app can create ${types.map((t) => t.name).slice(0, 5).join(', ')} issues in ${projectKey}.`)
      : check('app-write', 'App can create issues', 'fail', `The app sees no issue type it can create in ${projectKey}.`, appAccessStep(projectKey)));
  } else if (isTemporary(cm.status)) {
    // The same split as the changelog probe: a rate limit, a server error or no response says
    // nothing about the app's access, so it is not reported as a permission failure.
    checks.push(check('app-write', 'App can create issues', 'warn',
      `Jira returned ${cm.status || 'no response'} for createmeta as the app. This is usually temporary, so the app's access to ${projectKey} could not be checked.`,
      'Run the check again in a minute.'));
  } else if (cm.status === 401 || cm.status === 403 || cm.status === 404) {
    checks.push(check('app-write', 'App can create issues', 'fail',
      `Jira returned ${cm.status} for createmeta as the app, so the app cannot create issues in ${projectKey}.`,
      appAccessStep(projectKey)));
  } else {
    checks.push(check('app-write', 'App can create issues', 'fail',
      `Jira returned ${cm.status} for createmeta as the app, so the app's access to ${projectKey} could not be confirmed.`,
      `Check that project ${projectKey} exists, then run the check again.`));
  }

  return { projectKey, checks, jql: cfg ? traceJql(projectKey, cfg.config) : null, sampleJql: `project = ${jqlQuote(projectKey)} AND labels = tb-sample` };
}

export { appAccessStep };
