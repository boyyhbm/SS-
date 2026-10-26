import type { RaceInput, RaceState } from '../racing-physics';
import {
  conceptAudioProfile,
  defaultAudioSettings,
  type AudioSettings,
  type AudioEnvironment,
  type EngineAudioProfile,
} from './config';
import { clampAudio, engineLayerWeights, EngineSoundTelemetry } from './telemetry';
import { getVehicle } from '../vehicles/config';
import { fillSoundscape } from './soundscape';

export type GameAudioStatus = 'locked' | 'running' | 'suspended' | 'unavailable';
type SoundPose = RaceState & { collisionImpulse?: number };
type Loop = { source: AudioBufferSourceNode; gain: GainNode; anchor: number };
type Voice = {
  loops: Loop[];
  output: GainNode;
  filter: BiquadFilterNode;
  panner?: PannerNode;
  telemetry: EngineSoundTelemetry;
  profile: EngineAudioProfile;
  position: { x: number; z: number };
  gear: number;
  rpm: number;
};
const zero: RaceInput = { throttle: 0, brake: 0, steer: 0, nitro: false };
// The first digital capture measured -29.5 LUFS for normal solo driving.
// +7.2 dB makes the default mix audible while the existing compressor retains headroom.
const masterGain = 1.6;
const bufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
const active = new Set<GameAudioEngine>();

function target(param: AudioParam, value: number, ctx: BaseAudioContext, smoothing = 0.04) {
  param.setTargetAtTime(value, ctx.currentTime, smoothing);
}
function buffer(
  ctx: BaseAudioContext,
  key: string,
  make: (out: Float32Array, rate: number) => void,
  seconds = 1,
) {
  let cache = bufferCache.get(ctx);
  if (!cache) {
    cache = new Map();
    bufferCache.set(ctx, cache);
  }
  let found = cache.get(key);
  if (!found) {
    found = ctx.createBuffer(1, Math.round(22050 * seconds), 22050);
    make(found.getChannelData(0), 22050);
    cache.set(key, found);
  }
  return found;
}
function noise(ctx: BaseAudioContext) {
  return buffer(
    ctx,
    'original-periodic-noise',
    (out) => {
      let seed = 3917;
      for (let i = 0; i < out.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        out[i] = ((seed / 0xffffffff) * 2 - 1) * 0.7;
      }
    },
    2,
  );
}
function combustion(ctx: BaseAudioContext, p: EngineAudioProfile, rpm: number, loaded: boolean) {
  return buffer(ctx, `${p.id}:${rpm}:${loaded}`, (out, rate) => {
    // Original periodic combustion/exhaust waveform. These are authored DSP
    // samples, not recordings or extracted commercial-game sound effects.
    const cycles = Math.round(rpm / 60) * (p.cylinders / 2),
      len = out.length;
    let seed = 51 + p.cylinders;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const phase = (i / len) * Math.PI * 2 * cycles;
      const pulse =
        Math.sin(phase) +
        0.4 * Math.sin(phase * 2 + 0.2) +
        (loaded ? 0.32 : 0.13) * Math.sin(phase * 3 + 0.7);
      const exhaust =
        Math.sin(phase / (p.cylinders / 2)) * 0.12 * p.exhaust +
        Math.sin(phase * 5) * p.mechanical * 0.035;
      const combustionNoise = ((seed / 0xffffffff) * 2 - 1) * (loaded ? 0.08 : 0.025);
      out[i] =
        (pulse * 0.32 + exhaust + combustionNoise) *
        (0.93 + 0.07 * Math.sin((i / rate) * Math.PI * 2 * 5));
    }
  });
}

