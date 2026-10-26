// Same worker assembled by Three r186, emitted as a reviewed static resource.
// An external worker receives its own CSP; a blob worker inherits the document's
// no-eval policy and cannot initialize this Emscripten/Basis distribution.
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'public/game-assets/basis-r186',
  fn = KTX2Loader.BasisWorker.toString();
const body =
  [
    '/* Three.js r186 MIT / Basis Universal Apache-2.0; licenses in this directory. */',
    ...['EngineFormat', 'EngineType', 'TranscoderFormat', 'BasisFormat'].map(
      (name) => 'let _' + name + ' = ' + JSON.stringify(KTX2Loader[name]) + ';',
    ),
    await fs.readFile(dir + '/basis_transcoder.js', 'utf8'),
    fn.substring(fn.indexOf('{') + 1, fn.lastIndexOf('}')),
  ]
    .join('\n')
    .trimEnd() + '\n';
const file = 'ktx-worker-' + createHash('sha256').update(body).digest('hex').slice(0, 10) + '.js';
await fs.writeFile(dir + '/' + file, body);
await fs.copyFile('node_modules/three/LICENSE', dir + '/THREE-LICENSE');
const p = 'public/game-assets/graphics-manifest.json',
  manifest = JSON.parse(await fs.readFile(p));
manifest.basisWorker = '/game-assets/basis-r186/' + file;
await fs.writeFile(p + '.next', JSON.stringify(manifest, null, 2) + '\n');
await fs.rename(p + '.next', p);
console.log('Static decoder worker prepared:', file);
