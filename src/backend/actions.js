// Rovo action handlers (also exposed as rovo:mcp tools). Each returns a JSON string
// {summary, data} of at most ~50 KB, or {"error":{code,message,hint}}; none throws.
// GET actions never write. Jira reads run as the user; storage as the app.
import { impactOf } from '../engine/index.js';
import { toErrorResult, AppError, CODES } from './errors.js';
import { checkIssueKey, checkProjectKey, isoDate } from './util.js';
import { requirePermissions } from './permissions.js';
import { loadProjectTrace, loadTraceAround } from './traceService.js';
import { createReverifyTask } from './reverify.js';

export const MAX_ACTION_BYTES = 50000;
const WORDING = 'Tracebound supports evidence for design-control traceability (IEC 62304, ISO 14971, ISO 26262 style).';

/**
 * Rovo context. The rovo:action reference (read 2026-11-25) shows the Jira context
 * (cloudId, moduleKey, jira:{projectKey, issueKey, ...}) nested inside the PAYLOAD as
 * payload.context, and says the accountId is read from the second argument (the Forge invocation
 * context, documented as {installContext, principal:{accountId}, ...}). Both places are read,
 * the documented one first; which shape Rovo really sends is site check S13.
 */
export function rovoContextOf(payload) {
  const c = payload?.context;
  return c && typeof c === 'object' ? c : {};
}

/** Account id of the caller: invocation principal, then context.accountId, then payload.context. */
export function actorOf(payload, context) {
  return context?.principal?.accountId ?? context?.accountId ?? rovoContextOf(payload).accountId ?? null;
}

function projectKeyOf(payload, context) {
  const v = payload?.projectKey || rovoContextOf(payload).jira?.projectKey || context?.jira?.projectKey;
  if (!v) throw new AppError(CODES.VALIDATION, 'A Jira project key is required.', { hint: 'Ask the user which project, for example PUMP.' });
  return checkProjectKey(v);
}

/** Serialises, dropping list entries until the result fits. */
export function fitJson(obj, maxBytes = MAX_ACTION_BYTES) {
  let s = JSON.stringify(obj);
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  const copy = JSON.parse(s);
  const lists = Object.entries(copy.data ?? {}).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
  let truncated = false;
  while (Buffer.byteLength(s, 'utf8') > maxBytes && lists.some((k) => copy.data[k].length > 1)) {
    const longest = lists.reduce((a, b) => (copy.data[a].length >= copy.data[b].length ? a : b));
    copy.data[longest] = copy.data[longest].slice(0, Math.max(1, Math.floor(copy.data[longest].length * 0.7)));
    truncated = true;
    s = JSON.stringify({ ...copy, truncated });
  }
  return s;
}

const errJson = (e) => JSON.stringify({ error: toErrorResult(e).error });

function slimChange(change) {
  if (!change) return null;
  return {
    reason: change.reason,
    latestAt: isoDate(change.latestAt),
    fields: change.fields.map((f) => ({
      fieldId: f.fieldId,
      before: f.before,
      after: f.after,
      diff: f.diff,
      changedAt: isoDate(f.changedAt),
      changedBy: f.changedBy,
    })),
  };
}

/**
 * @param {{jiraUser:object, store:object, now:()=>Date}} deps
 */