/** Owns sound only: consumes actual simulation state and never modifies physics. */
export class GameAudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private channels?: Record<'engine' | 'tires' | 'environment' | 'effects' | 'music', GainNode>;
  private compressor?: DynamicsCompressorNode;
  private analyser?: AnalyserNode;
  private meter = new Float32Array(1024);
  private voices = new Map<string, Voice>();
  private rolling?: Loop;
  private squeal?: Loop;
  private wind?: Loop;
  private ambient?: Loop;
  private music?: Loop;
  private transient = new Set<AudioBufferSourceNode>();
  private listener = { x: 0, z: 0 };
  private cameraMode = 0;
  private environment: AudioEnvironment = 'city';
  private paused = true;
  private destroyed = false;
  private settings: AudioSettings = { ...defaultAudioSettings };
  private profile = conceptAudioProfile;
  private lastImpact = -10;
  private lastContact = -10;
  private wasContact = false;
  private diagnostics = { shifts: 0, impacts: 0, updates: 0, slip: 0 };
  status: GameAudioStatus = 'locked';
  constructor(private onStatus: (status: GameAudioStatus) => void = () => {}) {
    active.add(this);
  }
  private setStatus(status: GameAudioStatus) {
    if (this.status !== status) {
      this.status = status;
      this.onStatus(status);
    }
  }
  async resume() {
    if (this.destroyed) return;
    try {
      if (!this.ctx) this.build();
      if (!this.ctx) return;
      await this.ctx.resume();
      if (!this.destroyed) this.setStatus(this.ctx.state === 'running' ? 'running' : 'suspended');
    } catch {
      if (!this.destroyed) this.setStatus(this.ctx ? 'suspended' : 'unavailable');
    }
  }
  private build() {
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 15;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.16;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.channels = Object.fromEntries(
      ['engine', 'tires', 'environment', 'effects', 'music'].map((name) => {
        const gain = ctx.createGain();
        gain.connect(this.master!);
        return [name, gain];
      }),
    ) as NonNullable<GameAudioEngine['channels']>;
    const filteredNoise = (channel: GainNode, hz: number, type: BiquadFilterType) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = hz;
      filter.Q.value = 0.6;
      filter.connect(channel);
      return this.loop(noise(ctx), filter);
    };
    this.rolling = filteredNoise(this.channels.tires, 550, 'lowpass');
    this.squeal = filteredNoise(this.channels.tires, 2200, 'bandpass');
    this.wind = filteredNoise(this.channels.environment, 900, 'lowpass');
    this.ambient = this.loop(
      buffer(
        ctx,
        'soundscape:' + this.environment,
        (out, rate) => fillSoundscape(out, rate, this.environment),
        18,
      ),
      this.channels.environment,
    );
    this.music = this.loop(
      buffer(
        ctx,
        'original-night-score',
        (out, rate) => {
          const chords = [
            [55, 82.4069, 130.8128],
            [43.6535, 65.4064, 110],
          ];
          for (let i = 0; i < out.length; i++) {
            const t = i / rate,
              bar = Math.floor(t / 8),
              fade = Math.sin((Math.PI * (t % 8)) / 8) ** 2;
            out[i] =
              chords[bar % 2].reduce((v, f) => v + Math.sin(2 * Math.PI * f * t), 0) * 0.065 * fade;
          }
        },
        16,
      ),
      this.channels.music,
    );
    this.music.gain.gain.value = 0.55;
    ctx.onstatechange = () => {
      if (!this.destroyed) this.setStatus(ctx.state === 'running' ? 'running' : 'suspended');
    };
    this.voice('local', this.profile, false);
    this.setSettings(this.settings);
    this.setPaused(this.paused);
  }
  private loop(data: AudioBuffer, destination: AudioNode, anchor = 1): Loop {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = data;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(destination);
    source.start();
    return { source, gain, anchor };
  }
  private voice(id: string, profile: EngineAudioProfile, spatial: boolean): Voice {
    const previous = this.voices.get(id);
    if (previous?.profile.id === profile.id) return previous;
    if (previous) this.removeVoice(id);
    const ctx = this.ctx!,
      output = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5000;
    filter.Q.value = 0.5;
    output.gain.value = 0;
    filter.connect(output);
    let panner: PannerNode | undefined;
    if (spatial) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 5;
      panner.maxDistance = 180;
      panner.rolloffFactor = 1.5;
      output.connect(panner);
      panner.connect(this.channels!.engine);
    } else output.connect(this.channels!.engine);
    const anchors = [
      profile.idleRPM,
      profile.maxRPM * 0.35,
      profile.maxRPM * 0.64,
      profile.maxRPM * 0.91,
    ];
    const loops = anchors.map((rpm) =>
      this.loop(combustion(ctx, profile, rpm, false), filter, rpm),
    );
    loops.push(this.loop(combustion(ctx, profile, anchors[2], true), filter, anchors[2]));
    loops.push(this.loop(combustion(ctx, profile, anchors[1], false), filter, anchors[1]));
    const voice = {
      loops,
      output,
      filter,
      panner,
      profile,
      telemetry: new EngineSoundTelemetry(profile),
      position: { x: 0, z: 0 },
      gear: 1,
      rpm: profile.idleRPM,
    };
    this.voices.set(id, voice);
    return voice;
  }
  setProfile(profile: EngineAudioProfile) {
    this.profile = profile;
    if (this.ctx) this.voice('local', profile, false);
  }
  setSettings(settings: AudioSettings) {
    this.settings = { ...settings };
    if (!this.ctx || !this.channels) return;
    for (const name of ['engine', 'tires', 'environment', 'effects', 'music'] as const)
      target(this.channels[name].gain, clampAudio(settings[name]), this.ctx);
    this.setPaused(this.paused);
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    if (this.ctx && this.master)
      target(
        this.master.gain,
        paused || this.settings.muted ? 0 : clampAudio(this.settings.master) * masterGain,
        this.ctx,
        0.035,
      );
  }
  setEnvironment(environment: AudioEnvironment) {
    if (this.environment === environment) return;
    this.environment = environment;
    if (this.ctx && this.channels) {
      const previous = this.ambient;
      if (previous) {
        target(previous.gain.gain, 0, this.ctx, 0.1);
        previous.source.stop(this.ctx.currentTime + 0.7);
        previous.source.onended = () => {
          previous.source.disconnect();
          previous.gain.disconnect();
        };
      }
      this.ambient = this.loop(
        buffer(
          this.ctx,
          'soundscape:' + environment,
          (out, rate) => fillSoundscape(out, rate, environment),
          18,
        ),
        this.channels.environment,
      );
    }
  }
  setListener(x: number, y: number, z: number, heading: number, cameraMode: number) {
    this.listener.x = x;
    this.listener.z = z;
    this.cameraMode = cameraMode;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    target(l.positionX, x, ctx);
    target(l.positionY, y, ctx);
    target(l.positionZ, z, ctx);
    target(l.forwardX, Math.sin(heading), ctx);
    target(l.forwardY, 0, ctx);
    target(l.forwardZ, Math.cos(heading), ctx);
    target(l.upY, 1, ctx);
  }
  private updateVoice(
    voice: Voice,
    state: SoundPose,
    input: RaceInput,
    dt: number,
    remote: boolean,
  ) {
    const ctx = this.ctx!,
      sound = voice.telemetry.update(state, input, dt);
    const weights = engineLayerWeights(sound.rpm, voice.profile.idleRPM, voice.profile.maxRPM);
    const interior = !remote && this.cameraMode === 2;
    target(voice.filter.frequency, interior ? 1600 : 2500 + sound.load * 3300, ctx);
    const limiter = sound.limiter
      ? Math.sin(ctx.currentTime * 2 * Math.PI * 24) > 0
        ? 0.6
        : 1
      : 1;
    target(voice.output.gain, (remote ? 0.2 : 0.42) * limiter, ctx);
    let doppler = 1;
    if (remote) {
      const dx = state.x - this.listener.x,
        dz = state.z - this.listener.z,
        distance = Math.hypot(dx, dz) || 1;
      doppler = clampAudio(343 / (343 + (state.vx * dx + state.vz * dz) / distance), 0.92, 1.08);
      const p = voice.panner!;
      target(p.positionX, state.x, ctx);
      target(p.positionY, (state.y ?? 0) + 0.8, ctx);
      target(p.positionZ, state.z, ctx);
    }
    voice.loops.forEach((loop, i) => {
      target(
        loop.source.playbackRate,
        clampAudio((sound.rpm / loop.anchor) * doppler, 0.45, 2.3),
        ctx,
        0.025,
      );
      const level =
        i < 4
          ? weights[i] * (0.34 + sound.load * 0.23)
          : i === 4
            ? sound.load *
              (0.28 + ((voice.profile.turbo * sound.rpm) / voice.profile.maxRPM) * 0.12)
            : (1 - sound.load) * (sound.rpm / voice.profile.maxRPM) * 0.18;
      target(loop.gain.gain, level, ctx, 0.025);
    });
    voice.gear = sound.gear;
    voice.rpm = sound.rpm;
    if (sound.shift && !remote) {
      this.diagnostics.shifts++;
      this.effect(0.12, 'shift');
    }
    return sound;
  }
  update(state: SoundPose, input: RaceInput, dt: number) {
    if (!this.ctx || this.destroyed) return;
    this.diagnostics.updates++;
    const sound = this.updateVoice(
        this.voice('local', this.profile, false),
        state,
        input,
        dt,
        false,
      ),
      ctx = this.ctx;
    this.diagnostics.slip = sound.slip;
    target(this.rolling!.gain.gain, sound.rolling * 0.1, ctx);
    target(this.squeal!.gain.gain, sound.slip * 0.22, ctx);
    target(this.wind!.gain.gain, sound.rolling ** 2 * (this.cameraMode === 2 ? 0.025 : 0.12), ctx);
    target(
      this.ambient!.gain.gain,
      this.environment === 'industrial' ? 0.1 : this.environment === 'city' ? 0.055 : 0.025,
      ctx,
    );
    const contact = state.collision || (state.collisionImpulse ?? 0) > 50;
    if (
      contact &&
      !this.wasContact &&
      ctx.currentTime - this.lastContact > 0.25 &&
      ctx.currentTime - this.lastImpact > 0.3
    ) {
      this.lastImpact = ctx.currentTime;
      this.diagnostics.impacts++;
      this.effect(
        clampAudio((state.collisionImpulse ?? Math.abs(state.speed) * 120) / 6500, 0.06, 0.7),
        'impact',
      );
    }
    if (contact) this.lastContact = ctx.currentTime;
    this.wasContact = contact;
  }
  updateOpponents(
    peers: { id: string; state: RaceState; audioProfile?: EngineAudioProfile }[],
    dt: number,
  ) {
    if (!this.ctx || this.destroyed) return;
    const present = new Set(peers.slice(0, 5).map((p) => p.id));
    for (const id of this.voices.keys())
      if (id !== 'local' && !present.has(id)) this.removeVoice(id);
    for (const peer of peers.slice(0, 5))
      this.updateVoice(
        this.voice(
          peer.id,
          peer.audioProfile ??
            (peer.state.vehicleId ? getVehicle(peer.state.vehicleId).audioProfile : this.profile),
          true,
        ),
        peer.state,
        { ...zero, throttle: Math.abs(peer.state.speed) > 1 ? 0.6 : 0 },
        dt,
        true,
      );
  }
  private effect(level: number, kind: 'impact' | 'shift') {
    if (!this.ctx || this.transient.size >= 6) return;
    const ctx = this.ctx,
      source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    source.buffer = noise(ctx);
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'shift' ? 1300 : 500;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.channels!.effects);
    const duration = kind === 'shift' ? 0.055 : 0.28;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    this.transient.add(source);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.transient.delete(source);
    };
    source.start();
    source.stop(ctx.currentTime + duration + 0.01);
  }
  inspect() {
    this.analyser?.getFloatTimeDomainData(this.meter);
    let peak = 0,
      energy = 0;
    for (const v of this.meter) {
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    return {
      status: this.status,
      voices: this.voices.size,
      transient: this.transient.size,
      rpm: this.voices.get('local')?.rpm ?? 0,
      gear: this.voices.get('local')?.gear ?? 0,
      peak,
      rms: Math.sqrt(energy / this.meter.length),
      ...this.diagnostics,
    };
  }
  connectCapture(destination: AudioNode) {
    this.master?.connect(destination);
  }
  get context() {
    return this.ctx;
  }
  private removeVoice(id: string) {
    const v = this.voices.get(id);
    if (!v) return;
    for (const l of v.loops) {
      l.source.stop();
      l.source.disconnect();
      l.gain.disconnect();
    }
    v.filter.disconnect();
    v.output.disconnect();
    v.panner?.disconnect();
    this.voices.delete(id);
  }
  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    active.delete(this);
    for (const id of this.voices.keys()) this.removeVoice(id);
    for (const loop of [this.rolling, this.squeal, this.wind, this.ambient, this.music]) {
      loop?.source.stop();
      loop?.source.disconnect();
      loop?.gain.disconnect();
    }
    for (const source of this.transient) source.stop();
    this.transient.clear();
    Object.values(this.channels ?? {}).forEach((c) => c.disconnect());
    this.master?.disconnect();
    this.compressor?.disconnect();
    this.analyser?.disconnect();
    if (this.ctx) {
      this.ctx.onstatechange = null;
      void this.ctx.close();
    }
  }
}
export function resumeGameAudio() {
  for (const engine of active) void engine.resume();
}
export function inspectGameAudio() {
  return [...active].map((engine) => engine.inspect());
}
