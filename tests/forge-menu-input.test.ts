import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgeInput } from '../src/games/fold/input';
import { NexusForgeRuntime } from '../src/games/fold/runtime';
import { defaultForgeSettings } from '../src/games/fold/settings';

afterEach(() => vi.unstubAllGlobals());
describe('Forge menu input handoff', () => {
  it('keeps fresh input after the React menu effect repeats an immediate resume, while suppressing keys held through a menu', () => {
    const win = new EventTarget(),
      doc = Object.assign(new EventTarget(), { pointerLockElement: null });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    const canvas = new EventTarget() as HTMLCanvasElement;
    const input = new ForgeInput(canvas, structuredClone(defaultForgeSettings));
    const runtime = {
      menu: true,
      input,
      renderer: { element: canvas },
    } as unknown as NexusForgeRuntime;
    const setMenu = (menu: boolean) => NexusForgeRuntime.prototype.setMenu.call(runtime, menu);
    const key = (type: string) =>
      win.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), { code: 'KeyW', repeat: false }),
      );
    try {
      setMenu(false);
      key('keydown');
      expect(input.sample(1, 0, 1 / 60).moveZ).toBe(-1);
      setMenu(false); // the effect following the resume click
      expect(input.sample(2, 0, 1 / 60).moveZ).toBe(-1);
      const acknowledged = structuredClone(defaultForgeSettings);
      acknowledged.keys = Object.fromEntries(
        Object.entries(acknowledged.keys).reverse(),
      ) as typeof acknowledged.keys;
      acknowledged.controller.bindings = Object.fromEntries(
        Object.entries(acknowledged.controller.bindings).reverse(),
      ) as typeof acknowledged.controller.bindings;
      input.configure(acknowledged); // Same bindings, reordered by a cloud response.
      expect(input.sample(2, 0, 1 / 60).moveZ).toBe(-1);
      setMenu(true);
      expect(input.sample(3, 0, 1 / 60).moveZ).toBe(0);
      setMenu(false);
      expect(input.sample(4, 0, 1 / 60).moveZ).toBe(0);
      key('keyup');
      key('keydown');
      expect(input.sample(5, 0, 1 / 60).moveZ).toBe(-1);
    } finally {
      input.dispose();
    }
  });
});
