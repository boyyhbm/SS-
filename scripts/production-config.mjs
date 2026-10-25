import path from 'node:path';
import { pathToFileURL } from 'node:url';

const loopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

export function validateProductionConfig(env, service, { volume = true } = {}) {
  const errors = [];
  for (const name of [
    'DATABASE_URL',
    'NEXTAUTH_URL',
    'MULTIPLAYER_SECRET',
    'NEXT_PUBLIC_MULTIPLAYER_URL',
  ])
    if (!env[name]) errors.push(`${name} is required`);
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  if (!['web', 'multiplayer'].includes(service)) errors.push('Unknown service');
  if (env.NEXUS_DEPLOYMENT === 'render' && env.RENDER !== 'true')
    errors.push('Render deployment requires the host-provided RENDER marker');
  if ((env.MULTIPLAYER_SECRET?.length ?? 0) < 64) errors.push('MULTIPLAYER_SECRET is too short');
  if (service === 'web' && (env.NEXTAUTH_SECRET?.length ?? 0) < 64)
    errors.push('NEXTAUTH_SECRET needs at least 64 characters');
  try {
    const web = new URL(env.NEXTAUTH_URL);
    if (
      web.protocol !== 'https:' ||
      web.username ||
      web.password ||
      loopback(web.hostname) ||
      web.pathname !== '/' ||
      web.search ||
      web.hash
    )
      errors.push('NEXTAUTH_URL must be a public HTTPS origin');
  } catch {
    errors.push('NEXTAUTH_URL must be a public HTTPS origin');
  }
  try {
    const game = new URL(env.NEXT_PUBLIC_MULTIPLAYER_URL);
    if (
      game.protocol !== 'wss:' ||
      game.username ||
      game.password ||
      loopback(game.hostname) ||
      game.pathname !== '/' ||
      game.search ||
      game.hash
    )
      errors.push('NEXT_PUBLIC_MULTIPLAYER_URL must be a public WSS origin');
  } catch {
    errors.push('NEXT_PUBLIC_MULTIPLAYER_URL must be a public WSS origin');
  }
  try {
    const database = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw Error();
    if (env.NEXUS_DEPLOYMENT === 'railway' && !database.hostname.endsWith('.railway.internal'))
      errors.push('Railway DATABASE_URL must use private networking');
    if (env.NEXUS_DEPLOYMENT === 'render' && !/^dpg-[a-z0-9-]+$/.test(database.hostname))
      errors.push('Render DATABASE_URL must use its private database hostname');
  } catch {
    errors.push('DATABASE_URL must be PostgreSQL');
  }
  if (!/^\d+$/.test(env.PORT ?? '') || Number(env.PORT) < 1 || Number(env.PORT) > 65535)
    errors.push('PORT must be between 1 and 65535');
  if (service === 'web') {
    try {
      const internal = new URL(env.MULTIPLAYER_INTERNAL_URL);
      if (
        !['http:', 'https:'].includes(internal.protocol) ||
        internal.username ||
        internal.password
      )
        throw Error();
      if (env.NEXUS_DEPLOYMENT === 'railway' && !internal.hostname.endsWith('.railway.internal'))
        errors.push('MULTIPLAYER_INTERNAL_URL must use Railway private networking');
      if (
        env.NEXUS_DEPLOYMENT === 'render' &&
        (!/^[a-z][a-z0-9-]+$/.test(internal.hostname) || loopback(internal.hostname))
      )
        errors.push('MULTIPLAYER_INTERNAL_URL must use Render private networking');
    } catch {
      errors.push('MULTIPLAYER_INTERNAL_URL is required');
    }
    if (volume && env.NEXUS_DEPLOYMENT === 'railway') {
      const root = env.RAILWAY_VOLUME_MOUNT_PATH;
      const folder = env.NEXUS_UPLOAD_DIR;
      if (
        !root ||
        !folder ||
        !path.isAbsolute(root) ||
        !path.isAbsolute(folder) ||
        !path.relative(root, folder) ||
        path.relative(root, folder).startsWith('..') ||
        path.isAbsolute(path.relative(root, folder))
      )
        errors.push('NEXUS_UPLOAD_DIR must be inside an attached Railway volume');
    }
    if (
      volume &&
      env.NEXUS_DEPLOYMENT === 'render' &&
      (!env.NEXUS_UPLOAD_DIR ||
        !path.isAbsolute(env.NEXUS_UPLOAD_DIR) ||
        !path.relative('/var/data', env.NEXUS_UPLOAD_DIR) ||
        path.relative('/var/data', env.NEXUS_UPLOAD_DIR).startsWith('..'))
    )
      errors.push('NEXUS_UPLOAD_DIR must be inside the Render /var/data disk');
  }
  if (errors.length) throw new Error([...new Set(errors)].join('; '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateProductionConfig(process.env, process.argv[2], {
      volume: !process.argv.includes('--release'),
    });
    console.log('Production configuration is valid; secret values are not printed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
