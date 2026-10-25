import { spawn } from 'node:child_process';
import { buildEnvironment, isPreparation } from './deployment-env.mjs';

const env = buildEnvironment(process.env);
const preparation = isPreparation(env);
const child = spawn('npm', ['run', preparation ? 'db:generate' : 'build'], {
  env,
  stdio: 'inherit',
});
child.on('error', () => {
  console.error('Production build could not start');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
