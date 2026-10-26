import { test as base, expect } from '@playwright/test';
// Functional CI deliberately uses a low backing resolution and Low rendering.
// Auto calibration and graphics/performance captures are tested separately at
// their declared viewport; neither those nor this fixture certifies real GPUs.
export const test = base.extend({
  context: async ({ context }, provide) => {
    if (process.env.E2E_SOFTWARE_DPR)
      await context.addInitScript(() =>
        localStorage.setItem(
          'nexus-render-quality',
          JSON.stringify({ state: { quality: 'low' }, version: 0 }),
        ),
      );
    await provide(context);
  },
});
export { expect };
