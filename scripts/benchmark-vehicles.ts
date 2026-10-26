import fs from 'node:fs';
import { vehicles } from '../src/games/vehicles/config';
import { configureVehicle } from '../src/games/vehicles/state';
import { initialCityRace } from '../src/games/city-driving';
import { stepVehicleMotion } from '../src/games/vehicle-motion';
const dt = 1 / 120,
  neutral = { throttle: 0, brake: 0, steer: 0, nitro: false };
const results = vehicles.map((v) => {
  const s = configureVehicle(initialCityRace('downtown-circuit'), v.vehicleId);
  s.x = 0;
  s.z = 0;
  let hundred: number | null = null,
    twoHundred: number | null = null;
  for (let i = 1; i <= 120 / dt; i++) {
    stepVehicleMotion(s, { ...neutral, throttle: 1 }, dt, () => Infinity, true);
    if (hundred === null && s.speed >= 100 / 3.6) hundred = i * dt;
    if (twoHundred === null && s.speed >= 200 / 3.6) twoHundred = i * dt;
  }
  const maximumSpeedKmh = s.speed * 3.6;
  s.speed = 100 / 3.6;
  s.vx = 0;
  s.vz = s.speed;
  s.heading = 0;
  s.driveThrottle = 0;
  s.x = 0;
  s.z = 0;
  let brakingSeconds = 0;
  while (s.speed > 0.05 && brakingSeconds < 20) {
    stepVehicleMotion(s, { ...neutral, brake: 1 }, dt, () => Infinity, true);
    brakingSeconds += dt;
  }
  const brakingMeters = Math.hypot(s.x, s.z);
  const turn = configureVehicle(initialCityRace('downtown-circuit'), v.vehicleId);
  turn.speed = 20;
  turn.vz = 20;
  turn.heading = 0;
  for (let i = 0; i < 0.25 / dt; i++)
    stepVehicleMotion(turn, { ...neutral, throttle: 0.1, steer: 0.5 }, dt, () => Infinity, true);
  return {
    vehicleId: v.vehicleId,
    zeroTo100Seconds: hundred,
    zeroTo200Seconds: twoHundred,
    maximumSpeedKmh,
    braking100Meters: brakingMeters,
    braking100Seconds: brakingSeconds,
    steeringHeadingChangeRad: Math.abs(turn.heading),
    tireGrip: v.tireGrip,
  };
});
const report = {
  date: new Date().toISOString(),
  scope:
    'Deterministic flat dry physics benchmark at 120 Hz, no nitro, no walls; measured model behavior, not real-car claims or render performance',
  vehicleVersion: 1,
  results,
};
fs.mkdirSync('docs/racing-experience', { recursive: true });
fs.writeFileSync(
  'docs/racing-experience/vehicle-benchmarks.json',
  JSON.stringify(report, null, 2) + '\n',
);
fs.writeFileSync('src/games/vehicles/benchmarks.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
