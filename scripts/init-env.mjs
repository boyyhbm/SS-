import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
if (!existsSync('.env')) {
  const password = randomBytes(24).toString('hex');
  writeFileSync(
    '.env',
    `DB_PASSWORD=${password}\nDB_PORT=5432\nDATABASE_URL=postgresql://nexus:${password}@127.0.0.1:5432/nexus?schema=public\nNEXTAUTH_URL=http://localhost:3000\nNEXTAUTH_SECRET=${randomBytes(48).toString('hex')}\nTRUST_PROXY=false\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Created .env with random local credentials.');
} else console.log('Existing .env preserved.');

const existing = readFileSync('.env', 'utf8');
const additions = {
  MULTIPLAYER_SECRET: randomBytes(48).toString('hex'),
  MULTIPLAYER_INTERNAL_URL: 'http://127.0.0.1:2567',
  NEXT_PUBLIC_MULTIPLAYER_URL: 'ws://localhost:2567',
};
for (const [key, value] of Object.entries(additions)) {
  if (!new RegExp(`^${key}=`, 'm').test(existing)) appendFileSync('.env', `\n${key}=${value}\n`);
}
console.log('Local multiplayer configuration present; existing values preserved.');
