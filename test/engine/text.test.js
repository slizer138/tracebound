// N1-N6: normalisation, tokenising, word diff, timestamps and ADF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, tokenizeWords, diffWords, parseJiraTime, tryParseJiraTime, toJiraTime, adfToText, textToAdf, epochToMs,
} from '../../src/engine/index.js';

const cp = (...c) => String.fromCodePoint(...c);

const FIXTURES = [
  '', ' ', 'plain text', '  leading and trailing  ', 'multi\nline\n\ntext', 'tabs\tand\r\nCRLF',
  `nbsp${cp(0xa0)}space`, `thin${cp(0x2009)}space`, `zero${cp(0x200b)}width`, `${cp(0x201c)}quoted${cp(0x201d)}`,
  `it${cp(0x2019)}s`, `en${cp(0x2013)}dash and em${cp(0x2014)}dash`, '*bold* text', '_italic_ text', '+under+ line',
  '^sup^ and ~sub~', '-strike- this', '**markdown bold**', '__md under__', 'h1. Heading', 'h3.  Sub heading',
  'bq. quoted block', '* item one\n* item two', '# numbered\n# list', '- dash list', '{{monospace}} code',
  '[link text|https://example.com]', '{color:red}red{color}', '{code:java}x = 1;{code}', '{noformat}raw{noformat}',
  '!image.png! after', '!image.png|width=200! after', 'before ---- after', '0.05-unit steps, 25 units',
  'snake_case_name stays', 'a - b - c', '2-3-4 range', '1+2+3', 'Warning! Danger!', 'x**y', '***triple***',
  '* *nested* bold', '{*}25{*} units', '**_both_**', `${cp(0xff21)}${cp(0xff22)} fullwidth`, 'ﬁ ligature',
  'CASE Stays', 'trailing punctuation.', '-', '--', `soft${cp(0xad)}hyphen`, `line${cp(0x2028)}sep`,
];

test('N1 normalizeText is idempotent on 50+ fixture strings', () => {
  assert.ok(FIXTURES.length >= 50);
  for (const s of FIXTURES) {
    const once = normalizeText(s);
    assert.equal(normalizeText(once), once, `not idempotent for ${JSON.stringify(s)}`);
    assert.equal(once, once.trim());
    assert.ok(!/\s{2,}/.test(once), `whitespace not collapsed for ${JSON.stringify(s)}`);
  }
});

test('normalizeText: specific behaviours', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText('The dose shall not exceed *25* units'), 'The dose shall not exceed 25 units');
  assert.equal(normalizeText('{*}25{*} units'), '25 units');
  assert.equal(normalizeText('h1. Title\n* one\n* two'), 'Title one two');
  // Link targets and image names are kept, so a changed target or a swapped image is a change.
  assert.equal(normalizeText('[the spec|https://x.test/a]'), 'the spec <https://x.test/a>');
  assert.equal(normalizeText('{color:#ff0000}red{color}'), 'red');
  assert.equal(normalizeText('{{code}}'), 'code');
  assert.equal(normalizeText('!diagram.png|thumbnail! See above'), 'diagram.png See above');
  assert.equal(normalizeText('snake_case_name'), 'snake_case_name');
  assert.equal(normalizeText('0.05-unit steps'), '0.05-unit steps');
  assert.equal(normalizeText('a - b - c'), 'a - b - c');
  assert.equal(normalizeText('Warning! Danger!'), 'Warning! Danger!');
  assert.equal(normalizeText('Shall'), 'Shall'); // case preserved
  assert.equal(normalizeText(`${cp(0x201c)}x${cp(0x201d)} ${cp(0x2018)}y${cp(0x2019)}`), '"x" \'y\'');
  assert.equal(normalizeText(`a${cp(0x2014)}b`), 'a-b');
  assert.equal(normalizeText(`a${cp(0xa0)}${cp(0xa0)}b`), 'a b');
  assert.equal(normalizeText(`a${cp(0x200b)}b`), 'ab');
  assert.equal(normalizeText('**_both_**'), 'both');
  assert.equal(normalizeText('x\n----\ny'), 'x y');
});

