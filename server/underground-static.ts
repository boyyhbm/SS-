import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
export function undergroundStatic(
  nexusOrigin: string,
  folder = path.resolve('public/nfsu-runtime'),
) {
  const router = express.Router(),
    origin = new URL(nexusOrigin).origin;
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as {
    resources: { path: string }[];
  };
  const allowed = new Set(manifest.resources.map((r) => r.path));
  allowed.add('manifest.json');
  router.use((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; connect-src 'self' blob:; img-src 'self' data: blob:; media-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}`,
    );
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end();
      return;
    }
    const file = req.path === '/' || req.path === '' ? 'index.html' : req.path.slice(1);
    if (!allowed.has(file) || file.includes('..') || file.includes('\\')) {
      res.status(404).end();
      return;
    }
    if (file === 'index.html') {
      const html = fs
        .readFileSync(path.join(folder, file), 'utf8')
        .replaceAll(
          '__NEXUS_ORIGIN__',
          origin.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
        );
      res.type('html').send(html);
      return;
    }
    res.sendFile(path.join(folder, file));
  });
  return router;
}
