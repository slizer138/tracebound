// Builds the trace graph (who verifies, derives from, or mitigates whom) from Jira issues and links.
import { resolveRole } from './roles.js';
import { currentStatusId, currentStatusCat, issueCreatedMs } from './changes.js';

/**
 * Natural order for issue keys: project prefix, then the number.
 * @param {string} a
 * @param {string} b
 */
export function compareKeys(a, b) {
  const ma = /^(.*?)-(\d+)$/.exec(String(a));
  const mb = /^(.*?)-(\d+)$/.exec(String(b));
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
    return Number(ma[2]) - Number(mb[2]);
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Project key part of an issue key ("PUMP-12" -> "PUMP"). */
export function projectOfKey(key) {
  const m = /^(.*)-\d+$/.exec(String(key));
  return m ? m[1] : null;
}

const PAIRS = {
  'req|test': 'verifies',
  'ctrl|test': 'verifies',
  'ctrl|req': 'derives',
  'ctrl|risk': 'mitigates',
};

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {import('./types.js').Config} cfg
 */
export function buildGraph(snapshot, cfg) {
  const issues = snapshot?.issues ?? [];
  const changelogs = snapshot?.changelogs ?? {};
  const statusCatById = snapshot?.statusCatById ?? {};
  const projectKey = snapshot?.projectKey ?? null;
  const warnings = [];

  const allKeys = new Set(issues.map((i) => i.key));
  /** @type {Object<string, any>} */
  const nodes = {};
  /** @type {Object<string, import('./types.js').JiraIssue>} */
  const issueByKey = {};
  for (const issue of issues) {
    if (!issue?.key || nodes[issue.key]) continue;
    const { role, ambiguous, matched } = resolveRole(issue, cfg);
    if (!role) continue;
    const histories = changelogs[issue.id] ?? [];
    if (ambiguous) {
      warnings.push(`${issue.key} has several roles (${matched.join(', ')}); it is treated as ${role}.`);
    }
    issueByKey[issue.key] = issue;
    nodes[issue.key] = {
      key: issue.key,
      id: String(issue.id),
      role,
      summary: String(issue.fields?.summary ?? ''),
      statusId: currentStatusId(issue, histories),
      statusCat: currentStatusCat(issue, histories, statusCatById),
      fixVersions: (issue.fields?.fixVersions ?? []).map((v) => v?.name).filter(Boolean),
      assigneeId: issue.fields?.assignee?.accountId ?? null,
      createdMs: issueCreatedMs(issue),
      ambiguous,
    };
  }

  const allow = Array.isArray(cfg?.linkTypeAllowlist) && cfg.linkTypeAllowlist.length
    ? new Set(cfg.linkTypeAllowlist.map((n) => n.toLowerCase()))
    : null;

  const seen = new Set();
  const external = new Set();
  const verifies = [];
  const derives = [];
  const mitigates = [];
  for (const key of Object.keys(nodes)) {
    for (const link of issueByKey[key].fields?.issuelinks ?? []) {
      const other = link?.inwardIssue ?? link?.outwardIssue;
      const otherKey = other?.key;
      if (!otherKey || otherKey === key) continue;
      if (!allKeys.has(otherKey)) {
        const p = projectOfKey(otherKey);
        if (projectKey && p && p !== projectKey) external.add(link.id ? `id:${link.id}` : `${key}>${otherKey}`);
        continue;
      }
      const otherNode = nodes[otherKey];
      if (!otherNode) continue; // linked issue without a role
      if (allow && !allow.has(String(link?.type?.name ?? '').toLowerCase())) continue;
      const a = nodes[key];
      const [x, y] = [a, otherNode].sort((p, q) => (p.role < q.role ? -1 : p.role > q.role ? 1 : 0));
      const kind = PAIRS[`${x.role}|${y.role}`];
      if (!kind) continue;
      let entry;
      if (kind === 'verifies') entry = { testKey: y.key, itemKey: x.key }; // x is req or ctrl, y is test
      else if (kind === 'derives') entry = { ctrlKey: x.key, reqKey: y.key };
      else entry = { ctrlKey: x.key, riskKey: y.key };
      const id = `${kind}:${Object.values(entry).join('|')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (kind === 'verifies') verifies.push(entry);
      else if (kind === 'derives') derives.push(entry);
      else mitigates.push(entry);
    }
  }
  verifies.sort((p, q) => compareKeys(p.itemKey, q.itemKey) || compareKeys(p.testKey, q.testKey));
  derives.sort((p, q) => compareKeys(p.ctrlKey, q.ctrlKey) || compareKeys(p.reqKey, q.reqKey));
  mitigates.sort((p, q) => compareKeys(p.ctrlKey, q.ctrlKey) || compareKeys(p.riskKey, q.riskKey));

  return { nodes, verifies, derives, mitigates, externalLinksIgnored: external.size, warnings };
}
