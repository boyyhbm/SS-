#!/usr/bin/env node
// NEXUS local preparation tool. It never uploads game bytes or starts a server.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const REV = '327b22c39041f197a4cfdf2544f81799b332b6c7',
  REPO = 'https://github.com/lguilherme44/nfsu1-web.git';
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (['--help', '--check'].includes(key)) options[key] = true;
  else if (
    ['--game', '--wasi', '--out', '--source'].includes(key) &&
    args[i + 1] &&
    !args[i + 1].startsWith('--')
  )
    options[key] = args[++i];
  else {
    console.error('Unknown or missing argument: ' + key);
    process.exit(1);
  }
}
if (options['--help'] || !args.length) {
  console.log(
    `NEXUS / Underground — local-only preparation\n\nUse your own compatible SPEED.EXE 1.4 installation. No game files are downloaded.\n\nCheck files only:\n  node prepare-underground.mjs --game "/path/to/game" --check\n\nBuild and package:\n  node prepare-underground.mjs --game "/path/to/game" --wasi "/path/to/wasi-sdk" --out "/private/path/nexus-underground-local"\n\nNeeds Node 24+, Python 3 with venv, bash, shasum, and a wasi-sdk with wasm32-wasip1-threads / LLVM Wasm EH support. On Windows use WSL2.\nOfficial toolchain: https://github.com/WebAssembly/wasi-sdk/releases\nOptional --source points to an unmodified checkout at ${REV}. Otherwise only the MIT tool sources are cloned into a private temporary directory.\n\nThe tool reads the game, runs the upstream x86-to-C generator and Wasm compiler locally, and writes an offline folder. Select that prepared folder in NEXUS. Do not commit or publicly serve its data or derived Wasm. MIT tools do not grant Electronic Arts rights.\n`,
  );
  process.exit(0);
}
const checksum = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of fss.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const run = (file, argv, cwd, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, argv, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`${path.basename(file)} failed (${code})`)),
    );
  });
const capture = (file, argv, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (b) => {
      text += b;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(text.trim()) : reject(Error('Source revision check failed')),
    );
  });
