// Word diff (LCS over tokens) for "what changed" displays.
import { tokenizeWords } from './normalize.js';

function push(ops, op, token) {
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += ' ' + token;
  else ops.push({ op, text: token });
}

/**
 * Word-level diff. Adjacent tokens with the same op are merged and joined by single spaces.
 * Deletions are emitted before insertions at the same position.
 * Invariant: eq+del texts joined by ' ' === tokens(before).join(' '); eq+ins likewise for after.
 * @param {string} before
 * @param {string} after
 * @param {{maxTokens?:number}} [opts]
 * @returns {import('./types.js').DiffOp[]}
 */
export function diffWords(before, after, opts = {}) {
  const maxTokens = opts.maxTokens ?? 3000;
  const a = tokenizeWords(before ?? '');
  const b = tokenizeWords(after ?? '');
  if (a.length > maxTokens || b.length > maxTokens) {
    return [
      { op: 'del', text: a.join(' ') },
      { op: 'ins', text: b.join(' ') },
    ];
  }

  // Trim the common prefix and suffix so the DP table stays small for typical edits.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops = [];
  for (let i = 0; i < start; i++) push(ops, 'eq', a[i]);

  const n = endA - start;
  const m = endB - start;
  const w = m + 1;
  // dp[i*w+j] = LCS length of a[start+i..endA) and b[start+j..endB)
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[start + i] === b[start + j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      push(ops, 'eq', a[start + i]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      push(ops, 'del', a[start + i]);
      i++;
    } else {
      push(ops, 'ins', b[start + j]);
      j++;
    }
  }
  while (i < n) push(ops, 'del', a[start + i++]);
  while (j < m) push(ops, 'ins', b[start + j++]);

  for (let k = endA; k < a.length; k++) push(ops, 'eq', a[k]);
  return ops;
}
