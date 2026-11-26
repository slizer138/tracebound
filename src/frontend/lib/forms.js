// Client-side validation that mirrors the backend rules (the backend re-checks everything).

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const BASELINE_NAME_MAX = 80;
export const MAX_CUSTOM_FIELDS = 4;

/** @returns {{ok:boolean, length:number, message:string}} */
export function checkReason(text) {
  const length = String(text ?? '').trim().length;
  if (length < REASON_MIN) {
    return { ok: false, length, message: `Write at least ${REASON_MIN} characters (${length} so far): say why the change does not affect what the test verifies.` };
  }
  if (length > REASON_MAX) return { ok: false, length, message: `At most ${REASON_MAX} characters (${length} now).` };
  return { ok: true, length, message: `${length}/${REASON_MAX} characters. The reason goes into the audit log.` };
}

/** @returns {{ok:boolean, message:string|null}} */
export function checkBaselineName(text) {
  const n = String(text ?? '').trim().length;
  if (n === 0) return { ok: false, message: 'Give the baseline a name, for example "Release 2.1".' };
  if (n > BASELINE_NAME_MAX) return { ok: false, message: `At most ${BASELINE_NAME_MAX} characters.` };
  return { ok: true, message: null };
}

/** "a, b ,,c" -> ["a","b","c"], de-duplicated, order kept. */
export function splitList(text) {
  const out = [];
  for (const part of String(text ?? '').split(/[,\n]/)) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const ROLES = ['req', 'risk', 'ctrl', 'test'];

/** Stored config -> flat form values for the Settings tab. */
export function configToForm(config) {
  const c = config ?? {};
  const custom = (c.substantiveFieldIds ?? []).filter((f) => f !== 'summary' && f !== 'description');
  const form = {
    roleMode: c.roleMode === 'issueTypes' ? 'issueTypes' : 'labels',
    fieldIds: custom.join(', '),
    allowlist: (c.linkTypeAllowlist ?? []).join(', '),
  };
  for (const r of ROLES) {
    form[`label_${r}`] = c.labels?.[r] ?? '';
    form[`type_${r}`] = c.issueTypes?.[r] ?? '';
  }
  return form;
}

/**
 * Select options for one role's issue type: the project's types, plus the saved value when it
 * is not among them (so a stale name stays visible and can be replaced, not silently dropped).
 * @param {string[]} names
 * @param {string} current
 * @returns {{label:string, value:string}[]}
 */
export function typeOptions(names, current) {
  const list = [...new Set((names ?? []).map(String).filter(Boolean))];
  const options = list.map((n) => ({ label: n, value: n }));
  const cur = String(current ?? '').trim();
  if (cur && !list.some((n) => n.toLowerCase() === cur.toLowerCase())) {
    options.unshift({ label: `${cur} (not in this project)`, value: cur });
  }
  return options;
}

/** Flat form values -> config for project.saveConfig. Validation messages are returned, not thrown. */
export function formToConfig(form) {
  const f = form ?? {};
  const errors = [];
  const labels = {};
  const issueTypes = {};
  for (const r of ROLES) {
    const l = String(f[`label_${r}`] ?? '').trim();
    if (l) labels[r] = l;
    if (/\s/.test(l)) errors.push(`The ${r} label must be one word without spaces.`);
    const t = String(f[`type_${r}`] ?? '').trim();
    if (t) issueTypes[r] = t;
  }
  const custom = splitList(f.fieldIds);
  for (const id of custom) {
    if (!/^customfield_\d{1,10}$/.test(id)) errors.push(`"${id}" is not a custom field id (use customfield_NNNNN).`);
  }
  if (custom.length > MAX_CUSTOM_FIELDS) errors.push(`At most ${MAX_CUSTOM_FIELDS} custom fields.`);
  const roleMode = f.roleMode === 'issueTypes' ? 'issueTypes' : 'labels';
  if (roleMode === 'issueTypes' && Object.keys(issueTypes).length === 0) errors.push('Map at least one issue type to a role.');
  const allow = splitList(f.allowlist);
  return {
    config: {
      roleMode,
      labels,
      issueTypes,
      linkTypeAllowlist: allow.length ? allow : null,
      substantiveFieldIds: ['summary', 'description', ...custom],
    },
    errors,
  };
}
