import type { RaceState } from '../racing-physics';
import { getVehicle, type VehicleId } from './config';
export function configureVehicle<T extends RaceState>(state: T, vehicleId: VehicleId): T {
  const v = getVehicle(vehicleId);
  return Object.assign(state, {
    finished: false,
    driveThrottle: 0,
    brakePressure: 0,
    reverseTimer: 0,
    impactYaw: 0,
    collisionImpulse: 0,
    vehicleId,
    vehicleVersion: v.vehicleVersion,
    gear: 1,
    rpm: v.idleRPM,
    shiftTime: 1,
    wheelSlip: 0,
    nitro: v.nitroCapacity,
    mass: v.mass,
    yawInertia: (v.mass * (v.wheelbase * v.wheelbase + v.width * v.width)) / 12,
    bodyPitch: 0,
    bodyRoll: 0,
  });
}
