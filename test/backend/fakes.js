// In-memory fakes for backend tests: a stateful fake Jira (enough REST v3 for the loader, the
// seeder, re-verification and health), a fake KVS store and a fake queue. No network.
import { toJiraTime, textToAdf, adfToText } from '../../src/engine/index.js';
import { handleJob } from '../../src/backend/seeder.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export const T0 = Date.parse('2026-12-01T09:00:00Z');

const STATUSES = {
  1: { id: '1', name: 'To Do', cat: 'new' },
  2: { id: '2', name: 'In Progress', cat: 'indeterminate' },
  3: { id: '3', name: 'Done', cat: 'done' },
  4: { id: '4', name: 'Closed', cat: 'done' },
};
const statusObj = (id) => ({ id: String(id), name: STATUSES[id].name, statusCategory: { key: STATUSES[id].cat } });

const WORKFLOWS = {
  // Any status to any other; two Done-category targets.
  simple: (from) => [['11', '1'], ['21', '2'], ['31', '3'], ['41', '4']].filter(([, to]) => to !== from),
  // To Do -> In Progress -> Done.
  twoHop: (from) => ({ 1: [['21', '2']], 2: [['31', '3'], ['11', '1']], 3: [['11', '1']], 4: [['11', '1']] })[from] ?? [],
  // No path to Done.
  noDone: (from) => ({ 1: [['21', '2']], 2: [['11', '1']] })[from] ?? [],
};

export const ALL_PERMS = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'LINK_ISSUES', 'TRANSITION_ISSUES', 'DELETE_ISSUES', 'ADMINISTER_PROJECTS'];

function parseValues(s) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^\s,()"]+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  return out;
}

/**
 * @param {{projectKey?:string, workflow?:'simple'|'twoHop'|'noDone', perms?:object, appPerms?:object,
 *   bulkfetch?:boolean, searchPageSize?:number, bulkPageSize?:number, requiredField?:string,
 *   assigneeInvalid?:boolean, linkTypes?:object[]}} [opts]
 */
