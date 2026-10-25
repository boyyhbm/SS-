import { expect, it } from 'vitest';
import { initialCityRace, stepCityRace, citySurfaceIsDriveable } from '../src/games/city-driving';
import { cityRoutes, getCityRoute } from '../src/games/road-network';
import { FixedStepClock } from '../src/games/fixed-clock';
import { routeDriver } from './helpers/city-driver';
import { cityParkedCars } from '../src/games/road-network';
const idle = { throttle: 0, brake: 0, steer: 0, nitro: false };
it('collides with the same parked-car footprint used by the visual world', () => {
  const p = cityParkedCars[0],
    s = initialCityRace('downtown-circuit');
  s.x = p.x - 9;
  s.z = p.z;
  s.heading = Math.PI / 2;
  let collision = false;
  for (let i = 0; i < 120; i++) {
    stepCityRace(s, { ...idle, throttle: 0.5 }, 1 / 30, true);
    collision ||= s.collision;
  }
  expect(collision).toBe(true);
  expect(s.x).toBeLessThan(p.x - 3);
});
it('finishes all distinct routes with real normalized inputs and ordered checkpoints', () => {
  for (const route of cityRoutes) {
    const state = initialCityRace(route.id);
    let result: number | null = null;
    let collisions = 0;
    for (let i = 0; i < 15000; i++) {
      result = stepCityRace(state, routeDriver(route, state), 1 / 30);
      if (state.collision) collisions++;
      if (result !== null) break;
    }
    expect(result, route.id + JSON.stringify({ state, collisions })).not.toBeNull();
    expect(state.lap).toBe(2);
    expect(state.bestLap).toBeGreaterThan(8);
  }
});
it('free drive crosses actual district connections without advancing race checkpoints', () => {
  const r = getCityRoute('midnight-sprint'),
    s = initialCityRace(r.id);
  for (let i = 0; i < 1200; i++) stepCityRace(s, routeDriver(r, s), 1 / 30, true);
  expect(s.nextCheckpoint).toBe(1);
  expect(s.lap).toBe(1);
  expect(Math.hypot(s.x - r.start.x, s.z - r.start.z)).toBeGreaterThan(200);
});
it('does not grant a finish at the finish gate without earlier gates', () => {
  const r = getCityRoute('midnight-sprint'),
    s = initialCityRace(r.id),
    g = r.gates.at(-1)!;
  s.x = g.x - g.tx;
  s.z = g.z - g.tz;
  s.heading = Math.atan2(g.tx, g.tz);
  s.speed = 15;
  s.vx = g.tx * 15;
  s.vz = g.tz * 15;
  for (let i = 0; i < 8; i++) expect(stepCityRace(s, { ...idle, throttle: 1 }, 1 / 30)).toBeNull();
  expect(s.lap).toBe(1);
});
it('uses fixed timestep at 30/60/120 rendering FPS and retains analog throttle', () => {
  const states = [30, 60, 120].map((fps) => {
    const s = initialCityRace('downtown-circuit'),
      clock = new FixedStepClock();
    for (let i = 0; i < fps * 2; i++)
      clock.advance(1 / fps, (dt) => stepCityRace(s, { ...idle, throttle: 0.4 }, dt, true));
    return s;
  });
  expect(states[0]).toEqual(states[1]);
  expect(states[1]).toEqual(states[2]);
  const full = initialCityRace('downtown-circuit');
  for (let i = 0; i < 60; i++) stepCityRace(full, { ...idle, throttle: 1 }, 1 / 30, true);
  expect(full.speed).toBeGreaterThan(states[0].speed * 1.8);
});
it('stops progressively and reverses, while a curb impact keeps the vehicle on the road', () => {
  const s = initialCityRace('downtown-circuit');
  for (let i = 0; i < 50; i++) stepCityRace(s, { ...idle, throttle: 1 }, 1 / 30, true);
  const speed = s.speed;
  stepCityRace(s, { ...idle, brake: 1 }, 1 / 30, true);
  expect(s.speed).toBeGreaterThan(speed - 2);
  for (let i = 0; i < 100; i++) stepCityRace(s, { ...idle, brake: 1 }, 1 / 30, true);
  expect(s.speed).toBeLessThan(0);
  const wall = initialCityRace('downtown-circuit');
  wall.heading = Math.PI / 2;
  let hit = false;
  for (let i = 0; i < 90; i++) {
    const x = wall.x,
      z = wall.z;
    stepCityRace(wall, { ...idle, throttle: 1 }, 1 / 30, true);
    hit ||= wall.collision;
    expect(Math.hypot(wall.x - x, wall.z - z)).toBeLessThan(2);
    expect(citySurfaceIsDriveable(wall)).toBe(true);
  }
  expect(hit).toBe(true);
});
