// Test helper (still pure): builds Jira-shaped snapshots from the seed plan and applies events.
import { DEFAULT_CONFIG } from './roles.js';
import { planSeed } from './seedPlan.js';
import { toJiraTime } from './time.js';
import { textToAdf } from './adf.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

const STATUS = {
  '1': { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  '2': { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  '3': { id: '3', name: 'Done', statusCategory: { key: 'done' } },
};

function nextHistoryId(snapshot) {
  let max = 100000;
  for (const list of Object.values(snapshot.changelogs)) {
    for (const h of list) max = Math.max(max, Number(h.id) || 0);
  }
  return String(max + 1);
}

function issueByKey(snapshot, key) {
  const issue = snapshot.issues.find((i) => i.key === key);
  if (!issue) throw new RangeError(`No issue ${key}`);
  return issue;
}

/**
 * @param {import('./seedPlan.js').SAMPLE_PLAN} plan
 * @param {{t0Ms:number, projectKey?:string, doneStatusId?:string, todoStatusId?:string, cfg?:object}} opts
 */
export function simulateSeedSnapshot(plan, opts) {
  const projectKey = opts.projectKey ?? 'PUMP';
  const doneId = opts.doneStatusId ?? '3';
  const todoId = opts.todoStatusId ?? '1';
  const t0 = opts.t0Ms;
  const cfg = opts.cfg ?? DEFAULT_CONFIG;
  const seeded = planSeed(plan, cfg, 'abcd1234');
  const refToKey = {};
  const issues = seeded.creates.map((c, i) => {
    const key = `${projectKey}-${i + 1}`;
    refToKey[c.ref] = key;
    return {
      id: String(10001 + i),
      key,
      fields: {
        summary: c.summary,
        labels: [...c.labels],
        issuetype: { name: 'Task' },
        status: { ...STATUS[todoId] ?? { id: todoId, name: 'To Do', statusCategory: { key: 'new' } } },
        issuelinks: [],
        fixVersions: [],
        created: toJiraTime(t0 + i * 1000),
        assignee: null,
        description: c.descriptionAdf,
      },
    };
  });
  const byKey = Object.fromEntries(issues.map((i) => [i.key, i]));
  let linkId = 20001;
  for (const l of seeded.links) {
    const down = byKey[refToKey[l.downRef]];
    const up = byKey[refToKey[l.upRef]];
    const type = { name: 'Relates', inward: 'relates to', outward: 'relates to' };
    const id = String(linkId++);
    down.fields.issuelinks.push({ id, type, inwardIssue: { id: up.id, key: up.key } });
    up.fields.issuelinks.push({ id, type, outwardIssue: { id: down.id, key: down.key } });
  }
  const changelogs = Object.fromEntries(issues.map((i) => [i.id, []]));
  let hid = 100001;
  for (const ref of seeded.passRefs) {
    const issue = byKey[refToKey[ref]];
    changelogs[issue.id].push({
      id: String(hid++),
      created: toJiraTime(t0 + 60000),
      author: { accountId: 'app-seeder' },
      items: [{ field: 'status', fieldId: 'status', fieldtype: 'jira', from: todoId, fromString: 'To Do', to: doneId, toString: 'Done' }],
    });
    issue.fields.status = { ...STATUS[doneId] ?? { id: doneId, name: 'Done', statusCategory: { key: 'done' } } };
  }
  return {
    issues,
    changelogs,
    statusCatById: { [todoId]: 'new', '2': 'indeterminate', [doneId]: 'done' },
    projectKey,
    refToKey,
  };
}

/**
 * Appends a field edit to an issue's changelog (and updates the field value).
 */
export function applyEdit(snapshot, issueKey, { fieldId, fromString, toString, atMs, authorId = 'user-1', historyId, from = null, to = null }) {
  const s = clone(snapshot);
  const issue = issueByKey(s, issueKey);
  const list = s.changelogs[issue.id] ?? (s.changelogs[issue.id] = []);
  list.push({
    id: historyId ?? nextHistoryId(s),
    created: toJiraTime(atMs),
    author: { accountId: authorId },
    items: [{ field: fieldId, fieldId, fieldtype: 'jira', from, fromString, to, toString }],
  });
  if (fieldId === 'summary' && typeof toString === 'string') issue.fields.summary = toString;
  if (fieldId === 'description' && typeof toString === 'string') issue.fields.description = textToAdf([toString]);
  return s;
}

function applyStatus(snapshot, issueKey, atMs, toId) {
  const s = clone(snapshot);
  const issue = issueByKey(s, issueKey);
  const list = s.changelogs[issue.id] ?? (s.changelogs[issue.id] = []);
  const fromId = issue.fields.status.id;
  const toStatus = STATUS[toId] ?? { id: toId, name: toId, statusCategory: { key: s.statusCatById[toId] ?? 'new' } };
  list.push({
    id: nextHistoryId(s),
    created: toJiraTime(atMs),
    author: { accountId: 'user-1' },
    items: [{
      field: 'status', fieldId: 'status', fieldtype: 'jira',
      from: fromId, fromString: issue.fields.status.name, to: toId, toString: toStatus.name,
    }],
  });
  issue.fields.status = { ...toStatus };
  return s;
}

/** Test moves to Done (status '3'). */
export function applyPass(snapshot, issueKey, atMs, doneId = '3') {
  return applyStatus(snapshot, issueKey, atMs, doneId);
}

/** Test moves back to To Do (status '1'). */
export function applyReopen(snapshot, issueKey, atMs, todoId = '1') {
  return applyStatus(snapshot, issueKey, atMs, todoId);
}
