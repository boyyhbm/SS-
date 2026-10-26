import { z } from 'zod';
import models from '../../../public/game-assets/vehicle-manifest.json' with { type: 'json' };
import type { EngineAudioProfile } from '../audio/config';
export const VEHICLE_VERSION = 1;
export const VEHICLE_IDS = [
  'meridian-r6',
  'pocket-gt',
  'iron-v8',
  'vector-rs',
  'apex-r',
  'nova-x',
] as const;
export type VehicleId = (typeof VEHICLE_IDS)[number];
export const vehicleIdSchema = z.enum(VEHICLE_IDS);
export const DEFAULT_VEHICLE: VehicleId = 'meridian-r6';
export interface VehicleConfig {
  vehicleId: VehicleId;
  vehicleVersion: number;
  displayName: string;
  vehicleClass:
    'street-coupe' | 'hot-hatch' | 'muscle' | 'awd-performance' | 'track-supercar' | 'hypercar';
  description: { ru: string; en: string };
  modelAsset: string;
  audioProfile: EngineAudioProfile;
  mass: number;
  centerOfMass: { x: number; y: number; z: number };
  wheelbase: number;
  length: number;
  width: number;
  drivetrain: 'RWD' | 'FWD' | 'AWD';
  power: number;
  torqueCurve: readonly { rpm: number; nm: number }[];
  gearRatios: readonly number[];
  finalDrive: number;
  maxRPM: number;
  idleRPM: number;
  wheelRadius: number;
  tireGrip: number;
  brakeForce: number;
  steeringResponse: number;
  steeringLimit: number;
  dragCoefficient: number;
  nitroCapacity: number;
  suspensionSettings: { springRate: number; damping: number; travel: number };
}
function vehicle(
  id: VehicleId,
  name: string,
  type: VehicleConfig['vehicleClass'],
  model: string,
  mass: number,
  power: number,
  torque: number,
  drivetrain: VehicleConfig['drivetrain'],
  wheelbase: number,
  grip: number,
  brake: number,
  steering: number,
  cylinders: number,
  maxRPM: number,
  description: VehicleConfig['description'],
): VehicleConfig {
  const ratios =
    type === 'hypercar'
      ? [3.2, 2.25, 1.7, 1.35, 1.08, 0.88, 0.72]
      : type === 'hot-hatch'
        ? [3.4, 2.1, 1.5, 1.16, 0.91, 0.76]
        : [3.25, 2.1, 1.55, 1.2, 0.94, 0.76];
  const finalDrive = type === 'muscle' ? 3.15 : type === 'hypercar' ? 3.2 : 3.65,
    idleRPM = type === 'muscle' ? 750 : 850;
  return {
    vehicleId: id,
    vehicleVersion: VEHICLE_VERSION,
    displayName: name,
    vehicleClass: type,
    modelAsset: model,
    description,
    mass,
    power,
    centerOfMass: {
      x: 0,
      y: type === 'hot-hatch' ? 0.54 : type === 'muscle' ? 0.51 : 0.4,
      z: drivetrain === 'FWD' ? 0.12 : -0.08,
    },
    wheelbase,
    length: type === 'hot-hatch' ? 4.05 : type === 'muscle' ? 4.9 : 4.5,
    width: type === 'hot-hatch' ? 1.82 : 2.02,
    drivetrain,
    gearRatios: ratios,
    finalDrive,
    maxRPM,
    idleRPM,
    wheelRadius: 0.34,
    torqueCurve: [
      { rpm: idleRPM, nm: torque * 0.6 },
      { rpm: 2200, nm: torque * 0.88 },
      { rpm: 3800, nm: torque },
      { rpm: maxRPM * 0.8, nm: torque * 0.9 },
      { rpm: maxRPM, nm: torque * 0.73 },
    ],
    tireGrip: grip,
    brakeForce: brake,
    steeringResponse: steering,
    steeringLimit: type === 'hot-hatch' ? 0.57 : 0.52,
    dragCoefficient: type === 'muscle' ? 0.43 : type === 'hypercar' ? 0.31 : 0.35,
    nitroCapacity: type === 'hypercar' ? 85 : type === 'hot-hatch' ? 110 : 100,
    suspensionSettings: {
      springRate: type === 'track-supercar' ? 85000 : type === 'muscle' ? 48000 : 65000,
      damping: type === 'muscle' ? 6200 : 8500,
      travel: type === 'hot-hatch' ? 0.16 : 0.12,
    },
    audioProfile: {
      id: id + '-engine',
      cylinders,
      idleRPM,
      maxRPM,
      gearRatios: ratios,
      finalDrive,
      wheelRadius: 0.34,
      exhaust: type === 'muscle' ? 1 : 0.65,
      mechanical: type === 'track-supercar' ? 0.7 : 0.4,
      turbo: drivetrain === 'AWD' ? 0.7 : 0.2,
    },
  };
}
export const vehicles: readonly VehicleConfig[] = [
  vehicle(
    'meridian-r6',
    'Meridian R6',
    'street-coupe',
    'concept',
    1350,
    210,
    330,
    'RWD',
    2.7,
    1.06,
    24500,
    7.5,
    6,
    7600,
    {
      ru: 'Лёгкое купе с ровной тягой и понятной реакцией на руль.',
      en: 'Light coupe with progressive power and predictable steering.',
    },
  ),
  vehicle(
    'pocket-gt',
    'Pocket GT',
    'hot-hatch',
    models.models['hatchback-sports'].path,
    1120,
    165,
    270,
    'FWD',
    2.45,
    1.02,
    21200,
    10,
    4,
    7000,
    {
      ru: 'Компактный переднеприводный хэтчбек для узких связок поворотов.',
      en: 'Compact front-drive hatch for tight technical sections.',
    },
  ),
  vehicle(
    'iron-v8',
    'Iron V8',
    'muscle',
    models.models.sedan.path,
    1810,
    340,
    620,
    'RWD',
    2.98,
    0.94,
    25700,
    5.8,
    8,
    6500,
    {
      ru: 'Тяжёлый мускул-седан: глубокий V8, сильная тяга и длиннее тормозной путь.',
      en: 'Heavy muscle saloon with a deep V8, strong torque and longer stopping distance.',
    },
  ),
  vehicle(
    'vector-rs',
    'Vector RS',
    'awd-performance',
    models.models['sedan-sports'].path,
    1530,
    295,
    480,
    'AWD',
    2.75,
    1.16,
    29200,
    8.3,
    4,
    7400,
    {
      ru: 'Полный привод и стабильное сцепление на выходе из поворотов.',
      en: 'All-wheel drive and stable corner-exit traction.',
    },
  ),
  vehicle(
    'apex-r',
    'Apex R',
    'track-supercar',
    models.models.race.path,
    1260,
    380,
    490,
    'RWD',
    2.65,
    1.28,
    31500,
    10.3,
    10,
    8800,
    {
      ru: 'Точное трековое шасси с цепкими шинами и мощными тормозами.',
      en: 'Precise track chassis with high grip and powerful brakes.',
    },
  ),
  vehicle(
    'nova-x',
    'Nova X',
    'hypercar',
    models.models['race-future'].path,
    1690,
    650,
    870,
    'AWD',
    2.9,
    1.12,
    32900,
    7.1,
    12,
    8400,
    {
      ru: 'Экстремальная мощность для скоростных участков; масса требует раннего торможения.',
      en: 'Extreme power for fast sections; its mass demands earlier braking.',
    },
  ),
];
export function getVehicle(id: VehicleId): VehicleConfig {
  const v = vehicles.find((v) => v.vehicleId === id);
  if (!v) throw Error('vehicleMismatch');
  return v;
}
const legacyDimensions = { radius: 1.05, halfSpine: 1.25 };
const dimensions = new Map(
  vehicles.map((v) => [v.vehicleId, { radius: v.width / 2, halfSpine: (v.length - v.width) / 2 }]),
);
export function vehicleDimensions(id?: VehicleId) {
  return id ? dimensions.get(id)! : legacyDimensions;
}
