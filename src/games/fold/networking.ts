'use client';
import { Client, type Room, type SeatReservation } from '@colyseus/sdk';
import { FORGE_VERSION } from './config';
import type { ForgeCommand, ForgeSnapshot } from './contracts';
export class ForgeNetworking {
  room: Room | null = null;
  userId = '';
  snapshot: ForgeSnapshot | null = null;
  connected = false;
  rtt = 0;
  jitter = 0;
  onSnapshot: (s: ForgeSnapshot) => void = () => {};
  onStatus: (s: string) => void = () => {};
  private epoch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: ForgeSnapshot | null = null;
  private delivery: ReturnType<typeof setTimeout> | null = null;
  async connect(action: Record<string, unknown>) {
    await this.leave();
    const epoch = ++this.epoch;
    const response = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!response.ok) throw Error('Не удалось войти. Для приватной дуэли необходимо приглашение.');
    const ticket = (await response.json()) as {
      endpoint: string;
      reservation: SeatReservation;
      userId: string;
    };
    if (epoch !== this.epoch) return;
    const room = await new Client(ticket.endpoint).consumeSeatReservation(ticket.reservation);
    if (epoch !== this.epoch) {
      await room.leave(true);
      return;
    }
    this.room = room;
    this.userId = ticket.userId;
    this.connected = true;
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 20;
    room.reconnection.maxDelay = 1500;
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage('snapshot', (s: ForgeSnapshot) => {
      if (s.protocol !== FORGE_VERSION) {
        this.onStatus('Версия игры изменилась. Обновите страницу.');
        void this.leave();
        return;
      }
      if (s.serverTime < (this.pending?.serverTime ?? this.snapshot?.serverTime ?? 0)) return;
      this.pending = s;
      if (this.delivery === null)
        this.delivery = setTimeout(() => {
          this.delivery = null;
          const latest = this.pending;
          this.pending = null;
          if (latest && this.room === room && epoch === this.epoch) {
            this.snapshot = latest;
            this.onSnapshot(latest);
          }
        }, 0);
    });
    room.onMessage('pong', (p: { echo: number; serverTime: number }) => {
      const measured = Date.now() - p.echo;
      this.jitter = this.jitter * 0.8 + Math.abs(measured - this.rtt) * 0.2;
      this.rtt = this.rtt ? this.rtt * 0.7 + measured * 0.3 : measured;
    });
    room.onMessage('notice', (message: string) => this.onStatus(message));
    room.onDrop(() => {
      this.connected = false;
      this.onStatus('Связь потеряна · переподключение…');
    });
    room.onReconnect(() => {
      this.connected = true;
      this.onStatus('Соединение восстановлено');
    });
    room.onLeave(() => {
      if (this.room === room) {
        this.connected = false;
        this.room = null;
        this.onStatus('Комната закрыта');
      }
    });
    this.timer = setInterval(() => {
      if (this.connected) room.send('ping', Date.now());
    }, 1000);
  }
  sendInput(input: ForgeCommand) {
    if (this.connected) this.room?.send('input', input);
  }
  ready(ready: boolean) {
    this.room?.send('ready', { ready, protocol: FORGE_VERSION });
  }
  startMatch() {
    this.room?.send('start');
  }
  rematch() {
    this.room?.send('rematch');
  }
  async invitePlayer(userId: string) {
    const response = await fetch('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gameInvite', roomId: this.room?.roomId, userId }),
    });
    if (!response.ok) throw Error('Приглашение недоступно. Проверьте дружбу и приватность.');
  }
  async leave() {
    this.epoch++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.delivery) clearTimeout(this.delivery);
    this.delivery = null;
    this.pending = null;
    const room = this.room;
    this.room = null;
    this.connected = false;
    this.snapshot = null;
    if (room) {
      room.reconnection.enabled = false;
      if (room.connection.isOpen) await room.leave(true);
    }
  }
}
