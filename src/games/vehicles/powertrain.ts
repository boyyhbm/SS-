import { getVehicle, type VehicleId } from './config';
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export interface PowertrainState {
  speed: number;
  vehicleId?: VehicleId;
  gear?: number;
  rpm?: number;
  shiftTime?: number;
  driveThrottle: number;
  steering: number;
  wheelSlip?: number;
}
export function torqueAt(rpm: number, curve: readonly { rpm: number; nm: number }[]) {
  if (rpm <= curve[0].rpm) return curve[0].nm;
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i].rpm) {
      const a = curve[i - 1],
        b = curve[i];
      return a.nm + ((b.nm - a.nm) * (rpm - a.rpm)) / (b.rpm - a.rpm);
    }
  }
  return curve.at(-1)!.nm;
}
export function vehicleDynamics(s: PowertrainState, dt: number, boost: boolean, surfaceGrip = 1) {
  const v = getVehicle(s.vehicleId!),
    speed = Math.abs(s.speed),
    ratios = v.gearRatios;
  let gear = clamp(s.gear ?? 1, 1, ratios.length),
    timer = (s.shiftTime ?? 1) + dt;
  const wheelRPM = (speed / (Math.PI * 2 * v.wheelRadius)) * 60;
  let rpm = wheelRPM * ratios[gear - 1] * v.finalDrive;
  if (timer > 0.35) {
    if (rpm > v.maxRPM * 0.9 && gear < ratios.length) {
      gear++;
      timer = 0;
    } else if (rpm < v.maxRPM * 0.31 && gear > 1) {
      gear--;
      timer = 0;
    }
  }
  const coupled = wheelRPM * ratios[gear - 1] * v.finalDrive;
  rpm = clamp(
    Math.max(v.idleRPM, coupled, speed < 3 ? v.idleRPM + s.driveThrottle * 2000 : 0),
    v.idleRPM,
    v.maxRPM * 1.015,
  );
  s.gear = gear;
  s.rpm = rpm;
  s.shiftTime = timer;
  const torque = Math.min(
    torqueAt(rpm, v.torqueCurve),
    (v.power * 9550) / Math.max(v.idleRPM, rpm),
  );
  const traction =
    v.tireGrip *
    surfaceGrip *
    9.81 *
    (v.drivetrain === 'AWD' ? 1.05 : v.drivetrain === 'FWD' ? 0.87 : 0.95);
  const ratio = ratios[gear - 1] * v.finalDrive;
  const requested =
    ((torque * ratio * 0.9) / v.wheelRadius / v.mass) *
    (boost ? 1.32 : 1) *
    (timer < 0.1 ? 0.28 : 1);
  s.wheelSlip = clamp((requested * s.driveThrottle - traction) / Math.max(1, traction), 0, 1);
  const acceleration = Math.min(requested, traction / Math.max(0.25, s.driveThrottle));
  const drag = (0.5 * 1.225 * v.dragCoefficient * (v.width * 1.2) * speed * speed) / v.mass;
  const frontLoad =
    (v.drivetrain === 'FWD' ? 1 - 0.12 * s.driveThrottle : 1) *
    (1 + (v.centerOfMass.z / v.wheelbase) * 0.15);
  const transfer = 1 - clamp((v.centerOfMass.y * Math.abs(s.steering) * speed) / 180, 0, 0.15);
  return {
    wheelbase: v.wheelbase,
    steeringResponse: v.steeringResponse,
    steeringLimit: v.steeringLimit * frontLoad,
    engineAcceleration: acceleration,
    braking: (v.brakeForce / v.mass) * surfaceGrip,
    handbrake: (v.brakeForce / v.mass) * 0.65 * surfaceGrip,
    resistance: 0.12 + drag,
    topSpeed: (v.maxRPM / (ratios.at(-1)! * v.finalDrive) / 60) * Math.PI * 2 * v.wheelRadius,
    grip:
      transfer * v.tireGrip * surfaceGrip * (v.drivetrain === 'RWD' ? 1 - 0.16 * s.wheelSlip : 1),
    nitroCapacity: v.nitroCapacity,
    mass: v.mass,
    yawInertia:
      (v.mass * (v.wheelbase * v.wheelbase + v.width * v.width)) / 12 +
      v.mass * (v.centerOfMass.x ** 2 + v.centerOfMass.z ** 2),
    suspension: v.suspensionSettings,
    centerOfMass: v.centerOfMass,
  };
}
