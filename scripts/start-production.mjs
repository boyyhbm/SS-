import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deploymentEnvironment, isPreparation } from './deployment-env.mjs';
import { validateProductionConfig } from './production-config.mjs';

export function hasMount(mountinfo, target) {
  return mountinfo.split('\n').some((line) => {
    const point = line
      .split(' ')[4]
      ?.replace(/\\([0-7]{3})/g, (_, digits) => String.fromCharCode(parseInt(digits, 8)));
    return point === target;
  });
}

async function start(service) {
  if (!['web', 'multiplayer'].includes(service)) throw Error('Unknown service');
  const env = deploymentEnvironment({ ...process.env, NEXUS_SERVICE: service });
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('A valid PORT is required');
  if (isPreparation(env)) {
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (['/api/health', '/live'].includes(req.url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, preparation: true, service: `nexus-${service}` }));
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300' });
        res.end('NEXUS: подготовка сервера. Перенос данных ещё не завершён.');
      }
    });
    server.listen(port, '0.0.0.0');
    const close = () => server.close(() => process.exit(0));
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    console.log('NEXUS preparation mode: accounts, migrations and gameplay are disabled.');
    return;
  }
  validateProductionConfig(env, service);
  if (service === 'web') {
    if (
      env.NEXUS_DEPLOYMENT === 'render' &&
      !hasMount(await readFile('/proc/self/mountinfo', 'utf8'), '/var/data')
    )
      throw Error('Render persistent disk must be mounted at /var/data');
    await mkdir(env.NEXUS_UPLOAD_DIR, { recursive: true });
    await access(env.NEXUS_UPLOAD_DIR, constants.W_OK);
  }
  const args =
    service === 'web'
      ? ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', env.PORT]
      : ['--import', 'tsx', 'server/index.ts'];
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  const signal = (name) => child.kill(name);
  process.on('SIGTERM', signal);
  process.on('SIGINT', signal);
  child.on('error', () => {
    console.error('Production service could not start');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start(process.argv[2]).catch(() => {
    console.error(
      'Production service configuration or startup failed; secret values were not logged.',
    );
    process.exitCode = 1;
  });
}