export function makeFakeJira(opts = {}) {
  const projectKey = opts.projectKey ?? 'PUMP';
  const st = {
    clock: T0,
    issues: new Map(),
    nextNum: 1,
    nextId: 10001,
    nextHid: 50001,
    nextLid: 70001,
    workflow: opts.workflow ?? 'simple',
    perms: Object.fromEntries(ALL_PERMS.map((p) => [p, true])),
    bulkfetch: opts.bulkfetch ?? true,
    searchPageSize: opts.searchPageSize ?? 100,
    bulkPageSize: opts.bulkPageSize ?? 1000,
    requiredField: opts.requiredField ?? null,
    assigneeInvalid: !!opts.assigneeInvalid,
    linkTypes: opts.linkTypes ?? [{ id: '10000', name: 'Relates', inward: 'relates to', outward: 'relates to' }, { id: '10001', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }],
    issueTypes: [{ id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 }, { id: '10002', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }, { id: '10003', name: 'Epic', subtask: false, hierarchyLevel: 1 }],
    calls: [],
    overrides: [],
  };
  Object.assign(st.perms, opts.perms ?? {});
  const tick = () => (st.clock += 1000);
  const res = (status, json = null, retryAfter = null) => ({ ok: status >= 200 && status < 300, status, json, retryAfter });

  function addIssue({ key, summary, labels = [], description = null, typeId = '10001', status = '1', fixVersions = [], assignee = null, created }) {
    const num = key ? Number(key.split('-').pop()) : st.nextNum;
    st.nextNum = Math.max(st.nextNum, num + 1);
    const k = key ?? `${projectKey}-${num}`;
    const type = st.issueTypes.find((t) => t.id === String(typeId)) ?? st.issueTypes[0];
    const issue = {
      id: String(st.nextId++),
      key: k,
      fields: {
        summary,
        labels: [...labels],
        description,
        issuetype: { id: type.id, name: type.name },
        status: statusObj(status),
        issuelinks: [],
        fixVersions: fixVersions.map((name) => ({ name })),
        created: toJiraTime(created ?? tick()),
        assignee: assignee ? { accountId: assignee } : null,
      },
      changelog: [],
    };
    st.issues.set(k, issue);
    return issue;
  }

  function history(issue, items, author = 'user-1', atMs) {
    issue.changelog.push({ id: String(st.nextHid++), created: toJiraTime(atMs ?? tick()), author: { accountId: author }, items });
  }

  function linkIssues(typeName, downKey, upKey) {
    const d = st.issues.get(downKey);
    const u = st.issues.get(upKey);
    const type = st.linkTypes.find((t) => t.name === typeName);
    const id = String(st.nextLid++);
    d.fields.issuelinks.push({ id, type, inwardIssue: { id: u.id, key: u.key } });
    u.fields.issuelinks.push({ id, type, outwardIssue: { id: d.id, key: d.key } });
  }

  function matches(issue, jql) {
    const clauses = jql.replace(/\s+ORDER BY.*$/i, '').split(/\s+AND\s+/i);
    return clauses.every((c) => {
      let m;
      if ((m = /^project\s*=\s*(.+)$/i.exec(c))) return issue.key.startsWith(`${parseValues(m[1])[0]}-`);
      if ((m = /^labels\s*=\s*(.+)$/i.exec(c))) return issue.fields.labels.includes(parseValues(m[1])[0]);
      if ((m = /^labels\s+in\s*\((.*)\)$/i.exec(c))) {
        const v = parseValues(m[1]).map((x) => x.toLowerCase());
        return issue.fields.labels.some((l) => v.includes(l.toLowerCase()));
      }
      if ((m = /^issuetype\s+in\s*\((.*)\)$/i.exec(c))) return parseValues(m[1]).includes(issue.fields.issuetype.name);
      if ((m = /^key\s+in\s*\((.*)\)$/i.exec(c))) return parseValues(m[1]).includes(issue.key);
      if ((m = /^issue\s+in\s+linkedIssues\((.*)\)$/i.exec(c))) {
        const k = parseValues(m[1])[0];
        return issue.fields.issuelinks.some((l) => (l.inwardIssue ?? l.outwardIssue).key === k);
      }
      if (/^statusCategory\s*!=\s*Done$/i.test(c)) return issue.fields.status.statusCategory.key !== 'done';
      if ((m = /^summary\s*~\s*(.+)$/i.exec(c))) {
        const v = parseValues(m[1])[0].replace(/^"|"$/g, '');
        return issue.fields.summary.includes(v);
      }
      throw new Error(`fake JQL: unsupported clause "${c}"`);
    });
  }

  const sortKeys = (a, b) => Number(a.key.split('-').pop()) - Number(b.key.split('-').pop());

  function view(issue, fields) {
    const out = { id: issue.id, key: issue.key, fields: {} };
    for (const f of fields ?? Object.keys(issue.fields)) if (f in issue.fields) out.fields[f] = clone(issue.fields[f]);
    return out;
  }

  function transitionsOf(issue) {
    return WORKFLOWS[st.workflow](issue.fields.status.id).map(([id, to]) => ({
      id, name: STATUSES[to].name, to: { id: to, name: STATUSES[to].name, statusCategory: { key: STATUSES[to].cat } }, isAvailable: true, hasScreen: false,
    }));
  }

  function createOne(fields, mode) {
    if (mode === 'app' ? st.appCannotCreate : false) return { error: res(403, { errorMessages: ['no create'] }) };
    const errors = {};
    if (!fields?.project?.key || fields.project.key !== projectKey) errors.project = 'valid project is required';
    if (!st.issueTypes.some((t) => t.id === String(fields?.issuetype?.id))) errors.issuetype = 'valid issue type is required';
    if (st.requiredField && !(st.requiredField in fields)) errors[st.requiredField] = `${st.requiredField} is required.`;
    if (st.assigneeInvalid && fields.assignee) errors.assignee = 'User cannot be assigned issues.';
    if (Object.keys(errors).length) return { errors };
    const issue = addIssue({
      summary: fields.summary, labels: fields.labels ?? [], description: fields.description ?? null, typeId: fields.issuetype.id,
      assignee: fields.assignee?.accountId ?? null,
    });
    return { issue };
  }

  function handle(mode, method, rawPath, body) {
    const url = new URL(rawPath, 'http://jira.test');
    const path = decodeURIComponent(url.pathname);
    st.calls.push({ mode, method, path, query: Object.fromEntries(url.searchParams), body: clone(body) });
    for (const o of st.overrides) {
      const r = o({ mode, method, path, query: Object.fromEntries(url.searchParams), body });
      if (r) return r;
    }
    let m;
    if (method === 'GET' && path === '/rest/api/3/status') {
      return res(200, Object.values(STATUSES).map((s) => ({ id: s.id, name: s.name, statusCategory: { key: s.cat } })));
    }
    if (method === 'GET' && path === '/rest/api/3/mypermissions') {
      const want = (url.searchParams.get('permissions') ?? '').split(',').filter(Boolean);
      const src = mode === 'app' ? { ...st.perms, ...(opts.appPerms ?? {}) } : st.perms;
      return res(200, { permissions: Object.fromEntries(want.map((p) => [p, { key: p, havePermission: !!src[p] }])) });
    }
    if (method === 'GET' && (m = /^\/rest\/api\/3\/issue\/createmeta\/([^/]+)\/issuetypes$/.exec(path))) {
      if (m[1] !== projectKey) return res(404, { errorMessages: ['No project'] });
      return res(200, { issueTypes: clone(st.issueTypes), maxResults: 50, startAt: 0, total: st.issueTypes.length });
    }
    if (method === 'GET' && path === '/rest/api/3/issueLinkType') return res(200, { issueLinkTypes: clone(st.linkTypes) });
    if (method === 'POST' && path === '/rest/api/3/issue/bulk') {
      const issues = [];
      const errors = [];
      (body.issueUpdates ?? []).forEach((u, i) => {
        const r = createOne(u.fields, mode);
        if (r.error) errors.push({ status: 403, failedElementNumber: i, elementErrors: { errorMessages: ['forbidden'] } });
        else if (r.errors) errors.push({ status: 400, failedElementNumber: i, elementErrors: { errors: r.errors } });
        else issues.push({ id: r.issue.id, key: r.issue.key, self: `x/${r.issue.id}` });
      });
      if (issues.length === 0 && errors.length) return res(400, { issues, errors });
      return res(201, { issues, errors });
    }
    if (method === 'POST' && path === '/rest/api/3/issue') {
      const r = createOne(body.fields, mode);
      if (r.error) return r.error;
      if (r.errors) return res(400, { errorMessages: [], errors: r.errors });
      return res(201, { id: r.issue.id, key: r.issue.key });
    }
    if (method === 'POST' && path === '/rest/api/3/issueLink') {
      const d = st.issues.get(body.outwardIssue?.key);
      const u = st.issues.get(body.inwardIssue?.key);
      if (!d || !u) return res(404, { errorMessages: ['Issue not found'] });
      if (!st.linkTypes.some((t) => t.name === body.type?.name)) return res(404, { errorMessages: ['No link type'] });
      linkIssues(body.type.name, d.key, u.key);
      return res(201, null);
    }
    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/.exec(path))) {
      const issue = st.issues.get(m[1]);
      if (!issue) return res(404, { errorMessages: ['Issue does not exist'] });
      if (method === 'GET') return res(200, { transitions: transitionsOf(issue) });
      const t = transitionsOf(issue).find((x) => x.id === String(body?.transition?.id));
      if (!t) return res(400, { errorMessages: ['Transition is not valid'] });
      const from = issue.fields.status;
      history(issue, [{ field: 'status', fieldId: 'status', fieldtype: 'jira', from: from.id, fromString: from.name, to: t.to.id, toString: t.to.name }], mode === 'app' ? 'app-user' : 'user-1');
      issue.fields.status = statusObj(t.to.id);
      issue.fields.statuscategorychangedate = toJiraTime(st.clock);
      return res(204, null);
    }
    if (method === 'GET' && (m = /^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/.exec(path))) {
      const issue = [...st.issues.values()].find((i) => i.id === m[1] || i.key === m[1]);
      if (!issue) return res(404, { errorMessages: ['Issue does not exist'] });
      const startAt = Number(url.searchParams.get('startAt') ?? 0);
      const max = Math.min(100, Number(url.searchParams.get('maxResults') ?? 100));
      const values = clone(issue.changelog.slice(startAt, startAt + max));
      return res(200, { startAt, maxResults: max, total: issue.changelog.length, isLast: startAt + values.length >= issue.changelog.length, values });
    }
    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path))) {
      const issue = st.issues.get(m[1]);
      if (!issue) return res(404, { errorMessages: ['Issue does not exist'] });
      if (method === 'GET') {
        const f = url.searchParams.get('fields');
        return res(200, view(issue, f ? f.split(',') : null));
      }
      if (method === 'DELETE') {
        st.issues.delete(issue.key);
        for (const other of st.issues.values()) {
          other.fields.issuelinks = other.fields.issuelinks.filter((l) => (l.inwardIssue ?? l.outwardIssue).key !== issue.key);
        }
        return res(204, null);
      }
    }
    if (method === 'POST' && path === '/rest/api/3/search/jql') {
      const all = [...st.issues.values()].filter((i) => matches(i, body.jql)).sort(sortKeys);
      const start = Number(body.nextPageToken ?? 0);
      const size = Math.min(body.maxResults ?? 50, st.searchPageSize);
      const page = all.slice(start, start + size);
      const next = start + size < all.length ? String(start + size) : undefined;
      return res(200, { issues: page.map((i) => view(i, body.fields)), ...(next ? { nextPageToken: next } : {}), isLast: !next });
    }
    if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
      if (!st.bulkfetch) return res(404, { errorMessages: ['Not found'] });
      const ids = (body.issueIdsOrKeys ?? []).map(String);
      const fields = body.fieldIds ?? null;
      const flat = [];
      for (const id of ids) {
        const issue = [...st.issues.values()].find((i) => i.id === id || i.key === id);
        if (!issue) continue;
        for (const h of issue.changelog) {
          const items = h.items.filter((it) => !fields || fields.includes(it.fieldId ?? it.field));
          if (items.length) flat.push({ issueId: issue.id, h: { ...clone(h), items: clone(items) } });
        }
      }
      const start = Number(body.nextPageToken ?? 0);
      const size = Math.min(body.maxResults ?? 1000, st.bulkPageSize);
      const page = flat.slice(start, start + size);
      const byIssue = new Map();
      for (const { issueId, h } of page) {
        if (!byIssue.has(issueId)) byIssue.set(issueId, []);
        byIssue.get(issueId).push(h);
      }
      const next = start + size < flat.length ? String(start + size) : undefined;
      return res(200, { issueChangeLogs: [...byIssue].map(([issueId, changeHistories]) => ({ issueId, changeHistories })), ...(next ? { nextPageToken: next } : {}) });
    }
    return res(404, { errorMessages: [`fake Jira: no route ${method} ${path}`] });
  }

  const client = (mode) => ({
    mode,
    get: async (p) => handle(mode, 'GET', p),
    post: async (p, b) => handle(mode, 'POST', p, b ?? {}),
    put: async (p, b) => handle(mode, 'PUT', p, b ?? {}),
    del: async (p) => handle(mode, 'DELETE', p),
  });

  return {
    state: st,
    projectKey,
    asUser: client('user'),
    asApp: client('app'),
    addIssue,
    linkIssues,
    tick,
    calls: (method, pathRe) => st.calls.filter((c) => (!method || c.method === method) && (!pathRe || pathRe.test(c.path))),
    override(fn) {
      st.overrides.push(fn);
      return fn;
    },
    clearOverrides() {
      st.overrides.length = 0;
    },
    issue: (key) => st.issues.get(key),
    byRef(ref) {
      return [...st.issues.values()].find((i) => i.fields.summary.startsWith(`[${ref}] `));
    },
    /** A user edit of summary or description (description given as one plain-text paragraph per item). */
    edit(key, fieldId, toText, { author = 'user-1', atMs } = {}) {
      const issue = st.issues.get(key);
      if (fieldId === 'description') {
        const before = adfToText(issue.fields.description);
        const next = Array.isArray(toText) ? toText : [toText];
        const after = next.join('\n');
        issue.fields.description = textToAdf(next);
        history(issue, [{ field: 'description', fieldId: 'description', fieldtype: 'jira', from: null, fromString: before, to: null, toString: after }], author, atMs);
      } else {
        const before = issue.fields[fieldId];
        issue.fields[fieldId] = toText;
        history(issue, [{ field: fieldId, fieldId, fieldtype: 'jira', from: null, fromString: before, to: null, toString: toText }], author, atMs);
      }
    },
    transition(key, toStatusId, { author = 'user-1' } = {}) {
      const issue = st.issues.get(key);
      const from = issue.fields.status;
      history(issue, [{ field: 'status', fieldId: 'status', fieldtype: 'jira', from: from.id, fromString: from.name, to: String(toStatusId), toString: STATUSES[toStatusId].name }], author);
      issue.fields.status = statusObj(toStatusId);
    },
  };
}

