// Resolver handlers as plain functions over injected deps, so they can be unit-tested with
// fakes. resolvers.js registers them on a @forge/resolver Resolver.
// Every handler returns {ok:true, data} or {ok:false, error:{code, message, hint}}; none throws.
// projectKey and issueKey come from req.context.extension, never from the payload, except on
// the admin page, where the typed project key is checked with mypermissions.
import { impactOf, findTraceEntry, DEFAULT_CONFIG } from '../engine/index.js';
import { AppError, CODES, toResult, isNeedsAuth } from './errors.js';
import { checkIssueKey, checkProjectKey } from './util.js';
import { K, queryAll } from './keys.js';
import { getConfig, saveConfig } from './config.js';
import { checkPermissions, requirePermissions } from './permissions.js';
import { loadProjectTrace, loadTraceAround, releasesOf } from './traceService.js';
import { clearEntry } from './clearances.js';
import { createReverifyTask } from './reverify.js';
import { startSeed, startRemove, reconcileRun } from './seeder.js';
import { freezeBaseline, listBaselines, getBaseline, verifyBaseline } from './baselines.js';
import { listAudit, verifyAudit } from './audit.js';
import { runHealth } from './health.js';
import { projectIssueTypeNames } from './jiraOps.js';

function projectFrom(req) {
  const key = req?.context?.extension?.project?.key;
  if (!key) throw new AppError(CODES.VALIDATION, 'This view must be opened from a Jira project.', { hint: 'Open a project, then Traceability.' });
  return checkProjectKey(key);
}

function issueFrom(req) {
  const key = req?.context?.extension?.issue?.key;
  if (!key) throw new AppError(CODES.VALIDATION, 'This panel must be opened from a Jira issue.');
  return checkIssueKey(key);
}

const actorOf = (req) => req?.context?.accountId ?? null;
const pl = (req) => req?.payload ?? {};
const UNFINISHED = new Set(['queued', 'running', 'removing']);

/** Both keys of a link must be in the context project. */
function checkPair(projectKey, downKey, upKey) {
  const d = checkIssueKey(downKey, 'downKey');
  const u = checkIssueKey(upKey, 'upKey');
  for (const k of [d, u]) {
    if (k.replace(/-\d+$/, '') !== projectKey) {
      throw new AppError(CODES.VALIDATION, `${k} is not in project ${projectKey}.`);
    }
  }
  return [d, u];
}

/**
 * @param {{jiraUser:object, jiraApp:object, store:object, queue:object, now:()=>Date, uuid:()=>string}} deps
 */
