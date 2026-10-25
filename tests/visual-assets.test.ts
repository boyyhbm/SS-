import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gameArtwork } from '../src/lib/artwork';

const root = new URL('../public/game-assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
function glb(name: string) {
  const data = readFileSync(new URL(name, root));
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  expect(data.readUInt32LE(4)).toBe(2);
  expect(data.readUInt32LE(8)).toBe(data.length);
  return JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
}

describe('shipped visual assets', () => {
  it('matches reviewed hashes and does not require an asset CDN', () => {
    for (const item of manifest.products) {
      const file = readFileSync(new URL(item.filename, root));
      expect(file.length).toBe(item.bytes);
      expect(createHash('sha256').update(file).digest('hex')).toBe(item.sha256);
      if (!item.filename.endsWith('.glb')) continue;
      const model = glb(item.filename);
      expect(model.buffers.every((b: { uri?: string }) => !b.uri)).toBe(true);
      expect(model.images.every((i: { bufferView?: number }) => i.bufferView !== undefined)).toBe(
        true,
      );
      expect(model.extensionsRequired).toContain('EXT_meshopt_compression');
    }
    for (const license of ['CC-BY-4.0.txt', 'CC0-1.0.txt', 'Bistro-CC-BY-4.0.txt', 'car-source.md'])
      expect(existsSync(new URL('licenses/' + license, root))).toBe(true);
  });

  it('preserves animated wheel anchors and architectural templates in both LODs', () => {
    for (const level of ['high', 'low']) {
      const names = glb(`car-${level}.glb`).nodes.map((n: { name?: string }) => n.name);
      for (const wheel of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'])
        expect(names).toContain(wheel);
      expect(names.some((name: string) => /Emblem|LicensePlate/i.test(name))).toBe(false);
      const buildings = glb(`district-${level}.glb`).nodes.map((n: { name?: string }) => n.name);
      for (const name of ['S1B1', 'S1B2', 'S2B1', 'BistroProps'])
        expect(buildings).toContain('Bistro_' + name);
    }
    for (const kind of ['car', 'district']) {
      const low = manifest.products.find(
        (p: { filename: string }) => p.filename === `${kind}-low.glb`,
      );
      const high = manifest.products.find(
        (p: { filename: string }) => p.filename === `${kind}-high.glb`,
      );
      expect(low.triangles).toBeLessThan(high.triangles * 0.4);
    }
  });

  it('updates bundled artwork while preserving administrator custom images', () => {
    const game = {
      slug: 'midnight-outlaws',
      cover: '/art/midnight-cover.svg',
      banner: '/art/midnight-banner.svg',
      screenshots: ['/art/midnight-gameplay.webp'],
    };
    const result = gameArtwork(game);
    expect(result.cover).toBe('/art/midnight-keyart.webp');
    expect(result.screenshots).toEqual(['/art/midnight-gameplay-new.webp']);
    for (const asset of [result.cover, result.banner, ...result.screenshots])
      expect(existsSync(new URL('../public' + asset, import.meta.url))).toBe(true);
    const custom = {
      ...game,
      cover: '/api/media/custom-cover.webp',
      banner: '/api/media/custom-banner.webp',
      screenshots: ['/api/media/screenshot.webp'],
    };
    expect(gameArtwork(custom)).toEqual(custom);
    expect(game.cover).toBe('/art/midnight-cover.svg');
  });
});