/**
 * Fake KVS with the store interface of src/backend/store.js.
 */
export function makeFakeStore() {
  const map = new Map();
  const ops = [];
  const stats = { setIfAbsentConflicts: 0 };
  const hooks = { beforeSet: null };
  const yieldTick = () => new Promise((r) => setImmediate(r));
  return {
    map,
    ops,
    stats,
    hooks,
    async get(key) {
      await yieldTick();
      return clone(map.get(key));
    },
    async set(key, value) {
      await yieldTick();
      if (hooks.beforeSet) await hooks.beforeSet(key, value);
      ops.push(['set', key]);
      map.set(key, clone(value));
    },
    async setIfAbsent(key, value) {
      await yieldTick();
      if (map.has(key)) {
        stats.setIfAbsentConflicts++;
        return { ok: false, exists: true };
      }
      ops.push(['setIfAbsent', key]);
      map.set(key, clone(value));
      return { ok: true };
    },
    async delete(key) {
      await yieldTick();
      ops.push(['delete', key]);
      map.delete(key);
    },
    async batchGet(keys) {
      await yieldTick();
      if (keys.length > 25) throw new Error('fake KVS: batchGet takes at most 25 keys');
      const out = {};
      for (const k of keys) if (map.has(k)) out[k] = clone(map.get(k));
      return out;
    },
    async queryPrefix(prefix, { limit = 10, cursor } = {}) {
      await yieldTick();
      if (limit > 100) throw new Error('fake KVS: limit at most 100');
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(cursor ?? 0);
      const page = keys.slice(start, start + limit);
      return { results: page.map((key) => ({ key, value: clone(map.get(key)) })), nextCursor: start + limit < keys.length ? String(start + limit) : null };
    },
  };
}

