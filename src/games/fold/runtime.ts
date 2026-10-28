import { ForgeRenderer } from './renderer';
import { ForgeInput } from './input';
import { ForgeAudio } from './audio';
import { ForgePrediction } from './prediction';
import { ForgePerformance } from './performance';
import { ForgeEffects } from './effects';
import type { ForgeNetworking } from './networking';
import type { ForgeSnapshot, ForgeState } from './contracts';
import type { ForgeSettings } from './settings';
import { balance, FOLD_DT } from './config';
import { ForgeUIBridge, type ForgeFrameStats } from './ui-bridge';
import { nexusInput } from '@/input/manager';
export type { ForgeFrameStats } from './ui-bridge';
// Owns the only visual transform writer and render RAF for this runtime. The
// root NEXUS input poll does not own any transforms or another simulation.
export class NexusForgeRuntime {
  renderer: ForgeRenderer;
  input: ForgeInput;
  audio: ForgeAudio;
  performance = new ForgePerformance();
  readonly ui = new ForgeUIBridge();
  prediction: ForgePrediction | null = null;
  private effects = new ForgeEffects();
  private disposed = false;
  private raf = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resizing: ResizeObserver;
  private snapshots: ForgeSnapshot[] = [];
  private latest: ForgeSnapshot | null = null;
  private receivedAt = 0;
  private visual: ForgeState | null = null;
  private lastRound = 0;
  private pendingPrediction = false;
  private lastFrame = 0;
  private lastStep = 0;
  private clock = 0;
  private accumulator = 0;
  private seq = 0;
  private lastEvent = 0;
  private shotAt = -1;
  private hitAt = -1;
  private stepAt = 0;
  private menu = true;
  private benchmarkFrames: number[] = [];
  private benchmarkDone = false;
  private lastHud = 0;
  private remoteSteps = new Map<string, number>();
  set onStats(value: (stats: ForgeFrameStats, hit: boolean) => void) {
    this.ui.onFrame = value;
  }
  onMenu: () => void = () => {};
  onError: (message: string) => void = () => {};
  constructor(
    host: HTMLElement,
    public network: ForgeNetworking,
    settings: ForgeSettings,
  ) {
    this.renderer = new ForgeRenderer(host, settings);
    this.renderer.scene.add(this.effects.root);
    this.input = new ForgeInput(this.renderer.element, settings);
    this.input.onMenu = () => this.onMenu();
    this.audio = new ForgeAudio(settings);
    this.input.onUnlock = () => void this.audio.activate();
    this.resizing = new ResizeObserver(() => this.renderer.resize());
    this.resizing.observe(host);
  }
  async initialize() {
    await this.renderer.initialize();
    if (this.disposed) return;
    this.lastFrame = performance.now();
    this.lastStep = this.lastFrame;
    this.timer = setInterval(this.simulate, 1000 / 60);
    this.raf = requestAnimationFrame(this.render);
  }
  setMenu(menu: boolean) {
    this.menu = menu;
    this.input.enabled = !menu;
    this.input.clear();
    if (menu && document.pointerLockElement === this.renderer.element) document.exitPointerLock();
  }
  updateSettings(settings: ForgeSettings) {
    this.input.settings = settings;
    this.audio.update(settings);
    this.renderer.updateSettings(settings);
  }
  receive(snapshot: ForgeSnapshot) {
    this.latest = snapshot;
    this.ui.state(snapshot, { yaw: this.input.yaw, pitch: this.input.pitch });
    this.receivedAt = performance.now();
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 10) this.snapshots.shift();
    const game = snapshot.game;
    if (!game) {
      this.visual = null;
      this.lastEvent = 0;
      this.lastRound = 0;
      this.prediction?.dispose();
      this.prediction = null;
      return;
    }
    if (game.round !== this.lastRound) {
      const p = game.players.find((p) => p.id === this.network.userId);
      if (p) {
        this.input.yaw = p.yaw;
        this.input.pitch = p.pitch;
      }
      this.lastRound = game.round;
      this.ui.aim(this.input.yaw, this.input.pitch);
    }
    if (!this.prediction && !this.pendingPrediction) {
      this.pendingPrediction = true;
      void ForgePrediction.create(this.network.userId)
        .then((pred) => {
          if (this.disposed || !this.latest?.game) {
            pred.dispose();
            return;
          }
          this.prediction = pred;
          if (this.latest) pred.receive(this.latest);
        })
        .catch(() => this.onError('Не удалось инициализировать физику.'))
        .finally(() => {
          this.pendingPrediction = false;
        });
    } else this.prediction?.receive(snapshot);
    if (!this.visual || this.visual.round !== game.round) this.visual = structuredClone(game);
    for (const event of game.events)
      if (event.id > this.lastEvent) {
        if (!(event.type === 'shot' && event.playerId === this.network.userId)) {
          const local = event.playerId === this.network.userId;
          this.audio.play(event.type, local ? undefined : event);
        }
        if (event.type === 'hit') {
          if (event.targetId === this.network.userId) void nexusInput.haptic('collision');
          if (event.playerId === this.network.userId) this.hitAt = performance.now();
          const target = game.players.find((p) => p.id === event.targetId);
          if (target) this.effects.emit(target);
        }
        if (event.type === 'round') void nexusInput.haptic('start');
        if (event.type === 'fold' && event.playerId === this.network.userId)
          void nexusInput.haptic('confirm');
        this.lastEvent = Math.max(this.lastEvent, event.id);
      }
  }
  private simulate = () => {
    if (this.disposed) return;
    const now = performance.now();
    this.accumulator += Math.min(0.1, Math.max(0, (now - this.lastStep) / 1000));
    this.lastStep = now;
    const before = performance.now();
    let steps = 0;
    while (this.accumulator >= FOLD_DT && steps++ < 6) {
      this.accumulator -= FOLD_DT;
      const visibleTick = this.latest?.game
        ? Math.max(0, Math.floor(this.latest.game.tick + (now - this.receivedAt) * 0.06 - 5.1))
        : 0;
      const command = this.input.sample(this.seq, visibleTick, FOLD_DT);
      this.ui.aim(command.yaw, command.pitch);
      if (this.network.connected && this.latest?.game) {
        this.seq++;
        this.network.sendInput(command);
        this.prediction?.step(command);
      }
      const p = this.prediction?.current,
        active = ['active', 'overtime'].includes(this.latest?.game?.phase ?? '');
      if (!this.menu && active && p) {
        if (
          command.fire &&
          p.ammo > 0 &&
          p.reload <= 0 &&
          now / 1000 - this.shotAt >= balance.fireSeconds
        ) {
          this.shotAt = now / 1000;
          this.audio.play('shot');
        }
        if (
          p.grounded &&
          Math.hypot(p.vx, p.vz) > 1 &&
          now - this.stepAt > (command.sprint ? 230 : 330)
        ) {
          this.stepAt = now;
          this.audio.play('step');
        }
      }
    }
    this.performance.physicsMs = performance.now() - before;
  };
  private interpolated(now: number) {
    const s = this.latest?.game,
      out = this.visual;
    if (!s || !out) return null;
    const target = (this.latest?.serverTime ?? 0) + (now - this.receivedAt) - 85;
    let older = this.snapshots[0],
      newer = this.snapshots.at(-1)!;
    for (const candidate of this.snapshots) {
      if (candidate.serverTime <= target) older = candidate;
      if (candidate.serverTime >= target) {
        newer = candidate;
        break;
      }
    }
    const a = older?.game,
      b = newer?.game;
    if (!a || !b || a.round !== b.round) return s;
    const alpha = Math.max(
      0,
      Math.min(1, (target - older.serverTime) / Math.max(1, newer.serverTime - older.serverTime)),
    );
    out.tick = s.tick;
    out.phase = s.phase;
    out.score = s.score;
    for (const p of out.players) {
      const pa = a.players.find((x) => x.id === p.id),
        pb = b.players.find((x) => x.id === p.id);
      if (!pa || !pb) continue;
      Object.assign(p, pb);
      p.x = pa.x + (pb.x - pa.x) * alpha;
      p.y = pa.y + (pb.y - pa.y) * alpha;
      p.z = pa.z + (pb.z - pa.z) * alpha;
      p.yaw = pa.yaw + Math.atan2(Math.sin(pb.yaw - pa.yaw), Math.cos(pb.yaw - pa.yaw)) * alpha;
    }
    out.nodes = s.nodes.map((n) =>
      n.phase === 'moving'
        ? {
            ...n,
            progress: Math.max(
              0,
              Math.min(
                1,
                1 -
                  (n.until - (s.tick / 60 + (now - this.receivedAt) / 1000)) /
                    balance.foldAnimation,
              ),
            ),
          }
        : n,
    );
    return out;
  }
  private render = (now: number) => {
    if (this.disposed) return;
    const rawDt = Math.max(0, (now - this.lastFrame) / 1000),
      dt = Math.min(0.1, rawDt);
    this.lastFrame = now;
    this.clock += rawDt;
    this.performance.frame(rawDt * 1000);
    const visual = this.interpolated(now),
      pose = this.prediction?.pose(Math.min(1, this.accumulator / FOLD_DT), dt) ?? null;
    const start = performance.now();
    this.effects.update(dt);
    this.renderer.frame(
      visual,
      this.network.userId,
      pose,
      this.input.yaw,
      this.input.pitch,
      dt,
      now / 1000,
      this.shotAt,
      this.menu,
      this.input.aiming,
    );
    this.performance.renderMs = performance.now() - start;
    this.performance.drawCalls = this.renderer.renderer.info.render.calls;
    if (pose)
      this.audio.listener(
        { x: pose.x, y: pose.y + 0.55, z: pose.z },
        this.input.yaw,
        this.input.pitch,
      );
    if (pose && visual)
      for (const p of visual.players)
        if (
          p.id !== this.network.userId &&
          p.hp > 0 &&
          p.grounded &&
          Math.hypot(p.vx, p.vz) > 1 &&
          now - (this.remoteSteps.get(p.id) ?? 0) > 300
        ) {
          this.remoteSteps.set(p.id, now);
          const dx = p.x - pose.x,
            dz = p.z - pose.z,
            length = Math.hypot(dx, dz),
            hit =
              length > 0.1
                ? this.prediction?.physics.ray(
                    { x: pose.x, y: pose.y + 0.3, z: pose.z },
                    { x: dx / length, y: 0, z: dz / length },
                    length,
                    this.network.userId,
                  )
                : null;
          this.audio.play('step', p, !!hit && hit.id !== p.id);
        }
    // Calibrate only before combat; no surprise preset swaps during an exchange.
    if (this.menu && !this.benchmarkDone && this.renderer.settings.quality === 'auto') {
      this.benchmarkFrames.push(rawDt);
      if (this.benchmarkFrames.length >= 90 || this.clock > 7) {
        const mean = this.benchmarkFrames.reduce((a, b) => a + b, 0) / this.benchmarkFrames.length;
        this.renderer.updateSettings(
          this.renderer.settings,
          mean > 1 / 28 ? 'low' : mean > 1 / 45 ? 'competitive' : 'medium',
        );
        this.benchmarkDone = true;
      }
    }
    if (now - this.lastHud > 200) {
      this.lastHud = now;
      const stats = this.performance.snapshot();
      this.ui.frame(
        this.latest?.game?.tick,
        this.prediction?.current ?? null,
        stats,
        now - this.hitAt < 180,
      );
      const canvas = this.renderer.element;
      canvas.dataset.forgeFrame = JSON.stringify({
        ...stats,
        rtt: this.network.rtt,
        jitter: this.network.jitter,
        entities: visual?.players.length ?? 0,
      });
    }
    this.raf = requestAnimationFrame(this.render);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.timer) clearInterval(this.timer);
    this.resizing.disconnect();
    this.input.dispose();
    this.audio.dispose();
    this.prediction?.dispose();
    this.effects.dispose();
    this.renderer.dispose();
  }
}
