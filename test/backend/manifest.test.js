// Static checks on manifest.yml and the source tree (C3), against limits read from the live
// manifest reference on 2026-11-25. No Forge CLI and no network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = parse(readFileSync(join(ROOT, 'manifest.yml'), 'utf8'));
const M = manifest.modules;
const KEY_RE = /^[a-zA-Z0-9_-]+$/;

test('every module key matches the documented pattern and is unique', () => {
  const keys = [];
  for (const list of Object.values(M)) for (const m of list) keys.push(m.key);
  for (const k of keys) assert.match(k, KEY_RE, k);
  assert.equal(new Set(keys).size, keys.length);
});

test('function keys are at most 23 characters and handlers exist in src/index.js', () => {
  const index = readFileSync(join(ROOT, 'src', 'index.js'), 'utf8');
  const entry = readFileSync(join(ROOT, 'src', 'backend', 'entry.js'), 'utf8') + readFileSync(join(ROOT, 'src', 'backend', 'resolvers.js'), 'utf8');
  for (const f of M.function) {
    assert.ok(f.key.length <= 23, `${f.key} is ${f.key.length} chars`);
    const [file, name] = f.handler.split('.');
    assert.equal(file, 'index');
    assert.match(index, new RegExp(`\\b${name}\\b`), `${name} re-exported from src/index.js`);
    assert.match(entry, new RegExp(`export (const|async function) ${name}\\b`), `${name} defined`);
  }
  const consumer = M.function.find((f) => f.key === 'job-consumer');
  assert.ok(consumer.timeoutSeconds >= 1 && consumer.timeoutSeconds <= 900);
});

test('modules reference existing functions, resources and actions', () => {
  const fnKeys = new Set(M.function.map((f) => f.key));
  const resKeys = new Set(manifest.resources.map((r) => r.key));
  const actionKeys = new Set(M.action.map((a) => a.key));
  for (const mod of ['jira:projectPage', 'jira:issueContext', 'jira:adminPage']) {
    for (const m of M[mod]) {
      assert.ok(m.title, `${m.key} title`);
      assert.equal(m.render, 'native');
      assert.ok(resKeys.has(m.resource), `${m.key} resource`);
      assert.ok(fnKeys.has(m.resolver.function), `${m.key} resolver`);
    }
  }
  assert.ok(M['jira:issueContext'][0].label, 'issueContext label is required');
  const special = M['jira:adminPage'].filter((a) => a.useAsGetStarted || a.useAsConfig);
  const plain = M['jira:adminPage'].filter((a) => !a.useAsGetStarted && !a.useAsConfig);
  assert.equal(special.length, 1);
  assert.equal(plain.length, 1);
  for (const c of M.consumer) assert.ok(fnKeys.has(c.function));
  for (const a of M.action) {
    assert.ok(fnKeys.has(a.function), `${a.key} function`);
    assert.ok(['GET', 'CREATE', 'UPDATE', 'DELETE', 'TRIGGER'].includes(a.actionVerb));
    assert.ok(a.name && a.description);
    for (const [name, inp] of Object.entries(a.inputs)) {
      assert.ok(inp.title && inp.description, `${a.key}.${name}`);
      assert.ok(['string', 'integer', 'number', 'boolean'].includes(inp.type));
      assert.equal(typeof inp.required, 'boolean');
    }
  }
  assert.deepEqual(M.action.filter((a) => a.actionVerb !== 'GET').map((a) => a.key), ['tb-create-reverification-task']);
  const agent = M['rovo:agent'][0];
  assert.ok(agent.name.length <= 30);
  for (const k of agent.actions) assert.ok(actionKeys.has(k));
  const mcp = M['rovo:mcp'];
  assert.equal(mcp.length, 1);
  assert.ok(mcp[0].name.length <= 30);
  assert.ok(mcp[0].tools.length <= 50);
  for (const k of mcp[0].tools) {
    assert.ok(actionKeys.has(k));
    assert.ok(k.length < 64);
  }
  const m = /^resource:([^;]+);(.+)$/.exec(agent.prompt);
  const res = manifest.resources.find((r) => r.key === m[1]);
  assert.ok(existsSync(join(ROOT, res.path, m[2])), 'agent prompt file exists');
});

test('resource paths exist', () => {
  for (const r of manifest.resources) assert.ok(existsSync(join(ROOT, r.path)), r.path);
});

test('minimal scopes, no egress, runtime as decided', () => {
  assert.deepEqual(manifest.permissions.scopes, ['read:jira-work', 'write:jira-work', 'storage:app']);
  assert.equal(manifest.permissions.external, undefined);
  assert.deepEqual(manifest.app.runtime, { name: 'nodejs24.x', memoryMB: 512, architecture: 'arm64' });
});

test('the app.rovo block kept in docs/mcp.md is within the documented limits', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'mcp.md'), 'utf8');
  const block = /```yaml\n([\s\S]*?)```/.exec(doc)[1];
  const { rovo } = parse(block);
  assert.ok(rovo.tag.length <= 8);
  assert.ok(rovo.description.length <= 100, `${rovo.description.length}`);
  assert.ok(rovo.keywords.join('').length <= 50);
});

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('C3: @forge imports only in the three adapter files and the frontend; no fetch or external URLs in src', () => {
  const allowed = new Map([
    ['jiraClient.js', ['@forge/api']],
    ['store.js', ['@forge/kvs']],
    ['queue.js', ['@forge/events']],
    ['resolvers.js', ['@forge/resolver']],
  ]);
  for (const f of walk(join(ROOT, 'src'))) {
    if (!/\.(js|jsx)$/.test(f)) continue;
    const s = readFileSync(f, 'utf8');
    const imports = [...s.matchAll(/from '(@forge\/[a-z-]+)'/g)].map((m) => m[1]);
    const base = f.split(/[\\/]/).pop();
    if (f.includes(`${join('src', 'frontend')}`)) {
      for (const i of imports) assert.ok(['@forge/react', '@forge/bridge'].includes(i), `${base}: ${i}`);
    } else if (imports.length) {
      assert.deepEqual(imports, allowed.get(base), `${base} imports ${imports}`);
    }
    assert.doesNotMatch(s, /\bfetch\(/, `${base} calls fetch(`);
    assert.doesNotMatch(s, /https?:\/\//, `${base} contains a URL`);
  }
});

test('C3: no "compliant"/"compliance" wording in src, prompts, skill, docs or submission', () => {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'prompts')), ...walk(join(ROOT, 'skills')), ...walk(join(ROOT, 'docs')), ...walk(join(ROOT, 'submission'))];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /complian(t|ce)/i, f);
  }
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/does not make you compliant/gi, '');
  assert.doesNotMatch(readme, /complian(t|ce)/i);
});
