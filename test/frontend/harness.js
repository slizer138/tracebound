// Helper (not a test file): renders a real UI Kit page with react-test-renderer.
// esbuild bundles the page, React, react-test-renderer and the real @forge/react into one file;
// @forge/bridge is replaced by fakeForge/bridge.js and ForgeReconciler/useProductContext by
// fakeForge/react.js. invoke() calls the real resolver handlers (src/backend/handlers.js) over the
// fake Jira and fake storage from test/backend/fakes.js. Nothing here talks to a network.
import { build, stop as stopEsbuild } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FAKE_BRIDGE = join(HERE, 'fakeForge', 'bridge.js');
const FAKE_REACT = join(HERE, 'fakeForge', 'react.js');
const OUT = mkdtempSync(join(tmpdir(), 'tb-ui-'));
const cache = new Map();
let importCount = 0;

// Inside a bundle, React's act() cannot find Node's setImmediate and falls back to a new
// MessageChannel per task; ports with an onmessage handler stay referenced and would keep
// `node --test` alive after the last test. Unref them once the handler is attached; the awaited
// act() calls keep the event loop alive while work is pending.
if (globalThis.MessageChannel && !globalThis.MessageChannel.__tbUnref) {
  const Real = globalThis.MessageChannel;
  globalThis.MessageChannel = class extends Real {
    constructor() {
      super();
      for (const port of [this.port1, this.port2]) {
        Object.defineProperty(port, 'onmessage', {
          configurable: true,
          set(fn) {
            port.addEventListener('message', fn);
            port.start?.();
            port.unref?.();
          },
        });
        port.unref?.();
      }
    }
  };
  globalThis.MessageChannel.__tbUnref = true;
}
const mounted = [];

/** Stops esbuild's background service so the test process can exit, and removes the bundles. */
export async function stopBundler() {
  await stopEsbuild();
  rmSync(OUT, { recursive: true, force: true });
}

/** Unmounts every rendered page, which also stops their polling timers. */
export async function cleanupAll() {
  while (mounted.length) {
    const { renderer, act } = mounted.pop();
    await act(async () => {
      renderer.unmount();
    });
  }
}

const aliasPlugin = {
  name: 'tb-forge-fakes',
  setup(b) {
    b.onResolve({ filter: /^@forge\/bridge$/ }, () => ({ path: FAKE_BRIDGE }));
    b.onResolve({ filter: /^@forge\/react$/ }, (args) => (
      args.importer === FAKE_REACT ? undefined : { path: FAKE_REACT }));
  },
};

async function bundle(page) {
  if (cache.has(page)) return cache.get(page);
  const entry = [
    `import ${JSON.stringify(join(ROOT, 'src', 'frontend', page).replace(/\\/g, '/'))};`,
    "import TestRenderer, { act } from 'react-test-renderer';",
    'export { TestRenderer, act };',
  ].join('\n');
  const outfile = join(OUT, `${page.replace(/\W/g, '_')}.mjs`);
  await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    jsx: 'transform',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    plugins: [aliasPlugin],
    logLevel: 'silent',
    banner: { js: "import { createRequire as __tbCreateRequire } from 'node:module'; const require = __tbCreateRequire(import.meta.url);" },
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  cache.set(page, outfile);
  return outfile;
}

// Props whose value UI Kit shows as text, and props that carry React elements (SectionMessage
// actions). react-test-renderer does not render element-valued props, so the helpers read them.
const TEXT_PROPS = ['title', 'header', 'description'];
const ELEMENT_PROPS = ['actions'];

function elementsIn(value) {
  if (Array.isArray(value)) return value.flatMap(elementsIn);
  return value && typeof value === 'object' && value.props ? [value] : [];
}

/** Text of a React element (not rendered), used for element-valued props. */
function elementText(el) {
  if (el === null || el === undefined || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(elementText).join('');
  return elementText(el.props?.children);
}

/** Text content of a rendered node (test instance or JSON), children joined, plus text props. */
export function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const props = node.props ?? {};
  const own = TEXT_PROPS.map((p) => (typeof props[p] === 'string' ? props[p] : '')).join('');
  const actions = ELEMENT_PROPS.flatMap((p) => elementsIn(props[p])).map(elementText).join('');
  return own + (node.children ?? []).map(textOf).join('') + actions;
}

/**
 * Renders a page. invokeImpl(key, payload) must return a resolver result.
 * @returns {Promise<{root:object, act:Function, settle:Function, calls:Array, find:Function, findAll:Function, text:Function, click:Function}>}
 */
export async function renderPage(page, { invokeImpl, context }) {
  const file = await bundle(page);
  const calls = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__tb = {
    context,
    rendered: null,
    invoke: async (key, payload, metadata) => {
      calls.push({ key, payload });
      const result = await invokeImpl(key, payload ?? {});
      return metadata ? { body: result, metadata: {} } : result;
    },
  };
  const mod = await import(`${pathToFileURL(file).href}?n=${++importCount}`);
  const element = globalThis.__tb.rendered;
  if (!element) throw new Error(`${page} did not call ForgeReconciler.render`);
  let renderer;
  await mod.act(async () => {
    renderer = mod.TestRenderer.create(element);
  });
  mounted.push({ renderer, act: mod.act });
  const settle = async (rounds = 8) => {
    for (let i = 0; i < rounds; i++) {
      await mod.act(async () => {
        await new Promise((r) => setImmediate(r));
      });
    }
  };
  await settle();
  const root = renderer.root;
  const findAll = (type, pred = () => true) => root.findAll((n) => n.type === type && pred(n));
  const find = (type, pred) => {
    const all = findAll(type, pred);
    if (all.length === 0) throw new Error(`No ${type} found`);
    return all[0];
  };
  const text = () => textOf(renderer.toJSON() === null ? null : { children: [renderer.toJSON()].flat() });
  const click = async (label, types = ['Button', 'LoadingButton']) => {
    let onClick = root.findAll((n) => types.includes(n.type) && textOf(n) === label)[0]?.props.onClick;
    if (!onClick) {
      // SectionMessage actions are elements in a prop, not rendered children.
      const actions = root.findAll((n) => n.type === 'SectionMessage').flatMap((n) => elementsIn(n.props.actions));
      onClick = actions.find((el) => elementText(el) === label)?.props.onClick;
    }
    if (!onClick) throw new Error(`No button "${label}" in: ${text().slice(0, 400)}`);
    await mod.act(async () => {
      await onClick();
    });
    await settle();
  };
  return { root, act: mod.act, settle, calls, find, findAll, text, click, renderer };
}
