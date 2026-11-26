// The sample dataset (a fictional insulin pump) and the pure plan the seeder executes.
// Fictional sample data. Not clinical guidance.
import { textToAdf } from './adf.js';

export const SAMPLE_NOTICE = 'Fictional sample data created by Tracebound. Not clinical guidance.';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const I = (ref, role, title, text, extra) => ({
  ref,
  role,
  title,
  paragraphs: [text, ...(extra ? [extra] : []), SAMPLE_NOTICE],
});

export const SAMPLE_PLAN = deepFreeze({
  version: 1,
  issues: [
    I('REQ-1', 'req', 'Basal rate range', 'The pump shall deliver basal rates from 0.05 to 35.00 units per hour in 0.05-unit steps.'),
    I('REQ-2', 'req', 'Occlusion detection', 'The pump shall raise an occlusion alarm within 2 hours at a basal rate of 1 unit per hour.'),
    I('REQ-3', 'req', 'Low battery warning', 'The pump shall warn the user at least 30 minutes before the battery is depleted.'),
    I('REQ-4', 'req', 'Bolus cancel', 'The user shall be able to cancel a bolus in progress, and delivery shall stop within 1 second.'),
    I('REQ-5', 'req', 'Low reservoir alert', 'The pump shall alert the user when 10 units or fewer remain in the reservoir.'),
    I('REQ-6', 'req', 'Dose history', 'The pump shall store the delivered dose history for at least 90 days.'),
    I('REQ-7', 'req', 'Bolus dose limit', 'A single bolus dose shall not exceed 25 units per request.'),
    I('REQ-8', 'req', 'Settings audit trail', 'The pump shall record every change to therapy settings with the time, the previous value and the new value.'),
    I('REQ-9', 'req', 'Insulin on board', 'The pump shall display the estimated insulin on board before a bolus is confirmed.'),
    I('RSK-1', 'risk', 'Under-delivery from undetected occlusion', 'Hazard: an occlusion is not detected and insulin is under-delivered.'),
    I('RSK-2', 'risk', 'Bolus interrupted by battery depletion', 'Hazard: the battery runs out during a bolus and the delivered amount is unknown.'),
    I('RSK-3', 'risk', 'Overdose via UI entry', 'Hazard: the user enters a bolus larger than intended.'),
    I('RSK-4', 'risk', 'Wrong basal after time-zone change', 'Hazard: the basal schedule runs at the wrong local time after a time-zone change.'),
    I('CTRL-1', 'ctrl', 'Pressure sensor self-test at power-on', 'The firmware shall run a pressure sensor self-test at every power-on and block delivery if it fails.'),
    I('CTRL-2', 'ctrl', 'Hard dose cap in firmware', 'The firmware shall reject any bolus request above the configured maximum bolus.'),
    I('CTRL-3', 'ctrl', 'Block bolus start below 5% battery', 'The pump shall not start a bolus when the battery is below 5%.'),
    I('TEST-1', 'test', 'Basal rate range test', 'Program basal rates of 0.05, 1.00 and 35.00 units per hour and measure delivery for one hour each.'),
    I('TEST-2', 'test', 'Occlusion alarm test', 'Clamp the infusion line at a basal rate of 1 unit per hour and record the time to the occlusion alarm.'),
    I('TEST-3', 'test', 'Low battery warning test', 'Discharge the battery on a bench supply and record when the warning appears.'),
    I('TEST-4', 'test', 'Bolus cancel test', 'Start a 5-unit bolus, cancel it after 2 seconds and measure the time until the motor stops.'),
    I('TEST-5', 'test', 'Low reservoir alert test', 'Fill the reservoir with 12 units, deliver 2 units and check that the alert appears.'),
    I('TEST-6', 'test', 'Dose history retention test', 'Load 90 days of simulated history and check that the oldest entry can still be read.'),
    I('TEST-8', 'test', 'Settings audit trail test', 'Change three therapy settings and check that each change is recorded with time, previous and new value.'),
    I('TEST-10', 'test', 'Pressure self-test fault injection', 'Inject a pressure sensor fault and power on: delivery must be blocked.'),
    I('TEST-11', 'test', 'Firmware dose cap test', 'Send bolus requests just above and just below the configured maximum and check which are rejected.'),
    I('TEST-12', 'test', 'Low battery bolus block test', 'At 4% battery, request a bolus and check that it does not start.'),
    I('TEST-14', 'test', 'Max bolus boundary test', 'Request a bolus at the limit and one unit above it, and check that only the first is accepted.'),
    I('TEST-15', 'test', 'Bolus UI limit test', 'In the bolus entry screen, try to enter a value above the limit and check that it cannot be confirmed.'),
    I('TEST-16', 'test', 'Dose validator unit test', 'Run the dose validator unit tests for values at, below and above the limit.'),
    I('TEST-20', 'test', 'Priming sequence test', 'Run the priming sequence and check that the line is filled without delivering to the user.'),
  ],
  links: [
    { down: 'TEST-1', up: 'REQ-1' },
    { down: 'TEST-2', up: 'REQ-2' },
    { down: 'TEST-3', up: 'REQ-3' },
    { down: 'TEST-4', up: 'REQ-4' },
    { down: 'TEST-5', up: 'REQ-5' },
    { down: 'TEST-6', up: 'REQ-6' },
    { down: 'TEST-8', up: 'REQ-8' },
    { down: 'TEST-14', up: 'REQ-7' },
    { down: 'TEST-15', up: 'REQ-7' },
    { down: 'TEST-16', up: 'REQ-7' },
    { down: 'TEST-10', up: 'CTRL-1' },
    { down: 'TEST-11', up: 'CTRL-2' },
    { down: 'TEST-12', up: 'CTRL-3' },
    { down: 'CTRL-1', up: 'REQ-2' },
    { down: 'CTRL-2', up: 'REQ-7' },
    { down: 'CTRL-3', up: 'REQ-3' },
    { down: 'CTRL-1', up: 'RSK-1' },
    { down: 'CTRL-2', up: 'RSK-3' },
    { down: 'CTRL-3', up: 'RSK-2' },
  ],
  pass: ['TEST-1', 'TEST-2', 'TEST-3', 'TEST-4', 'TEST-5', 'TEST-6', 'TEST-8', 'TEST-10', 'TEST-11', 'TEST-12', 'TEST-14', 'TEST-15', 'TEST-16'],
  expected: {
    before: { pct: 92, ready: 11, total: 12 },
    afterEdit: { pct: 75, ready: 9, total: 12, suspectLinks: 3, upstreamChanged: 1 },
  },
  demoEdit: { ref: 'REQ-7', field: 'description', from: '25 units', to: '20 units' },
});

