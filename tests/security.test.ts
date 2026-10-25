import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { gameSchema, registrationSchema, assetSchema } from '../src/lib/validation';
import { isPlayable, runtimeRegistry } from '../src/games/registry';
describe('account and manifest boundaries', () => {
  it('uses a unique salt and validates only the correct password', async () => {
    const a = await hashPassword('A secure passphrase 2026');
    const b = await hashPassword('A secure passphrase 2026');
    expect(a).not.toBe(b);
    expect(a).not.toContain('passphrase');
    expect(await verifyPassword('A secure passphrase 2026', a)).toBe(true);
    expect(await verifyPassword('wrong password', a)).toBe(false);
    expect(await verifyPassword('x', 'invalid')).toBe(false);
  });
  it('rejects weak, mismatched and malformed registrations', () => {
    const valid = {
      username: 'Player_1',
      email: 'USER@example.com',
      password: 'strong_password_123',
      confirmPassword: 'strong_password_123',
    };
    expect(registrationSchema.parse(valid).email).toBe('user@example.com');
    expect(registrationSchema.parse(valid).username).toBe('player_1');
    expect(registrationSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, confirmPassword: 'other' }).success).toBe(
      false,
    );
    expect(registrationSchema.safeParse({ ...valid, username: '../admin' }).success).toBe(false);
  });
  it('rejects arbitrary runtime paths, external assets and script uploads', () => {
    for (const path of [
      'https://evil.example/x.png',
      '/art/../../secret.svg',
      'javascript:alert(1)',
      '/api/media/../passwd',
      '/art/x.html',
    ])
      expect(assetSchema.safeParse(path).success).toBe(false);
    const game = {
      slug: 'a-game',
      title: 'A game',
      description: 'An original description',
      descriptionEn: 'An original description',
      genre: 'racing',
      cover: '/art/midnight-cover.svg',
      banner: '/art/midnight-banner.svg',
      status: 'AVAILABLE',
      runtimeKey: 'midnight-outlaws',
      sortOrder: 0,
      published: true,
    };
    expect(gameSchema.safeParse(game).success).toBe(true);
    expect(gameSchema.safeParse({ ...game, runtimeKey: '../../some-module' }).success).toBe(false);
    expect(gameSchema.safeParse({ ...game, runtimeKey: '' }).success).toBe(false);
    expect(isPlayable({ ...game, runtimeKey: 'unknown' })).toBe(false);
    expect(isPlayable({ ...game, status: 'COMING_SOON' })).toBe(false);
    expect(isPlayable({ ...game, published: false })).toBe(false);
    expect(Object.keys(runtimeRegistry)).toEqual(['midnight-outlaws']);
  });
});
