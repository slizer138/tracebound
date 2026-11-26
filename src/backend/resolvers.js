// Registers every handler from handlers.js on one @forge/resolver Resolver ("resolver" function).
import ResolverModule from '@forge/resolver';

// The Forge bundler resolves the default import to the class (as in the official template);
// plain Node ESM gives the CommonJS exports object, whose .default is the class.
const Resolver = ResolverModule.default ?? ResolverModule;
import { makeHandlers } from './handlers.js';
import { interactiveDeps } from './runtime.js';

const resolver = new Resolver();
let handlers = null;
const get = () => (handlers ??= makeHandlers(interactiveDeps()));

for (const key of Object.keys(makeHandlers({}))) {
  resolver.define(key, (req) => get()[key](req));
}

export const handler = resolver.getDefinitions();
