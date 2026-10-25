import { expect, it } from 'vitest';
import { initialCityRace } from '../src/games/city-driving';
import { resolveVehicleContacts } from '../src/games/vehicle-contacts';
it('applies equal opposite authoritative impulses without duplicate bounce or energy gain', () => {
  const a = initialCityRace('downtown-circuit'),
    b = initialCityRace('downtown-circuit');
  a.x = -158;
  a.z = -50;
  a.heading = -Math.PI / 2;
  a.vx = -10;
  a.speed = 10;
  b.x = -160;
  b.z = -50;
  b.heading = Math.PI / 2;
  b.vx = 10;
  b.speed = 10;
  const momentum = a.vx + b.vx,
    energy = a.vx ** 2 + b.vx ** 2;
  expect(resolveVehicleContacts([a, b])).toBe(1);
  expect(a.vx + b.vx).toBeCloseTo(momentum);
  expect(a.vx ** 2 + b.vx ** 2).toBeLessThan(energy);
  expect(a.collisionImpulse).toBeGreaterThan(0);
  expect(b.collisionImpulse).toBe(a.collisionImpulse);
  expect(resolveVehicleContacts([a, b])).toBe(0);
  expect([a.x, a.z, b.x, b.z, a.impactYaw, b.impactYaw].every(Number.isFinite)).toBe(true);
});
it('leaves separate cars unchanged and excludes finished cars', () => {
  const a = initialCityRace('downtown-circuit'),
    b = initialCityRace('downtown-circuit');
  b.z += 12;
  const original = structuredClone([a, b]);
  expect(resolveVehicleContacts([a, b])).toBe(0);
  expect([a, b]).toEqual(original);
  b.z = a.z;
  b.finished = true;
  expect(resolveVehicleContacts([a, b])).toBe(0);
});
it('bounds pile-up stabilization and never swaps fast head-on cars between 30Hz ticks', async () => {
  const { simulateNetworkGroup } = await import('../src/games/network-racing');
  const { selectRoute } = await import('../src/games/route-registry');
  const config = selectRoute('downtown-circuit', 1, true);
  const a = initialCityRace('downtown-circuit'),
    b = initialCityRace('downtown-circuit');
  Object.assign(a, { x: -160, z: -58, heading: 0, speed: 54, vz: 54 });
  Object.assign(b, { x: -160, z: -42, heading: Math.PI, speed: 54, vz: -54 });
  let hits = 0;
  for (let i = 0; i < 30; i++) {
    hits += simulateNetworkGroup(
      [a, b].map((state) => ({ state, input: { throttle: 0, brake: 0, steer: 0, nitro: false } })),
      1 / 30,
      config,
    );
    expect(a.z).toBeLessThanOrEqual(b.z);
    expect([a.x, a.z, b.x, b.z, a.vz, b.vz].every(Number.isFinite)).toBe(true);
  }
  expect(hits).toBeGreaterThan(0);
  const pile = Array.from({ length: 6 }, () => initialCityRace('downtown-circuit')),
    before = pile.map((s) => ({ x: s.x, z: s.z }));
  resolveVehicleContacts(pile);
  pile.forEach((s, i) =>
    expect(Math.hypot(s.x - before[i].x, s.z - before[i].z)).toBeLessThanOrEqual(0.36001),
  );
});
it('matches client substeps and server group simulation before any peer contact', async () => {
  const { simulateNetworkGroup, stepNetworkRace } = await import('../src/games/network-racing');
  const { selectRoute } = await import('../src/games/route-registry');
  const c = selectRoute('downtown-circuit', 1, true),
    a = initialCityRace('downtown-circuit'),
    b = structuredClone(a),
    input = { throttle: 0.7, brake: 0, steer: 0.1, nitro: false };
  for (let i = 0; i < 30; i++) {
    stepNetworkRace(a, input, 1 / 30, c);
    simulateNetworkGroup([{ state: b, input }], 1 / 30, c);
  }
  expect(a).toEqual(b);
});
