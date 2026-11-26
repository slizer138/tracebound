// Regression guard from the first real-site run (2026-11-26): a UI Kit Textfield or TextArea with a
// value prop round-trips every keystroke through the bridge, and fast typing lost 89 of 91
// characters in the clearance reason. Every text input must be uncontrolled (defaultValue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'frontend');

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsxFiles(p);
    return /\.(jsx|js)$/.test(name) ? [p] : [];
  });
}

test('no Textfield or TextArea in the frontend is controlled with a value prop', () => {
  const offenders = [];
  for (const file of jsxFiles(root)) {
    const src = readFileSync(file, 'utf8');
    const tags = src.match(/<(Textfield|TextArea)\b[^>]*>/gs) ?? [];
    for (const tag of tags) {
      if (/\svalue=\{/.test(tag)) offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every Textfield and TextArea in the frontend sets a defaultValue', () => {
  const missing = [];
  for (const file of jsxFiles(root)) {
    const src = readFileSync(file, 'utf8');
    const tags = src.match(/<(Textfield|TextArea)\b[^>]*>/gs) ?? [];
    for (const tag of tags) {
      if (!/\sdefaultValue=/.test(tag)) missing.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(missing, []);
});
