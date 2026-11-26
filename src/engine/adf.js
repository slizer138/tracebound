// Atlassian Document Format helpers.

const BLOCK_TYPES = new Set([
  'doc', 'paragraph', 'heading', 'listItem', 'bulletList', 'orderedList', 'taskList', 'taskItem',
  'decisionList', 'decisionItem', 'blockquote', 'codeBlock', 'table', 'tableRow', 'tableCell',
  'tableHeader', 'panel', 'rule', 'mediaSingle', 'mediaGroup', 'expand', 'nestedExpand', 'blockCard',
]);

function walk(node, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  if (typeof node !== 'object') return;
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'text':
      out.push(typeof node.text === 'string' ? node.text : '');
      return;
    case 'hardBreak':
      out.push('\n');
      return;
    case 'mention':
      out.push(String(attrs.text ?? ''));
      return;
    case 'emoji':
      out.push(String(attrs.shortName ?? ''));
      return;
    case 'inlineCard':
      out.push(String(attrs.url ?? ''));
      return;
    case 'blockCard':
      out.push('\n', String(attrs.url ?? ''), '\n');
      return;
    case 'status':
      out.push(String(attrs.text ?? ''));
      return;
    default:
      break;
  }
  const block = BLOCK_TYPES.has(node.type);
  if (block) out.push('\n');
  if (Array.isArray(node.content)) walk(node.content, out);
  if (block) out.push('\n');
}

/**
 * Plain text from an ADF document. Blocks are separated by single newlines; marks are ignored.
 * @param {object|null|undefined} adf
 * @returns {string}
 */
export function adfToText(adf) {
  if (adf === null || adf === undefined) return '';
  if (typeof adf === 'string') return adf;
  const out = [];
  walk(adf, out);
  return out
    .join('')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Minimal ADF document with one paragraph per string.
 * @param {string[]} paragraphs
 * @returns {{type:'doc', version:1, content:object[]}}
 */
export function textToAdf(paragraphs) {
  return {
    type: 'doc',
    version: 1,
    content: (paragraphs ?? []).map((p) => ({
      type: 'paragraph',
      content: p ? [{ type: 'text', text: String(p) }] : [],
    })),
  };
}
