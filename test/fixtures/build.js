// Small Jira-shaped snapshot builder for engine tests (not a test file itself).
import { toJiraTime } from '../../src/engine/index.js';

export const T0 = Date.parse('2026-12-01T09:00:00Z');
export const P = T0 + 60000; // default pass time in fixtures
export const CAT = { '1': 'new', '2': 'indeterminate', '3': 'done', '4': 'done' };
const NAMES = { '1': 'To Do', '2': 'In Progress', '3': 'Passed', '4': 'Closed' };
const LABEL = { req: 'trace-req', risk: 'trace-risk', ctrl: 'trace-ctrl', test: 'trace-test' };

export function statusObj(id) {
  return { id, name: NAMES[id] ?? `S${id}`, statusCategory: { key: CAT[id] ?? 'done' } };
}

export function fixture(projectKey = 'P') {
  const issues = [];
  const changelogs = {};
  const statusCatById = { ...CAT };
  let nextId = 1;
  let nextHid = 1000;
  let nextLid = 500;
  const get = (key) => {
    const i = issues.find((x) => x.key === key);
    if (!i) throw new Error(`fixture: no issue ${key}`);
    return i;
  };
  const api = {
    issue(key, role, opts = {}) {
      const id = String(nextId++);
      const labels = opts.labels ?? (role ? [LABEL[role]] : []);
      issues.push({
        id,
        key,
        fields: {
          summary: opts.summary ?? `Summary of ${key}`,
          labels,
          issuetype: { name: opts.type ?? 'Task' },
          status: statusObj(opts.status ?? '1'),
          issuelinks: [],
          fixVersions: (opts.fixVersions ?? []).map((name) => ({ name })),
          created: toJiraTime(opts.created ?? T0),
          ...(opts.sccd !== undefined ? { statuscategorychangedate: toJiraTime(opts.sccd) } : {}),
          assignee: null,
          description: null,
        },
      });
      changelogs[id] = [];
      return api;
    },
    link(a, b, type = 'Relates', linkId) {
      const ia = get(a);
      const ib = get(b);
      const id = String(linkId ?? nextLid++);
      const t = { name: type, inward: `${type} in`, outward: `${type} out` };
      ia.fields.issuelinks.push({ id, type: t, outwardIssue: { id: ib.id, key: b } });
      ib.fields.issuelinks.push({ id, type: t, inwardIssue: { id: ia.id, key: a } });
      return api;
    },
    extLink(a, otherKey, type = 'Relates') {
      get(a).fields.issuelinks.push({ id: String(nextLid++), type: { name: type }, outwardIssue: { id: '99999', key: otherKey } });
      return api;
    },
    unlink(a, b) {
      const ia = get(a);
      const ib = get(b);
      ia.fields.issuelinks = ia.fields.issuelinks.filter((l) => (l.inwardIssue ?? l.outwardIssue).key !== b);
      ib.fields.issuelinks = ib.fields.issuelinks.filter((l) => (l.inwardIssue ?? l.outwardIssue).key !== a);
      return api;
    },
    history(key, atMs, items, opts = {}) {
      const i = get(key);
      changelogs[i.id].push({
        id: String(opts.id ?? nextHid++),
        created: toJiraTime(atMs),
        author: { accountId: opts.author ?? 'user-1' },
        items,
      });
      return api;
    },
    edit(key, fieldId, fromString, toString, atMs, opts = {}) {
      const item = { field: opts.field ?? fieldId, fieldtype: 'jira', from: opts.from ?? null, fromString, to: opts.to ?? null, toString };
      if (opts.noFieldId !== true) item.fieldId = fieldId;
      return api.history(key, atMs, [item], opts);
    },
    status(key, toId, atMs, opts = {}) {
      const i = get(key);
      const fromId = i.fields.status.id;
      api.history(key, atMs, [{
        field: 'status', fieldId: 'status', fieldtype: 'jira',
        from: fromId, fromString: NAMES[fromId] ?? fromId, to: toId, toString: NAMES[toId] ?? toId,
      }], opts);
      if (opts.keepField !== true) i.fields.status = statusObj(toId);
      return api;
    },
    setStatusField(key, statusId, catKey) {
      get(key).fields.status = { id: statusId, name: `S${statusId}`, statusCategory: { key: catKey } };
      return api;
    },
    setCategory(statusId, cat) {
      if (cat === undefined) delete statusCatById[statusId];
      else statusCatById[statusId] = cat;
      return api;
    },
    raw: get,
    snapshot() {
      return JSON.parse(JSON.stringify({ issues, changelogs, statusCatById, projectKey }));
    },
  };
  return api;
}

/** A requirement P-1 verified by test P-2, which passed at P. */
export function basePair() {
  return fixture().issue('P-1', 'req').issue('P-2', 'test').link('P-2', 'P-1').status('P-2', '3', P);
}
