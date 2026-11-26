// Role detection (requirement, risk, risk control, verification test) and project config defaults.

/** @type {import('./types.js').RoleKey[]} Highest priority first. */
export const ROLE_PRIORITY = ['test', 'ctrl', 'risk', 'req'];

export const MAX_CUSTOM_FIELDS = 4;

/** @type {import('./types.js').Config} */
export const DEFAULT_CONFIG = Object.freeze({
  roleMode: 'labels',
  labels: Object.freeze({ req: 'trace-req', risk: 'trace-risk', ctrl: 'trace-ctrl', test: 'trace-test' }),
  issueTypes: Object.freeze({}),
  linkTypeAllowlist: null,
  substantiveFieldIds: Object.freeze(['summary', 'description']),
});

const LABEL_RE = /^[^\s]{1,255}$/;
const FIELD_RE = /^(summary|description|customfield_\d{1,10})$/;

/**
 * Merges a stored config over the defaults and validates it.
 * @param {Partial<import('./types.js').Config>|null|undefined} input
 * @returns {{config: import('./types.js').Config, errors: string[]}}
 */
export function normalizeConfig(input) {
  const src = input ?? {};
  const errors = [];
  const roleMode = src.roleMode === 'issueTypes' ? 'issueTypes' : 'labels';
  if (src.roleMode !== undefined && src.roleMode !== 'labels' && src.roleMode !== 'issueTypes') {
    errors.push(`roleMode must be "labels" or "issueTypes", got "${src.roleMode}".`);
  }
  const labels = { ...DEFAULT_CONFIG.labels };
  for (const r of ['req', 'risk', 'ctrl', 'test']) {
    const v = src.labels?.[r];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !LABEL_RE.test(v)) errors.push(`Label for ${r} must be one word without spaces.`);
    else labels[r] = v;
  }
  if (new Set(Object.values(labels).map((l) => l.toLowerCase())).size !== 4) {
    errors.push('The four role labels must be different.');
  }
  const issueTypes = {};
  for (const r of ['req', 'risk', 'ctrl', 'test']) {
    const v = src.issueTypes?.[r];
    if (typeof v === 'string' && v.trim()) issueTypes[r] = v.trim();
  }
  if (roleMode === 'issueTypes' && Object.keys(issueTypes).length === 0) {
    errors.push('Issue-type mode needs at least one issue type mapped to a role.');
  }
  let linkTypeAllowlist = null;
  if (Array.isArray(src.linkTypeAllowlist)) {
    const names = src.linkTypeAllowlist.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim());
    linkTypeAllowlist = names.length ? [...new Set(names)] : null;
  }
  let fields = ['summary', 'description'];
  if (Array.isArray(src.substantiveFieldIds)) {
    const extra = [];
    for (const f of src.substantiveFieldIds) {
      if (typeof f !== 'string' || !FIELD_RE.test(f.trim())) {
        errors.push(`"${f}" is not a field id (use summary, description or customfield_NNNNN).`);
        continue;
      }
      const id = f.trim();
      if (!fields.includes(id) && !extra.includes(id)) extra.push(id);
    }
    if (extra.length > MAX_CUSTOM_FIELDS) errors.push(`At most ${MAX_CUSTOM_FIELDS} custom fields can be substantive.`);
    fields = fields.concat(extra.slice(0, MAX_CUSTOM_FIELDS));
  }
  return { config: { roleMode, labels, issueTypes, linkTypeAllowlist, substantiveFieldIds: fields }, errors };
}

/**
 * @param {import('./types.js').JiraIssue} issue
 * @param {import('./types.js').Config} cfg
 * @returns {{role: import('./types.js').RoleKey|null, ambiguous: boolean, matched: import('./types.js').RoleKey[]}}
 */
export function resolveRole(issue, cfg) {
  const matched = [];
  if (cfg.roleMode === 'issueTypes') {
    const typeName = String(issue?.fields?.issuetype?.name ?? '').toLowerCase();
    for (const r of ROLE_PRIORITY) {
      const want = cfg.issueTypes?.[r];
      if (want && typeName && want.toLowerCase() === typeName) matched.push(r);
    }
  } else {
    const labels = new Set((issue?.fields?.labels ?? []).map((l) => String(l).toLowerCase()));
    for (const r of ROLE_PRIORITY) {
      const want = cfg.labels?.[r];
      if (want && labels.has(want.toLowerCase())) matched.push(r);
    }
  }
  return { role: matched[0] ?? null, ambiguous: matched.length > 1, matched };
}
