import { z } from 'zod';
// The isolated host permits Wasm compilation, never JavaScript eval. Disable
// Zod's optional JIT before schemas are constructed, including in CDP probes.
z.config({ jitless: true });
