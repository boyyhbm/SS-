import 'dotenv/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
const directory = await mkdtemp(path.join(tmpdir(), 'nexus-tls-'));
const file = (name: string) => path.join(directory, name);
const target = new URL(process.env.MULTIPLAYER_INTERNAL_URL ?? 'http://127.0.0.1:2567');
let proxy: https.Server | null = null;
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      file('ca.key'),
      '-out',
      file('ca.crt'),
      '-days',
      '1',
      '-subj',
      '/CN=NEXUS isolated test CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      file('server.key'),
      '-out',
      file('server.csr'),
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      file('server.csr'),
      '-CA',
      file('ca.crt'),
      '-CAkey',
      file('ca.key'),
      '-CAcreateserial',
      '-out',
      file('server.crt'),
      '-days',
      '1',
      '-copy_extensions',
      'copy',
    ],
    { stdio: 'ignore' },
  );
  proxy = https.createServer(
    { key: await readFile(file('server.key')), cert: await readFile(file('server.crt')) },
    (req, res) => {
      const upstream = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  proxy.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      const headers = req.rawHeaders.reduce(
        (lines, value, index) => (index % 2 === 0 ? `${lines}${value}: ` : `${lines}${value}\r\n`),
        '',
      );
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy!.listen(2569, '127.0.0.1', resolve));
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/test-multiplayer.ts'], {
      env: {
        ...process.env,
        NEXT_PUBLIC_MULTIPLAYER_URL: 'wss://localhost:2569',
        NODE_EXTRA_CA_CERTS: file('ca.crt'),
        TEST_TRANSPORT:
          'WSS on loopback through a real TLS reverse proxy; private test CA is explicitly trusted; certificate verification remains enabled. Delay/jitter/drop injected at application message boundaries, not WAN/TCP packet-loss measurements.',
      },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) throw Error(`WSS integration failed (${code})`);
} finally {
  if (proxy) await new Promise<void>((resolve) => proxy!.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
