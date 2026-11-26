// Test stand-in for @forge/bridge. invoke() is routed to globalThis.__tb.invoke, which the
// render tests wire to the real resolver handlers running against a fake Jira and fake storage.
export const invoke = (key, payload, metadata) => globalThis.__tb.invoke(key, payload, metadata);
export const view = {
  getContext: async () => globalThis.__tb.context,
  theme: { enable: async () => {} },
};
export const router = { navigate: async () => {}, open: async () => {}, reload: async () => {} };
export const events = { on: async () => ({ unsubscribe: () => {} }), emit: async () => {} };
export const requestJira = async () => {
  throw new Error('requestJira is not used by Tracebound');
};
