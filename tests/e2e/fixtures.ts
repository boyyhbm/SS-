import { test as base, expect } from '@playwright/test';
// Functional CI deliberately uses a low backing resolution and Low rendering.
// Auto calibration and graphics/performance captures are tested separately at
// their declared viewport; neither those nor this fixture certifies real GPUs.
export const test = base.extend({
  context: async ({ context }, provide) => {
    if (process.env.E2E_SOFTWARE_DPR)
      await context.addInitScript(() => {
        // Only the game's top-level document needs the rendering preset. Some
        // isolated/opaque child frames correctly deny localStorage access.
        if (window !== window.top || !['http:', 'https:'].includes(location.protocol)) return;
        localStorage.setItem(
          'nexus-render-quality',
          JSON.stringify({ state: { quality: 'low' }, version: 0 }),
        );
      });
    await provide(context);
  },
});
export { expect };
