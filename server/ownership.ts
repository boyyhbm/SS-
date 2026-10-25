import { Client } from 'pg';

// Database-scoped session lock: a rolling deployment may boot two processes, but only
// one can recover matches or accept gameplay. It is released automatically on process death.
export class GameServerOwnership {
  private client: Client;
  private closing = false;
  constructor(connectionString: string | undefined, onLost: () => void) {
    this.client = new Client({ connectionString, connectionTimeoutMillis: 10000, keepAlive: true });
    this.client.on('error', () => {
      if (!this.closing) onLost();
    });
  }
  async connect() {
    await this.client.connect();
  }
  async acquire(signal: AbortSignal) {
    const deadline = Date.now() + 120000;
    while (!signal.aborted && Date.now() < deadline) {
      const result = await this.client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(1313167438, 1195461957) AS acquired',
      );
      if (result.rows[0].acquired) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Game server ownership unavailable');
  }
  async close() {
    this.closing = true;
    await this.client.end();
  }
}
