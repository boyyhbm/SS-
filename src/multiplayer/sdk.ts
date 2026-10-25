'use client';
import { Client, type Room, type SeatReservation } from '@colyseus/sdk';
import type { MultiplayerAction, RoomSnapshot } from './contracts';
export interface NetworkPrediction<State> {
  connected: boolean;
  offset: number;
  receive(snapshot: RoomSnapshot<State>): void;
  resetPending(): void;
}
export class NexusMultiplayerSDK<State, Input, Prediction extends NetworkPrediction<State>> {
  constructor(
    private createPrediction: (userId: string, send: (input: Input) => void) => Prediction,
  ) {}
  room: Room | null = null;
  prediction: Prediction | null = null;
  latestSnapshot: RoomSnapshot<State> | null = null;
  connected = false;
  rtt = 0;
  jitter = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotListeners = new Set<(snapshot: RoomSnapshot<State>) => void>();
  private eventListeners = new Set<(type: string, username?: string) => void>();
  async authenticate(action: MultiplayerAction) {
    const response = await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'networkUnavailable');
    return result;
  }
  private connectionEpoch = 0;
  async connect(action: MultiplayerAction) {
    await this.leaveRoom();
    const epoch = ++this.connectionEpoch;
    const ticket = (await this.authenticate(action)) as {
      reservation: SeatReservation;
      endpoint: string;
      userId: string;
    };
    if (epoch !== this.connectionEpoch) throw new Error('roomClosed');
    const client = new Client(ticket.endpoint);
    const room = await client.consumeSeatReservation(ticket.reservation);
    if (epoch !== this.connectionEpoch) {
      if (room.connection.isOpen) await room.leave(true);
      throw new Error('roomClosed');
    }
    this.room = room;
    this.connected = true;
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 20;
    room.reconnection.maxDelay = 2000;
    room.reconnection.maxEnqueuedMessages = 0;
    this.prediction = this.createPrediction(ticket.userId, (command) => this.sendInput(command));
    room.onMessage('snapshot', (snapshot: RoomSnapshot<State>) => {
      if (this.latestSnapshot && snapshot.serverTime < this.latestSnapshot.serverTime) return;
      this.latestSnapshot = snapshot;
      this.prediction?.receive(snapshot);
      this.snapshotListeners.forEach((listener) => listener(snapshot));
    });
    room.onMessage('pong', (data: { echo: number; serverTime: number }) => {
      const measured = Date.now() - data.echo;
      this.jitter = this.jitter * 0.8 + Math.abs(measured - this.rtt) * 0.2;
      this.rtt = this.rtt ? this.rtt * 0.7 + measured * 0.3 : measured;
      if (this.prediction) this.prediction.offset = data.serverTime - (data.echo + Date.now()) / 2;
    });
    room.onMessage('event', (event: { type: string; username?: string }) =>
      this.emit(event.type, event.username),
    );
    room.onMessage('notice', (type: string) => this.emit(type));
    room.onDrop(() => {
      this.connected = false;
      if (this.prediction) this.prediction.connected = false;
      this.emit('connectionLost');
    });
    room.onReconnect(() => {
      this.connected = true;
      if (this.prediction) {
        this.prediction.connected = true;
        this.prediction.resetPending();
      }
      this.emit('reconnected');
    });
    room.onLeave(() => {
      if (this.room === room) this.room = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.connected = false;
      if (this.prediction) this.prediction.connected = false;
      this.emit('roomClosed');
    });
    this.pingTimer = setInterval(() => {
      if (this.connected) room.send('ping', Date.now());
    }, 1000);
    return room;
  }
  createRoom(gameId: string, privateRoom = true, maxPlayers = 6) {
    return this.connect({ action: 'create', gameId, private: privateRoom, maxPlayers });
  }
  joinRoom(gameId: string, roomId: string) {
    return this.connect({ action: 'join', gameId, roomId });
  }
  quickMatch(gameId: string, party = false) {
    return this.connect({ action: 'quick', gameId, party });
  }
  async leaveRoom() {
    this.connectionEpoch++;
    this.latestSnapshot = null;
    if (this.prediction) this.prediction.connected = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const room = this.room;
    this.room = null;
    this.connected = false;
    if (room) {
      room.reconnection.enabled = false;
      if (room.connection.isOpen) await room.leave(true);
    }
  }
  async cancelSearch() {
    await this.leaveRoom();
    await this.authenticate({ action: 'cancel' });
  }
  ready(value: boolean) {
    this.room?.send('ready', value);
  }
  chooseCar(car: string) {
    this.room?.send('car', car);
  }
  configure(laps: number) {
    this.room?.send('settings', { laps });
  }
  startMatch() {
    this.room?.send('start');
  }
  endMatch() {
    return this.leaveRoom();
  } // Clients can leave; they cannot declare an authoritative winner.
  rematch() {
    this.room?.send('rematch');
  }
  sendInput(command: Input) {
    if (this.connected) this.room?.send('input', command);
  }
  receiveState(listener: (snapshot: RoomSnapshot<State>) => void) {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }
  onEvent(listener: (type: string, username?: string) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }
  private emit(type: string, username?: string) {
    this.eventListeners.forEach((listener) => listener(type, username));
  }
  async invitePlayer(userId: string) {
    const res = await fetch('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gameInvite', userId, roomId: this.room?.roomId }),
    });
    if (!res.ok) throw new Error('socialNotAllowed');
  }
  reconnect() {
    // Colyseus resumes the in-memory seat automatically; token never leaves this SDK instance.
    if (!this.room) throw new Error('roomClosed');
    return this.room.reconnection.isReconnecting;
  }
  submitServerVerifiedResult() {
    // Deliberately no client result upload. Settlement belongs exclusively to the game server.
    return this.latestSnapshot?.saved === true;
  }
}