export function makeFakeQueue() {
  const pushed = [];
  return {
    pushed,
    async push(body) {
      pushed.push(clone(body));
      return `job-${pushed.length}`;
    },
    async stats() {
      return { success: 0, inProgress: 1, failed: 0 };
    },
  };
}

/** A clock that advances 1 s per read, starting after the fake Jira's clock. */
export function makeClock(fake) {
  return () => new Date(fake.state.clock + 500);
}

/** Runs queued jobs through the consumer logic, re-running on {retry} up to 6 times. */
export async function drainQueue(queue, deps, from = 0) {
  const results = [];
  for (let i = from; i < queue.pushed.length; i++) {
    let retryCount = 0;
    let r;
    for (;;) {
      r = await handleJob(deps, { body: queue.pushed[i], ...(retryCount ? { retryContext: { retryCount } } : {}) });
      if (!r?.retry || retryCount >= 6) break;
      retryCount++;
    }
    results.push(r);
  }
  return results;
}

/** Everything wired for handler tests. */
export function makeWorld(opts = {}) {
  const jira = makeFakeJira(opts);
  const store = makeFakeStore();
  const queue = makeFakeQueue();
  const now = makeClock(jira);
  let n = 0;
  const uuid = () => `${(++n).toString(16).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;
  const deps = { jiraUser: jira.asUser, jiraApp: jira.asApp, store, queue, now, uuid };
  const jobDeps = { jira: jira.asApp, store, now, sleep: async () => { jira.tick(); jira.tick(); } };
  return { jira, store, queue, now, uuid, deps, jobDeps };
}

export const projectCtx = (projectKey = 'PUMP', accountId = 'user-1') => ({ accountId, extension: { project: { key: projectKey } } });
export const issueCtx = (issueKey, accountId = 'user-1') => ({ accountId, extension: { issue: { key: issueKey }, project: { key: issueKey.replace(/-\d+$/, '') } } });
