// Static consistency checks on src/frontend: resolver keys match the backend, every UI Kit
// component used exists in @forge/react and is not a Preview or deprecated one, and every JSX
// tag is imported or defined (ESLint without a React plugin does not check that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLVER_KEYS } from '../../src/backend/handlers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONT = join(ROOT, 'src', 'frontend');

// Names exported by the installed @forge/react, read from its type declarations (requiring the
// package in Node fails, because @forge/bridge needs a real Atlassian page).
function forgeReactExports() {
  const names = new Set();
  for (const f of walk(join(ROOT, 'node_modules', '@forge', 'react', 'out')).filter((p) => p.endsWith('.d.ts'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/export declare (?:const|function) (\w+)/g)) names.add(m[1]);
    for (const m of s.matchAll(/export \{([^}]*)\} from/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop();
        if (n && !part.trim().startsWith('type ')) names.add(n);
      }
    }
  }
  return names;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(FRONT).filter((f) => /\.(js|jsx)$/.test(f));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));

// Labelled Preview, EAP or deprecated on the UI Kit components pages read on 2026-11-25.
const NOT_GA = ['Popup', 'InlineEdit', 'Pagination', 'Router', 'Pressable', 'Bleed', 'Calendar', 'TimePicker', 'List',
  'ListItem', 'Tile', 'AtlassianTile', 'AtlassianIcon', 'ChromelessEditor', 'CommentEditor', 'Breadcrumbs',
  'BreadcrumbsItem', 'FilePicker', 'FileCard', 'Strong', 'Em', 'Strike'];

test('every resolver key the UI calls exists, and every resolver key is used by the UI', () => {
  const called = new Set();
  for (const s of Object.values(src)) for (const m of s.matchAll(/call\('([a-zA-Z.]+)'/g)) called.add(m[1]);
  for (const k of called) assert.ok(RESOLVER_KEYS.includes(k), `UI calls unknown resolver ${k}`);
  for (const k of RESOLVER_KEYS) assert.ok(called.has(k), `resolver ${k} is never called by the UI`);
});

test('UI Kit imports exist in @forge/react and none is Preview, EAP or deprecated', () => {
  const forgeReact = forgeReactExports();
  assert.ok(forgeReact.has('DynamicTable') && forgeReact.has('Text') && forgeReact.has('useProductContext'));
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/import\s+(?:ForgeReconciler,\s*)?\{([^}]*)\}\s+from '@forge\/react'/g)) {
      for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        assert.ok(forgeReact.has(name), `${f}: ${name} is not exported by @forge/react`);
        assert.ok(!NOT_GA.includes(name), `${f}: ${name} is not GA`);
      }
    }
  }
});

test('every capitalised JSX tag is imported or defined in its file; no HTML elements', () => {
  for (const [f, s] of Object.entries(src)) {
    if (!f.endsWith('.jsx')) continue;
    const known = new Set(['React']);
    for (const m of s.matchAll(/import\s+([\s\S]*?)\s+from\s+'[^']+'/g)) {
      for (const n of m[1].replace(/[{}]/g, ',').split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)) known.add(n);
    }
    for (const m of s.matchAll(/(?:const|function)\s+([A-Z]\w*)/g)) known.add(m[1]);
    const tags = new Set([...s.matchAll(/<([A-Za-z][\w.]*)[\s/>]/g)].map((m) => m[1]));
    for (const t of tags) {
      assert.match(t, /^[A-Z]/, `${f}: <${t}> is an HTML element; UI Kit allows only @forge/react components`);
      assert.ok(known.has(t.split('.')[0]), `${f}: <${t}> is neither imported nor defined`);
    }
  }
});

test('no TODO, FIXME or placeholder text in the frontend', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.doesNotMatch(s, /\b(TODO|FIXME|XXX)\b/, f);
    assert.doesNotMatch(s, /lorem ipsum|not built yet/i, f);
    assert.doesNotMatch(s, /\bPLACEHOLDER\b/, f);
  }
});
