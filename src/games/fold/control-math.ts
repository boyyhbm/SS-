import type { ForgeSettings } from './settings';
export function mouseRadians(
  delta: number,
  axis: 'x' | 'y',
  settings: ForgeSettings['mouse'],
  aiming: boolean,
) {
  return (
    delta *
    0.002 *
    settings.sensitivity *
    settings[axis] *
    (aiming ? settings.ads : 1) *
    (axis === 'y' && settings.invertY ? -1 : 1)
  );
}
export function stickResponse(
  value: number,
  curve: ForgeSettings['controller']['curve'],
  exponent = 1.5,
) {
  const n = Math.max(-1, Math.min(1, value));
  return curve === 'linear'
    ? n
    : curve === 'dynamic'
      ? n * (0.4 + 0.6 * n * n)
      : Math.sign(n) * Math.abs(n) ** exponent;
}