export function makeActions(deps) {
  const userDeps = { jira: deps.jiraUser, jiraApp: deps.jiraApp, store: deps.store, now: deps.now };
  const run = (fn) => async (payload, context) => {
    try {
      return fitJson(await fn(payload ?? {}, context));
    } catch (e) {
      return errJson(e);
    }
  };

  const projectTrace = async (payload, context, opts = {}) => {
    const projectKey = projectKeyOf(payload, context);
    await requirePermissions(deps.jiraUser, projectKey, ['BROWSE_PROJECTS'], 'read traceability');
    const r = await loadProjectTrace(userDeps, projectKey, opts);
    return { projectKey, ...r };
  };

  return {
    getReadiness: run(async (payload, context) => {
      const release = payload.release ? String(payload.release) : null;
      const { projectKey, trace, info, cfg } = await projectTrace(payload, context, { release });
      const pct = trace.readiness.pct;
      return {
        summary: pct === null
          ? `${projectKey}${release ? ` release ${release}` : ''} has no requirements or controls with a Tracebound role yet.`
          : `${projectKey}${release ? ` release ${release}` : ''}: release readiness ${pct}% (${trace.readiness.ready} of ${trace.readiness.total} requirements and controls ready). ${WORDING}`,
        data: {
          projectKey, release, configured: cfg.configured, readiness: trace.readiness, kpis: trace.kpis,
          notReady: trace.items.filter((i) => i.state !== 'READY').map((i) => ({ key: i.key, role: i.role, summary: i.summary, state: i.state })),
          warnings: [...trace.warnings, ...info.warnings],
        },
      };
    }),

    listSuspects: run(async (payload, context) => {
      const { projectKey, trace } = await projectTrace(payload, context);
      const suspects = trace.links.filter((l) => l.state === 'SUSPECT').map((l) => ({
        testKey: l.testKey, itemKey: l.itemKey, lastPassedAt: isoDate(l.passedAt), change: slimChange(l.change),
      }));
      const upstream = trace.upstream.filter((u) => u.state === 'UPSTREAM_CHANGED').map((u) => ({
        controlKey: u.ctrlKey, requirementKey: u.reqKey, change: slimChange(u.change),
      }));
      return {
        summary: `${projectKey}: ${suspects.length} suspect verification link(s) and ${upstream.length} control(s) whose requirement changed.`,
        data: { projectKey, suspects, upstream },
      };
    }),

    getTraceGaps: run(async (payload, context) => {
      const release = payload.release ? String(payload.release) : null;
      const { projectKey, trace } = await projectTrace(payload, context, { release });
      const pick = (state) => trace.items.filter((i) => i.state === state).map((i) => ({ key: i.key, role: i.role, summary: i.summary }));
      const data = {
        projectKey,
        release,
        missingTests: pick('MISSING_TESTS'),
        suspect: pick('SUSPECT'),
        upstreamChanged: pick('UPSTREAM_CHANGED'),
        notRun: trace.links.filter((l) => l.state === 'NOT_RUN').map((l) => ({ testKey: l.testKey, itemKey: l.itemKey })),
        unmitigatedRisks: trace.risks.filter((r) => !r.mitigated).map((r) => ({ key: r.key, summary: r.summary })),
        orphanTests: trace.orphanTests,
        readiness: trace.readiness,
      };
      return {
        summary: `${projectKey}${release ? ` release ${release}` : ''}: ${data.missingTests.length} item(s) without tests, ${data.suspect.length} suspect, ${data.upstreamChanged.length} upstream changed, ${data.notRun.length} test link(s) not run, ${data.unmitigatedRisks.length} unmitigated risk(s), ${data.orphanTests.length} orphan test(s).`,
        data,
      };
    }),

    getChangeImpact: run(async (payload) => {
      const issueKey = checkIssueKey(payload.issueKey);
      const projectKey = issueKey.replace(/-\d+$/, '');
      const r = await loadTraceAround(userDeps, projectKey, issueKey);
      const impact = impactOf(r.trace, r.graph, issueKey);
      if (!impact) {
        return { summary: `${issueKey} has no Tracebound role (label it trace-req, trace-ctrl, trace-test or trace-risk).`, data: { issueKey, role: null } };
      }
      const links = impact.affectedLinks.map((l) => ({
        testKey: l.testKey, itemKey: l.itemKey, state: l.state, lastPassedAt: isoDate(l.passedAt),
      }));
      const suspect = links.filter((l) => l.state === 'SUSPECT').length;
      return {
        summary: `${issueKey} (${impact.role}) is ${impact.state ?? 'not an item'}: ${suspect} suspect test link(s), ${impact.derivedControls.length} related control(s), risks ${impact.risks.join(', ') || 'none'}.`,
        data: {
          issueKey,
          role: impact.role,
          summary: impact.summary,
          state: impact.state,
          changes: slimChange(impact.changes),
          links,
          upstream: impact.upstream.map((u) => ({ controlKey: u.ctrlKey, requirementKey: u.reqKey, state: u.state })),
          derivedControls: impact.derivedControls.map((c) => ({ controlKey: c.ctrlKey, state: c.state, itemState: c.itemState, risks: c.risks, tests: c.tests.map((t) => ({ testKey: t.testKey, state: t.state })) })),
          risks: impact.risks,
        },
      };
    }),

    createReverification: run(async (payload, context) => {
      const testKey = checkIssueKey(payload.testKey, 'testKey');
      const itemKey = checkIssueKey(payload.itemKey, 'itemKey');
      const projectKey = itemKey.replace(/-\d+$/, '');
      if (testKey.replace(/-\d+$/, '') !== projectKey) throw new AppError(CODES.VALIDATION, 'Both issues must be in the same project.');
      const r = await createReverifyTask(userDeps, { projectKey, downKey: testKey, upKey: itemKey, note: payload.note, actor: actorOf(payload, context) });
      return {
        summary: r.created
          ? `Created ${r.taskKey} to re-verify ${testKey} against ${itemKey}, linked to ${testKey} and recorded in the audit log.`
          : `An open re-verification task already exists: ${r.taskKey}. No new task was created.`,
        data: r,
      };
    }),
  };
}