const ALLOWED_PAIRS = new Set(['test>req', 'test>ctrl', 'ctrl>req', 'ctrl>risk']);

/**
 * Structural checks on a plan. Returns a list of problems (empty when valid).
 */
export function validatePlan(plan) {
  const problems = [];
  const byRef = new Map();
  for (const i of plan.issues) {
    if (byRef.has(i.ref)) problems.push(`duplicate ref ${i.ref}`);
    if (!/^[A-Z]+-\d+$/.test(i.ref)) problems.push(`bad ref ${i.ref}`);
    if (!['req', 'risk', 'ctrl', 'test'].includes(i.role)) problems.push(`bad role for ${i.ref}`);
    byRef.set(i.ref, i);
  }
  const pairs = new Set();
  for (const l of plan.links) {
    const d = byRef.get(l.down);
    const u = byRef.get(l.up);
    if (!d || !u) {
      problems.push(`link ${l.down} -> ${l.up} names an unknown ref`);
      continue;
    }
    if (!ALLOWED_PAIRS.has(`${d.role}>${u.role}`)) problems.push(`link ${l.down} -> ${l.up} has direction ${d.role}>${u.role}`);
    const id = `${l.down}|${l.up}`;
    if (pairs.has(id)) problems.push(`duplicate link ${id}`);
    pairs.add(id);
  }
  for (const p of plan.pass) {
    if (byRef.get(p)?.role !== 'test') problems.push(`pass ref ${p} is not a test`);
  }
  return problems;
}

/**
 * Turns the plan into concrete Jira operations for one seed run.
 * @param {typeof SAMPLE_PLAN} plan
 * @param {import('./types.js').Config} cfg
 * @param {string} runId8  first 8 chars of the run id
 */
export function planSeed(plan, cfg, runId8) {
  if (!/^[a-z0-9]{8}$/i.test(String(runId8))) throw new RangeError('runId8 must be 8 letters or digits');
  const creates = plan.issues.map((i) => ({
    ref: i.ref,
    role: i.role,
    summary: `[${i.ref}] ${i.title}`,
    descriptionAdf: textToAdf(i.paragraphs),
    labels: [cfg.labels[i.role], 'tb-sample', `tb-run-${runId8}`],
  }));
  const links = plan.links.map((l) => ({ downRef: l.down, upRef: l.up }));
  const passRefs = [...plan.pass];
  return { creates, links, passRefs, totalOps: creates.length + links.length + passRefs.length + 1 };
}

/**
 * "[REQ-7] Bolus dose limit" -> "REQ-7".
 * @param {string} summary
 * @returns {string|null}
 */
export function parseSeedRef(summary) {
  const m = /^\[([A-Z]+-\d+)\]\s/.exec(String(summary ?? ''));
  return m ? m[1] : null;
}
