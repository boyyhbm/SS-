import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('public'),
  out = '/tmp/nexus-graphics-lab';
await fs.mkdir(out, { recursive: true });
await build({
  entryPoints: ['scripts/graphics-lab.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: out + '/lab.js',
  sourcemap: true,
  logLevel: 'warning',
});
await build({
  entryPoints: ['scripts/webgpu-probe.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: out + '/gpu.js',
  logLevel: 'warning',
});
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (pathname === '/' || pathname === '/webgpu') {
      res.setHeader('Content-Type', 'text/html');
      const entry =
        pathname === '/webgpu'
          ? '/gpu.js'
          : new URL(req.url, 'http://localhost').searchParams.get('reference') === 'before'
            ? '/reference.js'
            : '/lab.js';
      res.end(
        '<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#090b12}canvas{display:block}output{position:fixed;bottom:8px;left:8px;color:white;background:#10131d;padding:6px;font:12px sans-serif}</style><title>NEXUS graphics laboratory</title><script type="module" src="' +
          entry +
          '"></script><output>Graphics fixture · synthetic rendering load · NOT multiplayer gameplay</output></html>',
      );
      return;
    }
    const generated = {
      '/lab.js': out + '/lab.js',
      '/gpu.js': out + '/gpu.js',
      '/reference.js': path.resolve('.asset-cache/graphics-reference-f99.mjs'),
    };
    const file = generated[pathname] ?? path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!generated[pathname] && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.wasm': 'application/wasm',
        '.glb': 'model/gltf-binary',
        '.ktx2': 'image/ktx2',
        '.webp': 'image/webp',
        '.hdr': 'application/octet-stream',
      }[path.extname(file)] ?? 'application/octet-stream',
    );
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(3102, '127.0.0.1', () =>
  console.log('Graphics lab: http://127.0.0.1:3102 (loopback only)'),
);