test('N2 tokenizeWords keeps numbers whole and splits punctuation', () => {
  assert.deepEqual(tokenizeWords('0.05-unit steps, 25 units'), ['0.05', '-', 'unit', 'steps', ',', '25', 'units']);
  assert.deepEqual(tokenizeWords('3.5 and 1,000 units.'), ['3.5', 'and', '1,000', 'units', '.']);
  assert.deepEqual(tokenizeWords(''), []);
  assert.deepEqual(tokenizeWords(null), []);
  assert.deepEqual(tokenizeWords('Dosis über 5%'), ['Dosis', 'über', '5', '%']);
});

test('N3 diffWords on the demo edit', () => {
  assert.deepEqual(diffWords('shall not exceed 25 units', 'shall not exceed 20 units'), [
    { op: 'eq', text: 'shall not exceed' },
    { op: 'del', text: '25' },
    { op: 'ins', text: '20' },
    { op: 'eq', text: 'units' },
  ]);
});

test('diffWords invariants and edge cases', () => {
  const cases = [
    ['', ''], ['', 'new text'], ['old text', ''], ['a b c', 'a b c'], ['a b c d', 'x a c d y'],
    ['the quick brown fox', 'the slow brown dog jumps'], ['1 2 3 4 5', '5 4 3 2 1'],
    ['A single bolus dose shall not exceed 25 units per request.', 'A single bolus dose shall not exceed 20 units per hour.'],
  ];
  for (const [a, b] of cases) {
    const d = diffWords(a, b);
    const side = (ops) => d.filter((x) => ops.includes(x.op)).map((x) => x.text).join(' ');
    assert.equal(side(['eq', 'del']), tokenizeWords(a).join(' '), `before side for ${a} -> ${b}`);
    assert.equal(side(['eq', 'ins']), tokenizeWords(b).join(' '), `after side for ${a} -> ${b}`);
    for (let i = 1; i < d.length; i++) assert.notEqual(d[i].op, d[i - 1].op, 'adjacent ops must be merged');
  }
  assert.deepEqual(diffWords('same', 'same'), [{ op: 'eq', text: 'same' }]);
  assert.deepEqual(diffWords('', ''), []);
});

test('N4 diffWords falls back to whole del+ins beyond maxTokens', () => {
  const a = Array.from({ length: 3001 }, (_, i) => `a${i}`).join(' ');
  const b = Array.from({ length: 3001 }, (_, i) => `b${i}`).join(' ');
  const d = diffWords(a, b);
  assert.deepEqual(d, [{ op: 'del', text: a }, { op: 'ins', text: b }]);
  // Exactly 3000 tokens still diffs normally.
  const c = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(' ');
  assert.equal(diffWords(c, c + ' z').at(-1).op, 'ins');
  assert.deepEqual(diffWords('x y', 'x z', { maxTokens: 1 }).map((o) => o.op), ['del', 'ins']);
});

test('N5 parseJiraTime accepts Jira and ISO forms', () => {
  assert.equal(parseJiraTime('2026-11-25T10:15:30.123+0000'), 1795601730123);
  assert.equal(parseJiraTime('2026-11-25T10:15:30.123Z'), 1795601730123);
  assert.equal(parseJiraTime('2026-11-25T10:15:30.123+00:00'), 1795601730123);
  assert.equal(parseJiraTime('2026-11-25T12:15:30.123+0200'), 1795601730123);
  assert.equal(parseJiraTime('2026-11-25T10:15:30Z'), 1795601730000);
  assert.equal(parseJiraTime('2026-11-25T10:15Z'), 1795601700000);
  assert.equal(parseJiraTime('2026-11-25T10:15:30.123456+0000'), 1795601730123);
  for (const bad of ['garbage', '', '2026-11-25', '2026-13-45T99:99:99Z', null, undefined, 12345, 1795601730123]) {
    assert.throws(() => parseJiraTime(bad), RangeError, `should reject ${bad}`);
  }
  assert.equal(tryParseJiraTime('nope'), null);
  assert.equal(toJiraTime(1795601730123), '2026-11-25T10:15:30.123+0000');
  assert.equal(parseJiraTime(toJiraTime(1795601730123)), 1795601730123);
});

