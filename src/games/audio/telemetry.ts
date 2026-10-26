import type { RaceInput, RaceState } from '../racing-physics';
import type { EngineAudioProfile } from './config';
export const clampAudio = (v: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
export interface EngineSoundState {
  rpm: number;
  gear: number;
  load: number;
  slip: number;
  rolling: number;
  limiter: boolean;
  shift: boolean;
}
// A wheel-linked automatic transmission model. Its ratios are shared with the
// vehicle configuration; no timer or prerecorded acceleration drives the sound.
export class EngineSoundTelemetry {
  gear = 1;
  rpm: number;
  private sinceShift = 1;
  constructor(public profile: EngineAudioProfile) {
    this.rpm = profile.idleRPM;
  }
  update(
    state: Pick<RaceState, 'speed' | 'vx' | 'vz' | 'heading'>,
    input: RaceInput,
    dt: number,
  ): EngineSoundState {
    const p = this.profile,
      speed = Math.abs(state.speed);
    dt = clampAudio(dt, 0, 0.1);
    this.sinceShift += dt;
    const wheelRPM = (speed / (2 * Math.PI * p.wheelRadius)) * 60;
    let coupled = wheelRPM * p.gearRatios[this.gear - 1] * p.finalDrive;
    let shift = false;
    if (this.sinceShift > 0.38 && state.speed >= 0) {
      if (coupled > p.maxRPM * 0.89 && this.gear < p.gearRatios.length) {
        this.gear++;
        shift = true;
      } else if (coupled < p.maxRPM * 0.32 && this.gear > 1) {
        this.gear--;
        shift = true;
      }
    }
    if (shift) {
      this.sinceShift = 0;
      coupled = wheelRPM * p.gearRatios[this.gear - 1] * p.finalDrive;
    }
    const throttle = clampAudio(input.throttle);
    const target = clampAudio(
      Math.max(p.idleRPM, coupled, speed < 3 ? p.idleRPM + throttle * 2600 : p.idleRPM),
      p.idleRPM,
      p.maxRPM * 1.02,
    );
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt * (shift ? 24 : 12)));
    const lateral = Math.abs(
      state.vx * Math.cos(state.heading) - state.vz * Math.sin(state.heading),
    );
    const slip = speed < 3 ? 0 : clampAudio((lateral / Math.max(4, speed) - 0.1) / 0.38);
    return {
      rpm: this.rpm,
      gear: state.speed < -0.2 ? -1 : this.gear,
      load: throttle * (this.sinceShift < 0.11 ? 0.22 : 1),
      slip: Math.max(slip, input.handbrake && speed > 6 ? 0.65 : 0),
      rolling: clampAudio(speed / 55),
      limiter: target >= p.maxRPM * 0.99,
      shift,
    };
  }
}
export function engineLayerWeights(rpm: number, idle: number, max: number) {
  const t = clampAudio((rpm - idle) / (max - idle)) * 3;
  const values = [0, 1, 2, 3].map((i) => Math.max(0, 1 - Math.abs(t - i)));
  const norm = Math.sqrt(values.reduce((n, v) => n + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}
