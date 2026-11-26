// Test stand-in for @forge/react as seen by src/frontend: every component is the real export
// (UI Kit components are host-element names such as 'Text'), but ForgeReconciler.render captures
// the element instead of sending it over the bridge, and useProductContext reads the test context.
export * from '@forge/react';

export function useProductContext() {
  return globalThis.__tb.context;
}

const ForgeReconciler = {
  render(element) {
    globalThis.__tb.rendered = element;
  },
};
export default ForgeReconciler;