export function makeHandlers(deps) {
  const userDeps = { jira: deps.jiraUser, jiraApp: deps.jiraApp, store: deps.store, now: deps.now };

  async function seedStatus(projectKey, runId) {
    const stored = runId ? await deps.store.get(K.seedRun(runId)) : null;
    if (!stored || stored.projectKey !== projectKey) throw new AppError(CODES.NOT_FOUND, 'That sample-data run was not found.');
    // A run whose job died is marked failed here, so the page offers Retry or Remove.
    const run = await reconcileRun({ store: deps.store, queue: deps.queue, now: deps.now }, stored);
    let queue = null;
    if (UNFINISHED.has(run.status) && run.jobId) {
      try {
        queue = await deps.queue.stats(run.jobId);
      } catch {
        queue = null;
      }
    }
    return { run, queue };
  }

  /** Admin page: the project is typed by the user, so Browse projects is checked first. */
  async function adminProject(req) {
    const projectKey = checkProjectKey(pl(req).projectKey);
    await requirePermissions(deps.jiraUser, projectKey, ['BROWSE_PROJECTS'], 'use Tracebound in this project');
    return projectKey;
  }

  const seedDeps = () => ({ jira: deps.jiraUser, store: deps.store, queue: deps.queue, now: deps.now, uuid: deps.uuid });

  const h = {
    'project.getView': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const { release = null, onlyGaps = false } = pl(req);
      const r = await loadProjectTrace(userDeps, projectKey, { release: release || null, onlyGaps: !!onlyGaps });
      const ptr = await deps.store.get(K.seedProj(projectKey));
      const seed = ptr?.runId ? (await deps.store.get(K.seedRun(ptr.runId))) ?? null : null;
      return {
        projectKey,
        configured: r.cfg.configured,
        config: r.cfg.config,
        configErrors: r.cfg.errors,
        trace: r.trace,
        releases: releasesOf(r.snapshot, r.cfg.config),
        seed,
        info: { ...r.info, externalLinksIgnored: r.trace.externalLinksIgnored, computedAt: deps.now().toISOString() },
      };
    }),

    'project.getConfig': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const cfg = await getConfig(deps.store, projectKey);
      const perms = await checkPermissions(deps.jiraUser, projectKey, ['ADMINISTER_PROJECTS']);
      return { ...cfg, projectKey, canAdmin: perms.all };
    }),

    'project.saveConfig': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      await requirePermissions(deps.jiraUser, projectKey, ['ADMINISTER_PROJECTS'], 'change Tracebound settings');
      const input = pl(req).config ?? {};
      if (input.roleMode === 'issueTypes') {
        // A misspelled type would make every later search fail with a JQL 400.
        const names = new Set((await projectIssueTypeNames(deps.jiraUser, projectKey)).map((n) => n.toLowerCase()));
        const unknown = Object.entries(input.issueTypes ?? {})
          .filter(([, v]) => v && String(v).trim() && !names.has(String(v).trim().toLowerCase()))
          .map(([role, v]) => `${role}: "${String(v).trim()}"`);
        if (unknown.length) {
          throw new AppError(CODES.CONFIG_INVALID, `The settings were not saved: these issue types do not exist in ${projectKey}: ${unknown.join(', ')}.`,
            { hint: 'Pick issue types from the list for this project, or use role labels.' });
        }
      }
      return saveConfig(deps.store, projectKey, input, actorOf(req), deps.now().toISOString());
    }),

    // Issue types the caller can create in the context project (createmeta, as the user), for the
    // per-role Selects in Settings. saveConfig validates against the same list.
    'project.issueTypes': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const names = await projectIssueTypeNames(deps.jiraUser, projectKey);
      return { projectKey, names: [...new Set(names)].sort((a, b) => a.localeCompare(b)) };
    }),

    'project.useDefaults': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const cfg = await getConfig(deps.store, projectKey);
      if (cfg.configured) return cfg;
      await requirePermissions(deps.jiraUser, projectKey, ['BROWSE_PROJECTS', 'EDIT_ISSUES'], 'set up Tracebound');
      return saveConfig(deps.store, projectKey, DEFAULT_CONFIG, actorOf(req), deps.now().toISOString());
    }),

    'link.getImpact': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const [downKey, upKey] = checkPair(projectKey, pl(req).downKey, pl(req).upKey);
      const r = await loadTraceAround(userDeps, projectKey, upKey);
      const entry = findTraceEntry(r.trace, downKey, upKey);
      if (!entry) throw new AppError(CODES.NOT_FOUND, `${downKey} and ${upKey} are not linked as a verification or derivation.`, { hint: 'Refresh the page.' });
      return { entry, impact: impactOf(r.trace, r.graph, upKey), warnings: r.info.warnings };
    }),

    'link.clear': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const { kind, fingerprint, reason } = pl(req);
      const [downKey, upKey] = checkPair(projectKey, pl(req).downKey, pl(req).upKey);
      return clearEntry(userDeps, { projectKey, downKey, upKey, kind, fingerprint, reason, actor: actorOf(req) });
    }),

    'link.createReverifyTask': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      const [downKey, upKey] = checkPair(projectKey, pl(req).downKey, pl(req).upKey);
      return createReverifyTask(userDeps, { projectKey, downKey, upKey, note: pl(req).note, actor: actorOf(req) });
    }),

    'seed.start': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      return startSeed(seedDeps(), { projectKey, actor: actorOf(req) });
    }),

    'seed.status': (req) => toResult(async () => seedStatus(projectFrom(req), String(pl(req).runId ?? ''))),

    'seed.remove': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      return startRemove(seedDeps(), { projectKey, runId: String(pl(req).runId ?? '') });
    }),

    // Admin-page variants: same logic, project typed by the user and permission-checked.
    'admin.seedStart': (req) => toResult(async () => {
      const projectKey = await adminProject(req);
      return startSeed(seedDeps(), { projectKey, actor: actorOf(req) });
    }),

    'admin.seedStatus': (req) => toResult(async () => {
      const projectKey = await adminProject(req);
      // An explicit runId keeps polling a run after "Remove sample data" clears the project pointer.
      const runId = pl(req).runId ? String(pl(req).runId) : (await deps.store.get(K.seedProj(projectKey)))?.runId;
      if (!runId) return { run: null, queue: null };
      return seedStatus(projectKey, runId);
    }),

    'admin.seedRemove': (req) => toResult(async () => {
      const projectKey = await adminProject(req);
      return startRemove(seedDeps(), { projectKey, runId: String(pl(req).runId ?? '') });
    }),

    'baseline.freeze': (req) => toResult(async () => {
      const projectKey = projectFrom(req);
      await requirePermissions(deps.jiraUser, projectKey, ['BROWSE_PROJECTS', 'EDIT_ISSUES'], 'freeze a baseline');
      const { meta } = await freezeBaseline(userDeps, { projectKey, name: pl(req).name, release: pl(req).release || null, actor: actorOf(req) });
      return meta;
    }),

    'baseline.list': (req) => toResult(async () => listBaselines(deps.store, projectFrom(req))),
    'baseline.get': (req) => toResult(async () => getBaseline(deps.store, projectFrom(req), String(pl(req).id ?? ''))),
    'baseline.verify': (req) => toResult(async () => verifyBaseline(deps.store, projectFrom(req), String(pl(req).id ?? ''))),

    'audit.list': (req) => toResult(async () => listAudit(deps.store, projectFrom(req), { beforeSeq: pl(req).beforeSeq, limit: pl(req).limit })),
    'audit.verify': (req) => toResult(async () => verifyAudit(deps.store, projectFrom(req))),

    'issue.getPanel': (req) => toResult(async () => {
      const issueKey = issueFrom(req);
      const projectKey = req?.context?.extension?.project?.key ? projectFrom(req) : issueKey.replace(/-\d+$/, '');
      const r = await loadTraceAround(userDeps, projectKey, issueKey);
      const node = r.graph.nodes[issueKey];
      const base = {
        issueKey,
        projectKey,
        configured: r.cfg.configured,
        labels: r.cfg.config.labels,
        roleMode: r.cfg.config.roleMode ?? 'labels',
        testIssueType: r.cfg.config.issueTypes?.test ?? null,
        computedAt: deps.now().toISOString(), warnings: r.info.warnings };
      if (!node) return { ...base, role: null };
      const impact = impactOf(r.trace, r.graph, issueKey);
      const item = r.trace.items.find((i) => i.key === issueKey) ?? null;
      const links = node.role === 'test'
        ? r.trace.links.filter((l) => l.testKey === issueKey)
        : r.trace.links.filter((l) => l.itemKey === issueKey);
      return {
        ...base,
        role: node.role,
        summary: node.summary,
        itemState: item?.state ?? null,
        flags: item?.flags ?? null,
        links,
        upstream: r.trace.upstream.filter((u) => u.ctrlKey === issueKey),
        ripple: impact,
      };
    }),

    'admin.health': (req) => toResult(async () => {
      // The resolver function is shared by every module, so a typed project key is checked
      // with Browse projects before any project probe (some run as the app).
      const projectKey = pl(req).projectKey ? await adminProject(req) : null;
      return runHealth({ jiraUser: deps.jiraUser, jiraApp: deps.jiraApp, store: deps.store, now: deps.now }, projectKey);
    }),

    'admin.listProjects': () => toResult(async () => {
      const rows = await queryAll(deps.store, K.configPrefix);
      const out = [];
      for (const r of rows) {
        const projectKey = r.key.slice(K.configPrefix.length);
        // Only projects the caller can browse are listed (asUser mypermissions per row).
        let visible = false;
        try {
          visible = (await checkPermissions(deps.jiraUser, checkProjectKey(projectKey), ['BROWSE_PROJECTS'])).all;
        } catch (e) {
          if (isNeedsAuth(e)) throw e;
          visible = false; // deleted project, invalid key or no access: not listed
        }
        if (!visible) continue;
        const ptr = await deps.store.get(K.seedProj(projectKey));
        const run = ptr?.runId ? await deps.store.get(K.seedRun(ptr.runId)) : null;
        out.push({
          projectKey,
          roleMode: r.value?.roleMode ?? 'labels',
          updatedAt: r.value?.updatedAt ?? null,
          seed: run ? { status: run.status, actual: run.actual?.readinessPct ?? null } : null,
        });
      }
      return out.sort((a, b) => a.projectKey.localeCompare(b.projectKey));
    }),
  };
  return h;
}

export const RESOLVER_KEYS = Object.freeze(Object.keys(makeHandlers({})));
