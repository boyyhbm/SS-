import * as THREE from 'three';
import { qualityPresets, type RenderTier } from './quality';
type Probe = { x: number; z: number; target: THREE.WebGLRenderTarget };
// Local radiance is captured once while loading. No six-face capture, renderer
// resource allocation, SSR edge history, or cubemap regeneration during driving.
export async function createLocalReflections(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  tier: RenderTier,
  beforeCapture: (x: number, z: number) => void,
  progress: (fraction: number) => void,
  customPositions?: number[][],
) {
  if (!qualityPresets[tier].reflection || !renderer.extensions.has('EXT_color_buffer_float'))
    return null;
  const global = scene.environment;
  if (!(global instanceof THREE.Texture)) return null;
  const positions =
    customPositions ??
    (tier === 'high'
      ? [
          [-140, 20],
          [170, 20],
          [-290, 40],
        ]
      : [
          [-160, -60],
          [-100, 80],
          [170, 35],
          [-290, 40],
          [130, -100],
        ]);
  const probes: Probe[] = [],
    pmrem = new THREE.PMREMGenerator(renderer);
  const oldTarget = renderer.getRenderTarget(),
    auto = renderer.shadowMap.autoUpdate;
  const headlights: THREE.Light[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.SpotLight && o.visible) {
      headlights.push(o);
      o.visible = false;
    }
  });
  renderer.shadowMap.autoUpdate = false;
  try {
    for (const [x, z, y = 1.5] of positions) {
      beforeCapture(x, z);
      const cube = new THREE.WebGLCubeRenderTarget(256, {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        generateMipmaps: false,
      });
      const camera = new THREE.CubeCamera(
        0.2,
        Math.max(300, qualityPresets[tier].cityDistance * 0.8),
        cube,
      );
      camera.position.set(x, y, z);
      camera.layers.set(0);
      camera.update(renderer, scene);
      const target = pmrem.fromCubemap(cube.texture);
      cube.dispose();
      // Shared cube-UV atlas dimensions are required by Three's physical shader.
      const base = global.image as { width?: number; height?: number },
        local = target.texture.image as { width?: number; height?: number };
      if (base.width !== local.width || base.height !== local.height) {
        target.dispose();
        throw Error('Reflection atlas layout mismatch');
      }
      probes.push({ x, z, target });
      progress(probes.length / positions.length);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  } catch (e) {
    probes.forEach((p) => p.target.dispose());
    throw e;
  } finally {
    pmrem.dispose();
    renderer.setRenderTarget(oldTarget);
    renderer.shadowMap.autoUpdate = auto;
    headlights.forEach((l) => (l.visible = true));
  }
  const bound = new WeakSet<THREE.Material>();
  return {
    count: probes.length,
    bind(materials: THREE.Material[]) {
      const aMap = { value: probes[0].target.texture },
        bMap = { value: probes[1].target.texture },
        blend = { value: 0 };
      for (const m of materials) {
        if (!(m instanceof THREE.MeshStandardMaterial) || bound.has(m)) continue;
        bound.add(m);
        m.envMap = global;
        m.envMapIntensity = Math.min(1, m.envMapIntensity * 0.7);
        const previous = m.onBeforeCompile.bind(m),
          key = m.customProgramCacheKey();
        m.onBeforeCompile = (shader, r) => {
          previous(shader, r);
          Object.assign(shader.uniforms, {
            nexusProbeA: aMap,
            nexusProbeB: bMap,
            nexusProbeBlend: blend,
          });
          const physical = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
            /textureCubeUV\( envMap, ([^,]+), ([^)]+) \)/g,
            'nexusRadiance( $1, $2 )',
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <envmap_physical_pars_fragment>',
            `
            uniform sampler2D nexusProbeA;uniform sampler2D nexusProbeB;uniform float nexusProbeBlend;
            vec4 nexusRadiance(vec3 d,float r){return mix(textureCubeUV(envMap,d,r),mix(textureCubeUV(nexusProbeA,d,r),textureCubeUV(nexusProbeB,d,r),nexusProbeBlend),.65);}
          ` + physical,
          );
        };
        m.customProgramCacheKey = () => key + '-local-radiance-v1';
        m.needsUpdate = true;
      }
      let a = 0,
        b = 1,
        t = 0;
      const distances = new Float64Array(probes.length);
      return {
        update(x: number, z: number, dt: number) {
          let first = 0,
            second = 1;
          for (let i = 0; i < probes.length; i++) {
            distances[i] = Math.hypot(x - probes[i].x, z - probes[i].z);
            if (distances[i] < distances[first]) first = i;
          }
          second = first === 0 ? 1 : 0;
          for (let i = 0; i < probes.length; i++)
            if (i !== first && distances[i] < distances[second]) second = i;
          let target = 0;
          if (first !== a) {
            if (b !== first) {
              if (t < 0.003) {
                b = first;
                bMap.value = probes[b].target.texture;
              } else target = 0;
            }
            if (b === first) target = 1;
          } else {
            if (b !== second) {
              if (t < 0.003) {
                b = second;
                bMap.value = probes[b].target.texture;
              } else target = 0;
            }
            if (b === second)
              target = Math.min(0.45, distances[a] / Math.max(1, distances[a] + distances[b]));
          }
          t += (target - t) * (1 - Math.exp(-Math.max(0, dt) * 7));
          if (t > 0.997 && first === b) {
            const old = a;
            a = b;
            b = old;
            t = 1 - t;
            aMap.value = probes[a].target.texture;
            bMap.value = probes[b].target.texture;
          }
          blend.value = t;
        },
      };
    },
    dispose() {
      probes.forEach((p) => p.target.dispose());
    },
  };
}
