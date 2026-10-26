import { expect, it } from 'vitest';
import { vehicles, vehicleIdSchema, getVehicle } from '../src/games/vehicles/config';
import { configureVehicle } from '../src/games/vehicles/state';
import { initialCityRace, stepCityRace } from '../src/games/city-driving';
import { stepVehicleMotion } from '../src/games/vehicle-motion';
import { FixedStepClock } from '../src/games/fixed-clock';
import { cityRoutes } from '../src/games/road-network';
import { routeDriver } from './helpers/city-driver';
import { inputCommandSchema } from '../src/multiplayer/contracts';
const neutral = { throttle: 0, brake: 0, steer: 0, nitro: false };
it('registers six distinct authored models and rejects unknown vehicle/input overrides', () => {
  expect(new Set(vehicles.map((v) => v.modelAsset)).size).toBe(6);
  expect(new Set(vehicles.map((v) => v.audioProfile.id)).size).toBe(6);
  expect(vehicleIdSchema.safeParse('client-hypercar').success).toBe(false);
  expect(
    inputCommandSchema.safeParse({
      ...neutral,
      seq: 1,
      mass: 1,
      power: 100000,
      vehicleId: 'nova-x',
    }).success,
  ).toBe(false);
});
it('physically distinguishes launch, stopping distance and technical steering', () => {
  const results = vehicles.map((v) => {
    const s = configureVehicle(initialCityRace('downtown-circuit'), v.vehicleId);
    s.x = s.z = 0;
    s.heading = 0;
    let time = 0;
    while (s.speed < 100 / 3.6 && time < 30) {
      stepVehicleMotion(s, { ...neutral, throttle: 1 }, 1 / 120, () => Infinity, true);
      time += 1 / 120;
    }
    s.speed = 100 / 3.6;
    s.vx = 0;
    s.vz = s.speed;
    s.x = s.z = 0;
    s.heading = 0;
    s.driveThrottle = 0;
    let brakeTime = 0;
    while (s.speed > 0.05 && brakeTime < 10) {
      stepVehicleMotion(s, { ...neutral, brake: 1 }, 1 / 120, () => Infinity, true);
      brakeTime += 1 / 120;
    }
    return { id: v.vehicleId, time, stop: Math.hypot(s.x, s.z) };
  });
  const at = (id: string) => results.find((r) => r.id === id)!;
  expect(at('nova-x').time).toBeLessThan(at('meridian-r6').time - 1);
  expect(at('iron-v8').stop).toBeGreaterThan(at('pocket-gt').stop + 5);
  expect(at('apex-r').stop).toBeLessThan(at('nova-x').stop - 3);
  expect(getVehicle('pocket-gt').steeringResponse).toBeGreaterThan(
    getVehicle('iron-v8').steeringResponse,
  );
});
it('keeps configured motion identical at 30, 60 and 120 presentation FPS', () => {
  for (const v of vehicles) {
    const result = [30, 60, 120].map((fps) => {
      const s = configureVehicle(initialCityRace('downtown-circuit'), v.vehicleId),
        clock = new FixedStepClock();
      for (let i = 0; i < fps * 3; i++)
        clock.advance(1 / fps, (dt) => stepCityRace(s, { ...neutral, throttle: 0.6 }, dt, true));
      return s;
    });
    expect(result[0]).toEqual(result[1]);
    expect(result[1]).toEqual(result[2]);
  }
});
it('finishes the three original city routes with every vehicle through normal inputs', () => {
  for (const v of vehicles)
    for (const route of cityRoutes) {
      const s = configureVehicle(initialCityRace(route.id), v.vehicleId);
      let result: number | null = null;
      for (let i = 0; i < 15000 && result === null; i++)
        result = stepCityRace(s, routeDriver(route, s), 1 / 30);
      expect(
        result,
        route.id + ' / ' + v.vehicleId + ' / checkpoint ' + s.nextCheckpoint,
      ).not.toBeNull();
    }
}, 30000);
