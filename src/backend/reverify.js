// Re-verification task: a Jira task asking for a suspect test to be re-run (or, for an
// upstream flag, for a control to be reviewed). Runs as the user. Shared by the resolver and
// the Rovo CREATE action.
import { findTraceEntry, textToAdf } from '../engine/index.js';
import { AppError, CODES, expectOk, jiraErrorText } from './errors.js';
import { appendAudit } from './audit.js';
import { requirePermissions } from './permissions.js';
import { loadTraceAround } from './traceService.js';
import { pickIssueType, resolveLinkType, createLink } from './jiraOps.js';
import { jqlQuote, isoDate, p, withQuery } from './util.js';
import { K } from './keys.js';
import { searchAll } from './loader.js';

export const REVERIFY_LABEL = 'tb-reverify';

export function reverifySummary(downKey, upKey) {
  return `Re-verify ${downKey} against changed ${upKey}`;
}

/** Paragraphs for the task description. */
export function reverifyParagraphs({ kind, downKey, upKey, since, fields, note }) {
  // The backend does not know the reader's time zone, so state the time in UTC explicitly; a bare
  // date could be a day off from the local time shown in the drawer.
  const when = since === null || since === undefined ? 'its last verification' : `${isoDate(since).slice(0, 16).replace('T', ' ')} UTC`;
  const out = [kind === 'upstream'
    ? `Tracebound found that ${upKey} changed after ${downKey} was last updated on ${when}.`
    : `Tracebound found that ${upKey} changed after ${downKey} last passed on ${when}.`];
  for (const f of fields ?? []) {
    out.push(`Field ${f.fieldId}. Before: ${f.before || '(empty)'}`);
    out.push(`After: ${f.after || '(empty)'}`);
  }
  if (note && String(note).trim()) out.push(`Note: ${String(note).trim().slice(0, 1000)}`);
  out.push(kind === 'upstream'
    ? 'Created by Tracebound. Review the control against the changed requirement, update it if needed, or clear the flag with a reason.'
    : 'Created by Tracebound. Re-run the test and move it to a Done status to clear the suspect flag.');
  return out;
}

/**
 * The recorded task for (down, up) when it still exists and is not in a Done-category status.
 * @returns {Promise<string|null>}
 */
export async function openRecordedTask(jira, store, projectKey, downKey, upKey) {
  let rec;
  try {
    rec = await store.get(K.reverify(projectKey, downKey, upKey));
  } catch {
    return null;
  }
  if (!rec?.taskKey) return null;
  const res = await jira.get(withQuery(p`/rest/api/3/issue/${rec.taskKey}`, { fields: 'status,summary' }));
  if (!res.ok) return null; // deleted, moved or not visible: fall through to the search guard
  return res.json?.fields?.status?.statusCategory?.key === 'done' ? null : rec.taskKey;
}

/**
 * @param {{jira:object, store:object, now:()=>Date}} deps  jira is asUser
 * @param {{projectKey:string, downKey:string, upKey:string, note?:string, actor:string|null}} args
 */
export async function createReverifyTask(deps, args) {
  const { jira, store } = deps;
  const { projectKey, downKey, upKey } = args;
  const { trace, snapshot } = await loadTraceAround(deps, projectKey, upKey);
  const found = findTraceEntry(trace, downKey, upKey);
  if (!found) {
    throw new AppError(CODES.NOT_FOUND, `${downKey} is not linked to ${upKey} as a verification or derivation.`,
      { hint: 'Check both keys; the test (or control) must be linked to the requirement or control.' });
  }
  const { kind, entry } = found;
  const flagged = kind === 'link' ? entry.state === 'SUSPECT' : entry.state === 'UPSTREAM_CHANGED';
  if (!flagged) {
    throw new AppError(CODES.VALIDATION, `${downKey} against ${upKey} is ${entry.state}, so no re-verification task is needed.`,
      { hint: 'Only suspect links and upstream-changed controls get re-verification tasks.' });
  }

  // Duplicate guard 1: the task this app recorded for the pair, read by key with a direct GET
  // (strongly consistent; the search index may not show a task created moments ago).
  const recorded = await openRecordedTask(jira, store, projectKey, downKey, upKey);
  if (recorded) return { created: false, taskKey: recorded, kind };

  // Duplicate guard 2: an open task with our label, linked to the test, whose summary is exactly
  // ours (a substring test would let PUMP-7 match a task for PUMP-70).
  const wanted = reverifySummary(downKey, upKey);
  const jql = `labels = ${REVERIFY_LABEL} AND issue in linkedIssues(${jqlQuote(downKey)}) AND statusCategory != Done AND summary ~ ${jqlQuote(`"${upKey}"`)}`;
  const dup = await searchAll(jira, jql, { fields: ['summary', 'status'], max: 5, projectKey });
  const existing = dup.issues.find((i) => String(i.fields?.summary ?? '').trim() === wanted);
  if (existing) return { created: false, taskKey: existing.key, kind };

  await requirePermissions(jira, projectKey, ['CREATE_ISSUES', 'LINK_ISSUES'], 'create a re-verification task');
  const down = snapshot.issues.find((i) => i.key === downKey);
  const runLabel = (down?.fields?.labels ?? []).find((l) => /^tb-run-[a-z0-9]{8}$/.test(l));
  const issueType = await pickIssueType(jira, projectKey);
  const since = kind === 'link' ? entry.passedAt : entry.since;
  const fields = {
    project: { key: projectKey },
    issuetype: { id: issueType.id },
    summary: reverifySummary(downKey, upKey),
    description: textToAdf(reverifyParagraphs({ kind, downKey, upKey, since, fields: entry.change?.fields, note: args.note })),
    labels: runLabel ? [REVERIFY_LABEL, runLabel] : [REVERIFY_LABEL],
  };
  const assigneeId = down?.fields?.assignee?.accountId ?? null;
  let res = await jira.post('/rest/api/3/issue', { fields: assigneeId ? { ...fields, assignee: { accountId: assigneeId } } : fields });
  let assigneeDropped = false;
  if (!res.ok && res.status === 400 && assigneeId && res.json?.errors?.assignee) {
    assigneeDropped = true;
    res = await jira.post('/rest/api/3/issue', { fields });
  }
  if (!res.ok && res.status === 400) {
    throw new AppError(CODES.JIRA_ERROR, `Jira refused to create the task: ${jiraErrorText(res.json)}`,
      { hint: 'A required field in this project may block creation. Create the task by hand, or make the field optional.', details: res.json });
  }
  const created = expectOk(res, { endpoint: 'POST /rest/api/3/issue', permission: 'Create issues', as: jira.mode, projectKey });
  const taskKey = created.key;
  try {
    await store.set(K.reverify(projectKey, downKey, upKey), { taskKey, fingerprint: entry.fingerprint ?? null, at: deps.now().toISOString() });
  } catch {
    // The JQL guard still applies; a storage failure must not hide the created task.
  }
  const linkType = await resolveLinkType(jira);
  await createLink(jira, linkType.name, taskKey, downKey, projectKey);
  const rec = await appendAudit(store, projectKey, {
    type: 'REVERIFY_TASK_CREATED',
    actor: args.actor ?? null,
    subject: { downKey, upKey, taskKey },
    data: { kind, fingerprint: entry.fingerprint ?? null },
  }, deps.now().toISOString());
  return { created: true, taskKey, kind, assigneeDropped, linkTypeWarning: linkType.warning, auditSeq: rec.seq };
}