test('tryParseJiraTime accepts epoch seconds and milliseconds (bulkfetch "created" may be a number)', () => {
  // The Jira v3 OpenAPI example for POST /rest/api/3/changelog/bulkfetch: "created":1492070429.
  assert.equal(tryParseJiraTime(1492070429), 1492070429000);
  assert.equal(tryParseJiraTime(1795601730123), 1795601730123);
  assert.equal(tryParseJiraTime('1795601730123'), 1795601730123);
  assert.equal(tryParseJiraTime(' 1492070429 '), 1492070429000);
  assert.equal(epochToMs(1492070429.5), 1492070429500);
  for (const bad of [12345, 0, -1, NaN, Infinity, '12345', '1795601730123x', true, {}]) {
    assert.equal(tryParseJiraTime(bad), null, `should reject ${String(bad)}`);
  }
  // Strings still parse as before.
  assert.equal(tryParseJiraTime('2026-11-25T10:15:30.123+0000'), 1795601730123);
});

test('normalizeText: review round 3 pairs', () => {
  // Hidden changes that must now be visible.
  assert.notEqual(normalizeText('- 5 units'), normalizeText('5 units'));
  assert.equal(normalizeText('- 5 units'), '- 5 units');
  assert.notEqual(normalizeText('[spec|http://a.test/1]'), normalizeText('[spec|http://a.test/2]'));
  assert.notEqual(normalizeText('!a.png!'), normalizeText('!b.png!'));
  // "- " before a word is still a list marker.
  assert.equal(normalizeText('- dash item'), 'dash item');
  assert.equal(normalizeText('*  5 units'), '5 units');
  // Formatting-only differences that must now compare equal.
  assert.equal(normalizeText('{panel}x{panel}'), normalizeText('x'));
  assert.equal(normalizeText('{panel:title=Note|borderStyle=dashed}x{panel}'), 'x');
  for (const m of ['info', 'note', 'warning', 'tip', 'quote']) {
    assert.equal(normalizeText(`{${m}}x{${m}}`), 'x', m);
    assert.equal(normalizeText(`{${m}:title=T}x{${m}}`), 'x', `${m} with parameters`);
  }
  assert.equal(normalizeText('|| a || b ||'), normalizeText('| a | b |'));
  assert.equal(normalizeText('x{*}bold{*}y'), 'xboldy');
  assert.equal(normalizeText('x{_}it{_}y'), 'xity');
  // Strike, superscript and subscript markers are still kept.
  assert.equal(normalizeText('x{-}s{-}y'), 'x-s-y');
  assert.equal(normalizeText('10{^}5{^}'), '10^5^');
  // Idempotent on the new forms.
  for (const s of ['- 5 units', '[spec|http://a.test/1]', '!a.png|thumbnail!', '{panel}x{panel}', '|| a || b ||', 'x{*}b{*}y', '-  5']) {
    const once = normalizeText(s);
    assert.equal(normalizeText(once), once, s);
  }
});

test('N6 adfToText on paragraphs, lists, hardBreak, mention, emoji and cards', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Dose limit ' }, { type: 'text', text: '25', marks: [{ type: 'strong' }] }, { type: 'text', text: ' units.' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }] }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'abc', text: '@Ann' } }, { type: 'text', text: ' see ' }, { type: 'emoji', attrs: { shortName: ':warning:' } }] },
      { type: 'paragraph', content: [{ type: 'inlineCard', attrs: { url: 'https://example.com/x' } }, { type: 'status', attrs: { text: 'DRAFT' } }] },
      { type: 'mysteryNode', content: [{ type: 'text', text: 'inside unknown' }] },
    ],
  };
  assert.equal(adfToText(adf), 'Dose limit 25 units.\nfirst\nsecond\nline two\n@Ann see :warning:\nhttps://example.com/xDRAFT\ninside unknown');
  assert.equal(adfToText(null), '');
  assert.equal(adfToText({ type: 'doc', version: 1, content: [] }), '');
  assert.equal(normalizeText(adfToText(adf)).includes('\n'), false);
});

test('textToAdf round-trips through adfToText', () => {
  const adf = textToAdf(['First paragraph.', '', 'Third.']);
  assert.equal(adf.type, 'doc');
  assert.equal(adf.version, 1);
  assert.deepEqual(adf.content[1], { type: 'paragraph', content: [] });
  assert.equal(adfToText(adf), 'First paragraph.\nThird.');
});
