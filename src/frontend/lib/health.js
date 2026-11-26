// Summary line for the admin Setup / Health checklist.

/**
 * @param {Array<{status:string}>} checks
 * @returns {{pass:number, warn:number, fail:number, appearance:string, title:string}}
 */
export function healthSummary(checks) {
  const count = (s) => (checks ?? []).filter((c) => c.status === s).length;
  const pass = count('pass');
  const warn = count('warn');
  const fail = count('fail');
  if (fail > 0) return { pass, warn, fail, appearance: 'error', title: `${fail} check${fail === 1 ? '' : 's'} failed: fix these first, top to bottom.` };
  if (warn > 0) return { pass, warn, fail, appearance: 'warning', title: `${pass} passed, ${warn} need attention.` };
  return { pass, warn, fail, appearance: 'success', title: `All ${pass} checks passed.` };
}
