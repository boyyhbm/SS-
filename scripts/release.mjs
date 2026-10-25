import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { validateProductionConfig } from './production-config.mjs';
import { deploymentEnvironment, isPreparation } from './deployment-env.mjs';

Object.assign(process.env, deploymentEnvironment(process.env));
if (isPreparation(process.env)) {
  console.log('Preparation release: existing data untouched; migrations and seed not run.');
  process.exit(0);
}
// Pre-deploy containers have private networking, but no application volume.
validateProductionConfig(process.env, process.env.NEXUS_SERVICE ?? 'web', { volume: false });
const connection = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
const run = (script) =>
  new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], { stdio: 'inherit' });
    child.on('error', () => reject(new Error('Release command could not start')));
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Release command failed')),
    );
  });
try {
  await connection.connect();
  // Serialize releases for both services; use a different key from Prisma and the game lease.
  await connection.query("SET statement_timeout = '240s'");
  await connection.query('SELECT pg_advisory_lock(1313167438, 1296648018)');
  await run('db:migrate');
  if (process.env.NEXUS_SERVICE === 'web') await run('db:seed');
} catch {
  console.error('Production release failed. Existing data was not reset. Inspect host logs.');
  process.exitCode = 1;
} finally {
  await connection.end().catch(() => {});
}
