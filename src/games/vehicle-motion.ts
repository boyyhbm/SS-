import { applyContactImpulse, sweepBody } from './contact-physics';
import type { RaceState, RaceInput } from './racing-physics';
import { vehicleDynamics } from './vehicles/powertrain';
import { vehicleDimensions } from './vehicles/config';
export interface VehicleMotionState extends RaceState {
  finished: boolean;
  driveThrottle: number;
  brakePressure: number;
  reverseTimer: number;
  impactYaw: number;
  collisionImpulse: number;
}
export const drivingTuning = {
  wheelbase: 2.8,
  steeringResponse: 7.5,
  throttleResponse: 5,
  brakeResponse: 10,
  engineAcceleration: 10,
  boostAcceleration: 17,
  braking: 22,
  handbrake: 13,
  topSpeed: 54,
  boostTopSpeed: 68,
  carRadius: 1.05,
};
export function steeringAngle(speed: number, limit = 0.52) {
  return limit / (1 + Math.abs(speed) / 14);
}
const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, Number.isFinite(n) ? n : 0));
export function stepVehicleMotion(
  s: VehicleMotionState,
  input: RaceInput,
  dt: number,
  clearance: (x: number, z: number, heading: number) => number,
  freeDrive = false,
  grade = 0,
  surfaceGrip = 1,
) {
  const dyn = s.vehicleId
    ? vehicleDynamics(
        s,
        dt,
        !!input.nitro && s.nitro > 0 && s.driveThrottle > 0.2 && s.speed > 1,
        surfaceGrip,
      )
    : null;
  const dims = vehicleDimensions(s.vehicleId);
  const tune = dyn
    ? {
        ...drivingTuning,
        ...dyn,
        boostAcceleration: dyn.engineAcceleration,
        boostTopSpeed: dyn.topSpeed,
      }
    : drivingTuning;
  const previous = { x: s.x, z: s.z },
    previousHeading = s.heading;
  s.collision = false;
  s.collisionImpulse = 0;
  s.impactYaw *= Math.exp(-dt * 5);
  if (!s.finished) s.lapTime += dt;
  const throttle = s.finished && !freeDrive ? 0 : clamp(input.throttle, 0, 1),
    brake = s.finished && !freeDrive ? 1 : clamp(input.brake, 0, 1),
    handbrake = !!input.handbrake;
  s.driveThrottle += (throttle - s.driveThrottle) * (1 - Math.exp(-dt * tune.throttleResponse));
  s.brakePressure += (brake - s.brakePressure) * (1 - Math.exp(-dt * tune.brakeResponse));
  s.steering +=
    (clamp(input.steer, -1, 1) - s.steering) * (1 - Math.exp(-dt * tune.steeringResponse));
  const boost = !!input.nitro && s.nitro > 0 && s.driveThrottle > 0.2 && s.speed > 1;
  s.nitro = clamp(s.nitro + (boost ? -27 : 8) * dt, 0, dyn?.nitroCapacity ?? 100);
  if (s.speed < 0.3 && brake > 0.6 && throttle < 0.05) s.reverseTimer += dt;
  else if (s.speed >= 0.3 || throttle > 0.1 || brake < 0.1) s.reverseTimer = 0;
  const reverse = s.reverseTimer > 0.4 && brake > 0.1 && throttle < 0.05;
  let force = 0;
  if (reverse) force = -brake * 5;
  else if (s.speed < -0.1 && throttle > 0.1) force = throttle * tune.braking;
  else
    force =
      s.driveThrottle * (boost ? tune.boostAcceleration : tune.engineAcceleration) -
      (s.speed > 0 ? s.brakePressure * tune.braking : 0);
  const resistance =
    (dyn?.resistance ?? 0.8 + 0.0055 * s.speed * s.speed) * (s.speed < 0 ? -1 : 1) +
    (handbrake ? tune.handbrake * Math.sign(s.speed) : 0);
  const oldSpeed = s.speed;
  const next = s.speed + (force - resistance - 9.81 * grade) * dt;
  s.speed = clamp(
    !reverse && s.speed >= 0 ? Math.max(0, next) : reverse ? Math.min(0, next) : next,
    -9,
    boost ? tune.boostTopSpeed : tune.topSpeed,
  );
  if (!reverse && s.driveThrottle < 0.01 && s.speed < 0.04 && s.speed > -0.04) s.speed = 0;
  const yaw = clamp(
    (s.speed / tune.wheelbase) *
      Math.tan(s.steering * steeringAngle(s.speed, dyn?.steeringLimit)) *
      (handbrake ? 1.22 : 1),
    -1.35,
    1.35,
  );
  s.heading += (s.impactYaw - yaw) * dt;
  const grip =
    1 -
    Math.exp(
      -dt * (handbrake ? 3.2 : Math.max(7, 14 - Math.abs(s.speed) * 0.1)) * (dyn?.grip ?? 1),
    );
  s.vx += (Math.sin(s.heading) * s.speed - s.vx) * grip;
  s.vz += (Math.cos(s.heading) * s.speed - s.vz) * grip;
  const intendedX = s.x + s.vx * dt,
    intendedZ = s.z + s.vz * dt;
  if (dyn) {
    s.mass = dyn.mass;
    s.yawInertia = dyn.yawInertia;
  }
  const fraction = sweepBody(
    previous.x,
    previous.z,
    previousHeading,
    intendedX,
    intendedZ,
    s.heading,
    clearance,
  );
  const desiredHeading = s.heading;
  s.x = previous.x + (intendedX - previous.x) * fraction;
  s.z = previous.z + (intendedZ - previous.z) * fraction;
  s.heading = previousHeading + (desiredHeading - previousHeading) * fraction;
  if (fraction < 1) {
    const dx = clearance(s.x + 0.04, s.z, s.heading) - clearance(s.x - 0.04, s.z, s.heading),
      dz = clearance(s.x, s.z + 0.04, s.heading) - clearance(s.x, s.z - 0.04, s.heading),
      len = Math.hypot(dx, dz) || 1,
      nx = dx / len,
      nz = dz / len;
    const forwardX = Math.sin(s.heading),
      forwardZ = Math.cos(s.heading),
      end = forwardX * nx + forwardZ * nz < 0 ? dims.halfSpine : -dims.halfSpine;
    const rx = forwardX * end - nx * dims.radius,
      rz = forwardZ * end - nz * dims.radius;
    s.collisionImpulse = applyContactImpulse(s, nx, nz, rx, rz);
    s.collision = s.collisionImpulse > 25;
    s.speed = clamp(s.vx * forwardX + s.vz * forwardZ, -9, tune.boostTopSpeed);
    // Use remaining time for a second, swept tangential slide. No coordinate snap.
    const tx = s.x + s.vx * dt * (1 - fraction),
      tz = s.z + s.vz * dt * (1 - fraction);
    const slide = sweepBody(s.x, s.z, s.heading, tx, tz, s.heading, clearance);
    s.x += (tx - s.x) * slide;
    s.z += (tz - s.z) * slide;
  }
  if (dyn) {
    const acceleration = (s.speed - oldSpeed) / Math.max(dt, 0.001),
      response = 1 - Math.exp((-dt * dyn.suspension.damping) / dyn.mass);
    const pitch = Math.max(
      -0.08,
      Math.min(
        0.08,
        (-acceleration * dyn.centerOfMass.y * dyn.mass) /
          (dyn.suspension.springRate * dyn.wheelbase),
      ),
    );
    const roll = Math.max(
      -dyn.suspension.travel,
      Math.min(
        dyn.suspension.travel,
        (s.steering * s.speed * s.speed * dyn.centerOfMass.y * dyn.mass) /
          (dyn.suspension.springRate * dyn.wheelbase * 5),
      ),
    );
    s.bodyPitch = (s.bodyPitch ?? 0) + (pitch - (s.bodyPitch ?? 0)) * response;
    s.bodyRoll = (s.bodyRoll ?? 0) + (roll - (s.bodyRoll ?? 0)) * response;
  }
  return previous;
}
