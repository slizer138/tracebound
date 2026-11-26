// Text normalisation used to decide whether an edit is substantive.
// Case, digits and punctuation inside words are preserved: "shall" -> "SHALL" is a change.
// Unicode is normalised with NFC, not NFKC: NFKC folds superscripts (superscript five in "10^5" -> "105"), which
// would hide a real change to an exponent. Strike (-x-), superscript (^x^) and subscript (~x~)
// markers are KEPT, because striking a word or raising an exponent changes the meaning
// ("10^-8^ /h" is not "10-8 /h"). Only bold, italic and underline markers are stripped.

// Character classes are built from code points so the source stays plain ASCII.
const cls = (codes, extra = '') => new RegExp('[' + codes.map((c) => String.fromCodePoint(c)).join('') + extra + ']', 'g');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SPACE_CHARS = cls([0x00a0, 0x1680, ...range(0x2000, 0x200a), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000], '\\t\\r\\f\\v');
const ZERO_WIDTH = cls([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
const SINGLE_QUOTES = cls([0x2018, 0x2019, 0x201a, 0x201b, 0x2032]);
const DOUBLE_QUOTES = cls([0x201c, 0x201d, 0x201e, 0x201f, 0x2033]);
const DASHES = cls([0x2013, 0x2014]);

// Paired emphasis markers stripped as formatting-only (Jira wiki: *bold* _italic_ +underline+).
// The marker must wrap a word: not preceded or followed by a letter or digit,
// and the wrapped text must not start or end with a space.
const EMPHASIS_RES = ['*', '_', '+'].map((m) => {
  const e = '\\x' + m.charCodeAt(0).toString(16).padStart(2, '0'); // valid inside and outside classes in u-mode
  return new RegExp(`(^|[^\\p{L}\\p{N}${e}])${e}([^\\s${e}](?:[^${e}\\n]*?[^\\s${e}])?)${e}(?=$|[^\\p{L}\\p{N}${e}])`, 'gu');
});

/** One normalisation pass. normalizeText iterates it to a fixed point. */
function pass(input) {
  let s = input.normalize('NFC');
  s = s.replace(ZERO_WIDTH, '').replace(SPACE_CHARS, ' ');
  s = s.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(DASHES, '-');

  // Block-level wiki markup at line starts.
  s = s.replace(/^[ ]*h[1-6]\.[ ]+/gm, '');
  s = s.replace(/^[ ]*bq\.[ ]+/gm, '');
  // "*" and "#" list markers. "-" is a list marker only when no digit follows, so the minus sign
  // of "- 5 units" survives ("- 5 units" and "5 units" are different requirements).
  s = s.replace(/^[ ]*[*#]+[ ]+/gm, '');
  s = s.replace(/^[ ]*-+[ ]+(?![ \d])/gm, '');
  s = s.replace(/(^|\s)-{4,}(?=\s|$)/g, '$1');

  // Monospace first (so "{{code}}" is not read as a {code} macro), then macros and links.
  s = s.replace(/\{\{([^{}]*)\}\}/g, '$1');
  s = s.replace(/\{color(?::[^}]*)?\}/g, '');
  s = s.replace(/\{code(?::[^}]*)?\}/g, '');
  s = s.replace(/\{noformat(?::[^}]*)?\}/g, '');
  s = s.replace(/\{(?:quote|panel|info|note|warning|tip|expand)(?::[^}]*)?\}/g, '');
  // {*}bold{*} form used when a mark touches a word: bold, italic and underline are formatting
  // and are removed even inside a word; strike, superscript and subscript keep their marker.
  s = s.replace(/\{[*_+]\}/g, '');
  s = s.replace(/\{([\^~-])\}/g, '$1');
  // Links keep their target ([spec|target] -> "spec <target>"), so a changed target is a change.
  s = s.replace(/\[([^[\]|\n]+)\|([^[\]\n]+)\]/g, (_, text, target) => `${text.trim()} <${target.trim()}>`);
  // Images keep their file name (!a.png|thumbnail! -> "a.png"), so a swapped image is a change.
  s = s.replace(/!([^\s!|]*[./][^\s!|]*)(\|[^!\n]*)?!/g, '$1');
  // Wiki table header cells (||) and ordinary cells (|) are the same text.
  s = s.replace(/\|\|/g, '|');

  // Markdown strong/emphasis, then wiki paired emphasis.
  s = s.replace(/\*\*(\S(?:[^*\n]*?\S)?)\*\*/g, '$1');
  s = s.replace(/__(\S(?:[^_\n]*?\S)?)__/g, '$1');
  for (const re of EMPHASIS_RES) s = s.replace(re, '$1$2');

  // Whitespace, including newlines, collapses to one space.
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normalises text for substantive comparison. Idempotent:
 * normalizeText(normalizeText(x)) === normalizeText(x).
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function normalizeText(input) {
  if (input === null || input === undefined) return '';
  let s = String(input);
  for (let i = 0; i < 25; i++) {
    const next = pass(s);
    if (next === s) return s;
    s = next;
  }
  return s;
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:[.,][\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

/**
 * Splits normalised text into words (numbers like 0.05 stay whole) and single punctuation tokens.
 * @param {string} s
 * @returns {string[]}
 */
export function tokenizeWords(s) {
  if (!s) return [];
  return String(s).match(TOKEN_RE) ?? [];
}

/**
 * The key two texts are compared by to decide whether a change is substantive: the word and
 * punctuation tokens of the normalised text, without the whitespace between them. Using the same
 * tokens the word diff is built from guarantees that "changed" and "the diff shows something"
 * always agree: 'per request.' and 'per request .' are the same text, and so are '1:2' and '1 : 2'.
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function compareKey(input) {
  return tokenizeWords(normalizeText(input)).join('\u0001');
}
