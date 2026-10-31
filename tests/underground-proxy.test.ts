import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => ({ id: 'fixture-only', sessionExpires: Date.now() + 60_000 })),
}));
afterEach(() => vi.unstubAllEnvs());
describe('isolated runtime behind a container listener', () => {
  it('uses the canonical browser origin when the listener is 0.0.0.0', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3102');
    vi.stubEnv('NEXT_PUBLIC_MULTIPLAYER_URL', 'ws://localhost:2669');
    vi.stubEnv('NEXT_PUBLIC_NFSU_RUNTIME_ORIGIN', undefined);
    const response = await proxy(
      new NextRequest('http://0.0.0.0:3102/play/need-for-speed-underground'),
    );
    expect(response.headers.get('content-security-policy')).toContain(
      'frame-src http://127.0.0.1:2669/nfsu/',
    );
    expect(response.headers.get('permissions-policy')).toContain(
      'cross-origin-isolated=(self "http://127.0.0.1:2669")',
    );
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });
  it('keeps the explicit production runtime restricted to its assigned origin', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://console.example.test');
    vi.stubEnv('NEXT_PUBLIC_MULTIPLAYER_URL', 'wss://games.example.test');
    vi.stubEnv('NEXT_PUBLIC_NFSU_RUNTIME_ORIGIN', undefined);
    const response = await proxy(
      new NextRequest('http://0.0.0.0:3000/play/need-for-speed-underground'),
    );
    expect(response.headers.get('content-security-policy')).toContain(
      'frame-src https://games.example.test/nfsu/',
    );
    const ordinary = await proxy(new NextRequest('http://0.0.0.0:3000/library'));
    expect(ordinary.headers.get('content-security-policy')).toContain("frame-src 'none'");
  });
});
