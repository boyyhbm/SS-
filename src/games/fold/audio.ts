import type { ForgeSettings } from './settings';
import type { ForgeEvent } from './contracts';
import type { V3 } from './arena';
export class ForgeAudio {
  context: AudioContext | null = null;
  status: 'locked' | 'running' | 'unavailable' = 'locked';
  onStatus: (status: string) => void = () => {};
  private master: GainNode | null = null;
  private buses = new Map<string, GainNode>();
  private noise: AudioBuffer | null = null;
  private voices = new Set<AudioScheduledSourceNode>();
  private disposed = false;
  constructor(public settings: ForgeSettings) {}
  async activate() {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        const c = this.context;
        this.master = c.createGain();
        const compressor = c.createDynamicsCompressor();
        compressor.threshold.value = -15;
        compressor.ratio.value = 6;
        this.master.connect(compressor).connect(c.destination);
        for (const name of ['weapons', 'environment', 'effects']) {
          const bus = c.createGain();
          bus.connect(this.master);
          this.buses.set(name, bus);
        }
        this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
        let seed = 711;
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          data[i] = (seed / 2147483648 - 1) * 0.45;
        }
      }
      await this.context.resume();
      if (this.disposed) return;
      this.status = this.context.state === 'running' ? 'running' : 'locked';
      this.update(this.settings);
      this.onStatus(this.status);
    } catch {
      this.status = 'unavailable';
      this.onStatus(this.status);
    }
  }
  update(settings: ForgeSettings) {
    this.settings = settings;
    const c = this.context;
    if (!c || !this.master) return;
    this.master.gain.setTargetAtTime(settings.master, c.currentTime, 0.025);
    for (const [name, bus] of this.buses)
      bus.gain.setTargetAtTime(
        settings[name as 'weapons' | 'environment' | 'effects'],
        c.currentTime,
        0.025,
      );
  }
  listener(p: V3, yaw: number, pitch: number) {
    const c = this.context;
    if (!c) return;
    const l = c.listener;
    for (const [k, n] of Object.entries({
      positionX: p.x,
      positionY: p.y,
      positionZ: p.z,
      forwardX: -Math.sin(yaw) * Math.cos(pitch),
      forwardY: Math.sin(pitch),
      forwardZ: -Math.cos(yaw) * Math.cos(pitch),
      upX: 0,
      upY: 1,
      upZ: 0,
    }))
      l[k as 'positionX'].value = n;
  }
  play(type: ForgeEvent['type'] | 'step' | 'ui', position?: V3, occluded = false) {
    const c = this.context;
    if (!c || this.status !== 'running' || this.disposed) return;
    const shot = type === 'shot',
      fold = type === 'fold',
      duration = shot ? 0.17 : fold ? 0.9 : type === 'round' ? 0.5 : 0.12;
    const bus = this.buses.get(
      shot || type === 'reload' ? 'weapons' : type === 'step' ? 'environment' : 'effects',
    )!;
    const envelope = c.createGain();
    let output: AudioNode = bus;
    let panner: PannerNode | null = null;
    if (position) {
      panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.maxDistance = 45;
      panner.rolloffFactor = 1.3;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      panner.connect(bus);
      output = panner;
    }
    envelope.connect(output);
    const peak = (shot ? 0.42 : type === 'step' ? 0.12 : 0.2) * (occluded ? 0.22 : 1);
    envelope.gain.setValueAtTime(0.001, c.currentTime);
    envelope.gain.exponentialRampToValueAtTime(peak, c.currentTime + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    const osc = c.createOscillator();
    osc.type = fold ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(
      shot
        ? 170
        : fold
          ? 85
          : type === 'hit'
            ? 750
            : type === 'core'
              ? 520
              : type === 'round'
                ? 330
                : 110,
      c.currentTime,
    );
    osc.frequency.exponentialRampToValueAtTime(
      shot ? 48 : fold ? 190 : 70,
      c.currentTime + duration,
    );
    osc.connect(envelope);
    const noise = c.createBufferSource();
    noise.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = shot ? 2100 : fold ? 440 : type === 'step' ? 900 : 1600;
    filter.Q.value = 0.6;
    noise.connect(filter).connect(envelope);
    for (const source of [osc, noise]) {
      if (this.voices.size >= 24) {
        const oldest = this.voices.values().next().value;
        try {
          oldest?.stop();
        } catch {}
        if (oldest) this.voices.delete(oldest);
      }
      this.voices.add(source);
      source.onended = () => {
        this.voices.delete(source);
        source.disconnect();
        if (!this.voices.has(osc) && !this.voices.has(noise)) {
          filter.disconnect();
          envelope.disconnect();
          panner?.disconnect();
        }
      };
      source.start();
      source.stop(c.currentTime + duration + 0.02);
    }
  }
  dispose() {
    this.disposed = true;
    for (const source of this.voices)
      try {
        source.stop();
      } catch {}
    this.voices.clear();
    void this.context?.close();
    this.context = null;
    this.noise = null;
  }
}
