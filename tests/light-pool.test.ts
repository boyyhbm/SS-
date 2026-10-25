import { expect, it } from 'vitest';
import { stableLightTargets } from '../src/games/visual/light-pool';
it('does not fade or teleport lights just because nearest-distance ordering changes', () => {
  const a = {},
    b = {},
    c = {};
  expect(stableLightTargets([{ current: a }, { current: b }, { current: c }], [c, a, b])).toEqual([
    a,
    b,
    c,
  ]);
});
it('replaces only fixtures outside the nearest set, without duplicate targets', () => {
  const a = {},
    b = {},
    c = {},
    d = {};
  const targets = stableLightTargets([{ current: a }, { current: b }, { current: c }], [d, b, c]);
  expect(targets).toEqual([d, b, c]);
  expect(new Set(targets).size).toBe(3);
});
it('retains a pending fade destination during reordering and initializes distinct fixtures', () => {
  const a = {},
    b = {},
    c = {};
  expect(
    stableLightTargets(
      [
        { current: a, target: c },
        { current: b, target: b },
      ],
      [b, c],
    ),
  ).toEqual([c, b]);
  expect(stableLightTargets([{}, {}], [a, b])).toEqual([a, b]);
});
