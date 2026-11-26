// Model for the issue context panel ("Trace health"). The formatter is injected so tests can
// fix the time zone.
import { plural } from './format.js';
import { compareKeys } from './matrix.js';

/** How this project marks a verification test: its configured issue type or label. */
export function testMarker(data) {
  if (data?.roleMode === 'issueTypes' && data?.testIssueType) return `issue type ${data.testIssueType}`;
  return `label ${data?.labels?.test || 'trace-test'}`;
}

/**
 * @param {object} data issue.getPanel result
 * @param {(ms:number|null)=>string} fmt date formatter
 * @returns {{kind:'none'|'item'|'test'|'risk', message:{appearance:string, title:string, body:string}|null, lines:Array<{key:string, text:string, state:string, kind:'link'|'upstream'|'control', downKey?:string, upKey?:string}>}}
 */
export function panelModel(data, fmt) {
  if (!data || !data.role) return { kind: 'none', message: null, lines: [] };
  const links = [...(data.links ?? [])];

  if (data.role === 'test') {
    const lines = links.sort((a, b) => compareKeys(a.itemKey, b.itemKey)).map((l) => {
      let text;
      if (l.state === 'VERIFIED') text = `Verified against ${l.itemKey} as of ${fmt(l.passedAt)}`;
      else if (l.state === 'SUSPECT') text = `SUSPECT: ${l.itemKey} changed ${fmt(l.change?.latestAt ?? null)}, after this test passed on ${fmt(l.passedAt)}`;
      else if (l.state === 'CLEARED') text = `Cleared against ${l.itemKey}: the change was recorded as not substantive`;
      else text = `Not run: this test is not in a Done status (verifies ${l.itemKey})`;
      return { key: l.itemKey, text, state: l.state, kind: 'link', downKey: l.testKey, upKey: l.itemKey };
    });
    const suspect = links.filter((l) => l.state === 'SUSPECT').length;
    const message = links.length === 0
      ? { appearance: 'warning', title: 'This test verifies nothing yet', body: 'Link it to the requirement or risk control it verifies.' }
      : suspect > 0
        ? { appearance: 'warning', title: `Suspect against ${plural(suspect, 'item')}`, body: 'Re-run the test and move it to a Done status, or clear the change with a reason.' }
        : null;
    return { kind: 'test', message, lines };
  }

  if (data.role === 'risk') {
    const controls = data.ripple?.derivedControls ?? [];
    const lines = controls.map((c) => ({ key: c.ctrlKey, text: `${c.ctrlKey} ${c.summary ?? ''}`.trim(), state: c.itemState ?? c.state ?? 'NOT_RUN', kind: 'control' }));
    const message = controls.length === 0
      ? { appearance: 'warning', title: 'Unmitigated risk', body: 'No risk control is linked to this risk.' }
      : null;
    return { kind: 'risk', message, lines };
  }

  // Requirement or risk control.
  const sorted = links.sort((a, b) => compareKeys(a.testKey, b.testKey));
  const lines = sorted.map((l) => ({ key: l.testKey, text: l.testKey, state: l.state, kind: 'link', downKey: l.testKey, upKey: l.itemKey }));
  for (const u of data.upstream ?? []) {
    const text = u.state === 'UPSTREAM_CHANGED'
      ? `Upstream ${u.reqKey} changed after this control was last edited: review the control`
      : u.state === 'CLEARED'
        ? `Upstream ${u.reqKey} change cleared as not substantive`
        : `Upstream ${u.reqKey}: no change since this control was last edited`;
    lines.push({ key: u.reqKey, text, state: u.state, kind: 'upstream', downKey: u.ctrlKey, upKey: u.reqKey });
  }
  const suspect = sorted.filter((l) => l.state === 'SUSPECT').length;
  const notRun = sorted.filter((l) => l.state === 'NOT_RUN').length;
  let message;
  if (sorted.length === 0) message = { appearance: 'warning', title: 'No verification test is linked', body: `Link a test issue (${testMarker(data)}) to this issue.` };
  else if (suspect > 0) message = { appearance: 'warning', title: `Changed after verification: ${plural(suspect, 'test')} suspect`, body: 'Open a suspect test below to see exactly what changed.' };
  else if (notRun > 0) message = { appearance: 'information', title: `${plural(notRun, 'test')} not run yet`, body: 'A test counts once it is in a Done status.' };
  else message = { appearance: 'success', title: `All ${plural(sorted.length, 'test')} verified`, body: 'Every linked test passed after the last substantive change.' };
  return { kind: 'item', message, lines };
}
