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
  private loops: AudioScheduledSourceNode[] = [];
  private loopNodes: AudioNode[] = [];
  private musicGate: GainNode | null = null;
  private inMenu = true;
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
        for (const name of ['weapons', 'environment', 'effects', 'footsteps', 'ui', 'music']) {
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
        this.startAmbience();
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
  private startAmbience() {
    const c = this.context!;
    // Original, bounded DSP layers. Menu music never obscures a live duel.
    this.musicGate = c.createGain();
    this.musicGate.gain.value = this.inMenu ? 1 : 0;
    this.musicGate.connect(this.buses.get('music')!);
    this.loopNodes.push(this.musicGate);
    for (const frequency of [146.83, 174.61, 220]) {
      const tone = c.createOscillator(),
        filter = c.createBiquadFilter(),
        gain = c.createGain();
      tone.type = 'triangle';
      tone.frequency.value = frequency;
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      gain.gain.value = 0.018;
      tone.connect(filter).connect(gain).connect(this.musicGate);
      tone.start();
      this.loops.push(tone);
      this.loopNodes.push(filter, gain);
    }
    const fan = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain();
    fan.buffer = this.noise;
    fan.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    gain.gain.value = 0.075;
    fan.connect(filter).connect(gain).connect(this.buses.get('environment')!);
    fan.start();
    this.loops.push(fan);
    this.loopNodes.push(filter, gain);
  }
  setMenu(menu: boolean) {
    if (menu === this.inMenu) return;
    this.inMenu = menu;
    if (this.context && this.musicGate)
      this.musicGate.gain.setTargetAtTime(menu ? 1 : 0, this.context.currentTime, 0.18);
  }
  update(settings: ForgeSettings) {
    this.settings = settings;
    const c = this.context,
      a = settings.audio;
    if (!c || !this.master) return;
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master, c.currentTime, 0.025);
    for (const [name, bus] of this.buses)
      bus.gain.setTargetAtTime(
        a[name as 'weapons' | 'environment' | 'effects' | 'footsteps' | 'ui' | 'music'],
        c.currentTime,
        0.025,
      );
  }
  listener(p: V3, yaw: number, pitch: number) {
    const c = this.context;
    if (!c) return;
    const l = c.listener;
    l.positionX.value = p.x;
    l.positionY.value = p.y;
    l.positionZ.value = p.z;
    l.forwardX.value = -Math.sin(yaw) * Math.cos(pitch);
    l.forwardY.value = Math.sin(pitch);
    l.forwardZ.value = -Math.cos(yaw) * Math.cos(pitch);
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }
  play(type: ForgeEvent['type'] | 'step' | 'ui', position?: V3, occluded = false) {
    const c = this.context;
    if (!c || this.status !== 'running' || this.disposed) return;
    const shot = type === 'shot',
      fold = type === 'fold',
      ui = type === 'ui';
    const duration = shot ? 0.17 : fold ? 0.9 : type === 'round' ? 0.5 : ui ? 0.06 : 0.12;
    const bus = this.buses.get(
      ui
        ? 'ui'
        : shot || type === 'reload'
          ? 'weapons'
          : ['step', 'land', 'jump', 'slide'].includes(type)
            ? 'footsteps'
            : 'effects',
    )!;
    const envelope = c.createGain();
    let output: AudioNode = bus,
      panner: PannerNode | null = null;
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
    const peak = (shot ? 0.42 : type === 'step' ? 0.12 : ui ? 0.055 : 0.2) * (occluded ? 0.22 : 1);
    envelope.gain.setValueAtTime(0.001, c.currentTime);
    envelope.gain.exponentialRampToValueAtTime(peak, c.currentTime + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    const osc = c.createOscillator();
    osc.type = fold ? 'sawtooth' : ui ? 'triangle' : 'sine';
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
                : ui
                  ? 680
                  : 110,
      c.currentTime,
    );
    osc.frequency.exponentialRampToValueAtTime(
      shot ? 48 : fold ? 190 : ui ? 500 : 70,
      c.currentTime + duration,
    );
    osc.connect(envelope);
    const noise = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      noiseGain = c.createGain();
    noise.buffer = this.noise;
    filter.type = 'bandpass';
    filter.frequency.value = shot ? 2100 : fold ? 440 : type === 'step' ? 900 : 1600;
    filter.Q.value = 0.6;
    noiseGain.gain.value = ui ? 0 : 1;
    noise.connect(filter).connect(noiseGain).connect(envelope);
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
          noiseGain.disconnect();
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
    for (const source of [...this.voices, ...this.loops])
      try {
        source.stop();
      } catch {}
    this.voices.clear();
    this.loops.length = 0;
    for (const node of this.loopNodes) node.disconnect();
    this.loopNodes.length = 0;
    void this.context?.close();
    this.context = null;
    this.noise = null;
  }
}