const within = (root, file) => {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};
try {
  if (!options['--game']) throw Error('--game is required');
  const game = await fs.realpath(path.resolve(options['--game']));
  const names = await fs.readdir(game),
    exeName = names.find((n) => n.toLowerCase() === 'speed.exe');
  if (!exeName)
    throw Error(
      'SPEED.EXE is missing. Provide an installed PC copy, not an installer or disc image.',
    );
  const exe = path.join(game, exeName),
    handle = await fs.open(exe, 'r'),
    header = Buffer.alloc(Math.min((await handle.stat()).size, 1024 * 1024));
  await handle.read(header, 0, header.length, 0);
  await handle.close();
  const at = header.length >= 64 ? header.readUInt32LE(0x3c) : -1;
  if (
    header.length < 64 ||
    header.readUInt16LE(0) !== 0x5a4d ||
    at < 64 ||
    at + 80 > header.length ||
    header.readUInt32LE(at) !== 0x4550 ||
    header.readUInt16LE(at + 4) !== 0x14c ||
    header.readUInt16LE(at + 24) !== 0x10b ||
    header.readUInt32LE(at + 52) !== 0x400000 ||
    header.readUInt32LE(at + 8) !== 0x40072965
  )
    throw Error(
      'Unsupported executable. This port requires x86 SPEED.EXE 1.4, PE timestamp 0x40072965 and image base 0x400000. No version-bypass option is enabled.',
    );
  const exeHash = await checksum(exe);
  console.log(
    'Compatible PE header found. SHA-256 was computed locally. This is the upstream timestamp/layout guard, not a publisher signature or proof of every regional variant.',
  );
  if (options['--check']) {
    console.log(
      JSON.stringify({
        checked: true,
        gameVersion: '1.4',
        peTimestamp: '0x40072965',
        sha256: exeHash,
        gameplayTested: false,
      }),
    );
    process.exit(0);
  }
  if (!options['--out'] || !options['--wasi'])
    throw Error('--out and --wasi are required for a build.');
  const installation = await fs.readdir(game, { withFileTypes: true });
  for (const required of ['cars', 'tracks', 'global', 'frontend'])
    if (!installation.some((entry) => entry.isDirectory() && entry.name.toLowerCase() === required))
      throw Error('Incomplete game installation: ' + required + ' is missing.');
  if (process.platform === 'win32')
    throw Error('Run this utility inside WSL2; the upstream build requires bash.');
  const out = path.resolve(options['--out']);
  const outParent = await fs.realpath(path.dirname(out)),
    canonicalOut = path.join(outParent, path.basename(out));
  if (
    within(game, canonicalOut) ||
    /(?:^|[\\/])(public|htdocs|wwwroot|dist|deploy)(?:[\\/]|$)/i.test(canonicalOut)
  )
    throw Error('Choose a private output folder outside the game and web/public directories.');
  let repoRoot = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
      if (pkg.name === 'nexus-console' && within(repoRoot, canonicalOut))
        throw Error('Output must be outside the NEXUS repository.');
    } catch (e) {
      if (e.message === 'Output must be outside the NEXUS repository.') throw e;
    }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }
  try {
    if ((await fs.readdir(canonicalOut)).length)
      throw Error('Output directory must be empty; existing data is never deleted.');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const wasi = await fs.realpath(path.resolve(options['--wasi']));
  await fs.access(path.join(wasi, 'bin/clang'), fss.constants.X_OK);
  let source;
  if (options['--source']) source = await fs.realpath(path.resolve(options['--source']));
  else {
    source = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-nfsu-build-'));
    await run('git', ['init', '--quiet'], source);
    await run('git', ['remote', 'add', 'origin', REPO], source);
    await run('git', ['fetch', '--depth=1', 'origin', REV], source);
    await run('git', ['checkout', '--detach', '--quiet', 'FETCH_HEAD'], source);
  }
  if (
    (await capture('git', ['rev-parse', 'HEAD'], source)) !== REV ||
    (await capture('git', ['status', '--porcelain'], source))
  )
    throw Error('Use the pinned, unmodified upstream source checkout.');
  await run('python3', ['-m', 'venv', '.venv'], source);
  await run(
    path.join(source, '.venv/bin/python'),
    ['-m', 'pip', 'install', 'pefile==2024.8.26', 'capstone==5.0.6'],
    source,
  );
  const env = { ...process.env, WASI: wasi };
  delete env.NFSU1_ANY_EXE;
  await run('bash', ['web/gen.sh', exe], source, env);
  await run('bash', ['web/build.sh'], source, env);
  const wasm = path.join(source, 'out/web/nfsu1.wasm'),
    info = JSON.parse(await fs.readFile(path.join(source, 'out/web/nfsu1.json'), 'utf8'));
  if (
    info.pages < 10240 ||
    info.pages > 32768 ||
    info.maxPages !== 65536 ||
    info.guestEnd !== 671088640 ||
    info.lift !== 'plain'
  )
    throw Error('Unsupported generated module metadata.');
  const stamp = await fs.readFile(path.join(source, 'gen/all/stamp.txt'), 'utf8');
  if (!stamp.includes('exe ' + exeHash.slice(0, 16)))
    throw Error('Generated code does not match this executable.');
  await fs.mkdir(canonicalOut, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(canonicalOut, 'runtime'), { mode: 0o700 });
  await fs.mkdir(path.join(canonicalOut, 'data'), { mode: 0o700 });
  await fs.mkdir(path.join(canonicalOut, 'licenses'), { mode: 0o700 });
  await fs.copyFile(wasm, path.join(canonicalOut, 'runtime/nfsu1.wasm'));
  const roots = new Set([
    'cars',
    'tracks',
    'global',
    'frontend',
    'nis',
    'sound',
    'speech',
    'movies',
    'langpacks',
    'languages',
  ]);
  const files = [],
    directories = [],
    casePaths = new Set(),
    cacheKeys = new Set();
  async function copy(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw Error('Symlinks are not imported: ' + rel);
      if (!relative && entry.isDirectory() && !roots.has(entry.name.toLowerCase())) continue;
      if (!relative && entry.isFile() && entry.name.toLowerCase() !== 'speed.exe') continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      if (
        !rel ||
        rel.length > 240 ||
        /[\\\x00-\x1f:?#]/.test(rel) ||
        rel.split('/').some((p) => p === '..' || p === '.' || !p)
      )
        throw Error('Unsupported data path');
      const from = path.join(dir, entry.name),
        dest = path.join(canonicalOut, 'data', ...rel.split('/'));
      if (entry.isDirectory()) {
        directories.push(rel);
        await fs.mkdir(dest, { recursive: true, mode: 0o700 });
        await copy(from, rel);
      } else {
        const st = await fs.stat(from),
          mtime = Math.floor(st.mtimeMs),
          key = `${rel.replace(/[^A-Za-z0-9._-]/g, '_')}.${st.size}.${mtime}`;
        if (casePaths.has(rel.toLowerCase()) || cacheKeys.has(key))
          throw Error('Case or cache-key collision: ' + rel);
        casePaths.add(rel.toLowerCase());
        cacheKeys.add(key);
        if (st.size > 2 * 1024 ** 3) throw Error('Data file exceeds supported size: ' + rel);
        await fs.copyFile(from, dest);
        files.push({ path: rel, size: st.size, mtime, sha256: await checksum(dest) });
      }
    }
  }
  await copy(game);
  for (const required of ['cars', 'tracks', 'global', 'frontend'])
    if (!directories.some((p) => p.toLowerCase() === required))
      throw Error('Incomplete game installation: ' + required + ' is missing.');
  const size = (await fs.stat(wasm)).size;
  if (info.size !== size) throw Error('Compiled module size mismatch.');
  const manifest = {
    format: 'nexus-nfsu-local/v1',
    upstreamRevision: REV,
    exe: { version: '1.4', peTimestamp: 0x40072965, sha256: exeHash },
    module: {
      path: 'runtime/nfsu1.wasm',
      sha256: await checksum(wasm),
      size,
      info: {
        pages: info.pages,
        maxPages: info.maxPages,
        guestEnd: info.guestEnd,
        rev: info.rev,
        opt: info.opt,
        lift: info.lift,
        size,
      },
    },
    files,
    directories,
  };
  await fs.copyFile(
    path.join(source, 'LICENSE'),
    path.join(canonicalOut, 'licenses/nfsu1-web-MIT.txt'),
  );
  for (const entry of await fs.readdir(wasi, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:licen[cs]e|copying|notice)/i.test(entry.name))
      await fs.copyFile(
        path.join(wasi, entry.name),
        path.join(canonicalOut, 'licenses', 'wasi-sdk-' + entry.name),
      );
  }
  await fs.writeFile(
    path.join(canonicalOut, 'build-info.json'),
    JSON.stringify(
      {
        upstreamRevision: REV,
        compiler: await capture(path.join(wasi, 'bin/clang'), ['--version'], source),
        pythonPackages: { pefile: '2024.8.26', capstone: '5.0.6' },
        gameDataUploaded: false,
      },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(
    path.join(canonicalOut, 'licenses/NOTICE.txt'),
    "EA game content and the derived game module remain private. The tools' MIT license does not grant game redistribution rights. WASI SDK / LLVM / libc notices remain with your installed toolchain; see https://github.com/WebAssembly/wasi-sdk and its bundled licenses.\n",
  );
  await fs.writeFile(
    path.join(canonicalOut, 'nexus-nfsu-package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(
    'Prepared locally. Open Underground in NEXUS and select this output folder. No server was started and no game bytes were uploaded.',
  );
} catch (error) {
  console.error('Preparation stopped: ' + error.message);
  process.exitCode = 1;
}
