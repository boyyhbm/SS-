import * as THREE from 'three';
import { asphaltMaterial } from './city-world';
import { TRACK_RADIUS as R, ROAD_HALF_WIDTH as HALF, type RaceState } from '../racing-physics';
import { qualityPresets, type RenderTier } from './quality';
import type { RaceAssets } from './assets';
import { batchStaticMeshes } from './geometry';

function strip(inner: number, outer: number, y: number, segments = 256) {
  const pos: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    for (const r of [inner, outer]) {
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      pos.push(x, y, z);
      uv.push(x / 6, z / 6);
    }
    if (i < segments) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
function sign(text: string, accent = '#daf76e') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#10171b';
  c.fillRect(0, 0, 1024, 256);
  c.fillStyle = accent;
  c.fillRect(0, 0, 12, 256);
  c.font = '700 86px "Manrope Variable", sans-serif';
  c.fillText(text, 52, 149);
  c.strokeStyle = '#52615b';
  c.lineWidth = 2;
  c.strokeRect(25, 25, 974, 206);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: '#d1e8c1',
      emissiveIntensity: 1.1,
      roughness: 0.5,
      side: THREE.FrontSide,
    }),
  );
  label.position.z = 0.051;
  const board = new THREE.Group();
  board.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(8, 2, 0.08),
      new THREE.MeshStandardMaterial({ color: '#182126', roughness: 0.7, metalness: 0.35 }),
    ),
    label,
  );
  return board;
}
export function createWorld(
  scene: THREE.Scene,
  assets: RaceAssets,
  tier: RenderTier,
  renderer: THREE.WebGLRenderer,
) {
  const preset = qualityPresets[tier];
  scene.background = new THREE.Color('#09131f');
  scene.fog = new THREE.FogExp2('#162330', tier === 'low' ? 0.016 : 0.0044);
  if (tier === 'low') scene.background = scene.fog.color;
  const hemisphere = new THREE.HemisphereLight('#acbedb', '#31302b', 0.75);
  scene.add(hemisphere);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(550, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 dir; void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:
        'varying vec3 dir;void main(){vec3 n=normalize(dir);float h=pow(max(0.0,n.y),0.45);vec3 c=mix(vec3(0.075,0.13,0.18),vec3(0.006,0.018,0.035),h);float moon=smoothstep(0.99968,0.99983,dot(n,normalize(vec3(-0.65,0.3,0.4))));gl_FragColor=vec4(c+vec3(0.45,0.51,0.55)*moon,1.0);\n#include <colorspace_fragment>\n}',
    }),
  );
  scene.add(sky);
  const key = new THREE.DirectionalLight('#bad2eb', 1.15);
  key.position.set(-35, 55, 20);
  key.castShadow = preset.shadows;
  key.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.04;
  Object.assign(key.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 1,
    far: 130,
  });
  scene.add(key, key.target);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(assets.environment);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.4;
  scene.environmentRotation.y = 0.7;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(650, 96),
    new THREE.MeshStandardMaterial({ color: '#111b22', roughness: 0.94 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);
  const roadMaterial = asphaltMaterial(assets,tier);
  const road = new THREE.Mesh(strip(R - HALF, R + HALF, 0), roadMaterial);
  road.receiveShadow = true;
  scene.add(road);
  const pavement = new THREE.MeshStandardMaterial({
    color: '#6f7475',
    roughness: 0.8,
    normalMap: assets.normal,
    normalScale: new THREE.Vector2(0.3, 0.3),
  });
  for (const side of [-1, 1]) {
    const radius = R + side * (HALF + 2.3);
    const walk = new THREE.Mesh(strip(radius - 2.2, radius + 2.2, 0.22), pavement);
    walk.receiveShadow = true;
    scene.add(walk);
    const curb = new THREE.Mesh(
      strip(R + side * HALF - 0.2, R + side * HALF + 0.2, 0.13),
      new THREE.MeshStandardMaterial({ color: '#a8a99d', roughness: 0.7 }),
    );
    curb.receiveShadow = true;
    scene.add(curb);
  }
  const marking = new THREE.MeshStandardMaterial({
    color: '#dedfc9',
    roughness: 0.55,
    transparent: true,
    opacity: 0.84,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (const side of [-1, 1])
    scene.add(
      new THREE.Mesh(
        strip(R + side * (HALF - 1) - 0.07, R + side * (HALF - 1) + 0.07, 0.028),
        marking,
      ),
    );
  const dummy = new THREE.Object3D(),
    dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 3.1), marking, 110);
  for (let i = 0; i < 110; i++) {
    const a = (i / 110) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * R, 0.029, Math.sin(a) * R);
    dummy.rotation.set(-Math.PI / 2, 0, Math.PI - a);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  scene.add(dashes);
  // Real pedestrian crossings and feeder streets at four landmarks. Race limits remain unchanged.
  const crossing = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.05, 4), marking, 56);
  let index = 0;
  for (let cp = 0; cp < 4; cp++)
    for (let i = 0; i < 14; i++) {
      const a = (cp * Math.PI) / 2 + 0.09,
        r = R - 10 + i * 1.5;
      dummy.position.set(Math.cos(a) * r, 0.032, Math.sin(a) * r);
      dummy.rotation.set(-Math.PI / 2, 0, Math.PI - a);
      dummy.updateMatrix();
      crossing.setMatrixAt(index++, dummy.matrix);
    }
  scene.add(crossing);
  // A curated district, not random towers: authored architectural blocks face the boulevard.
  const cityMaterials = new Map<THREE.Material, THREE.Material>();
  const blockCache = new Map<THREE.Object3D, THREE.Group>();
  function block(template: THREE.Object3D, scale: number) {
    const cached = blockCache.get(template);
    if (cached) return cached.clone(true);
    const model = new THREE.Group();
    model.add(template.clone(true));
    model.scale.setScalar(scale);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const original = o.material as THREE.MeshStandardMaterial;
        let m = cityMaterials.get(original) as THREE.MeshStandardMaterial | undefined;
        if (!m) {
          m = original.clone();
          m.color.multiply(new THREE.Color('#b3c1cc'));
          m.envMapIntensity = 0.45;
          if (tier === 'low') m.normalMap = null;
          if (/Curtains/.test(m.name)) {
            m.emissive.set('#ffba71');
            m.emissiveMap = m.map;
            m.emissiveIntensity = 0.65;
          }
          cityMaterials.set(original, m);
        }
        o.material = m;
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    const batch = batchStaticMeshes(model);
    batch.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = true;
    });
    blockCache.set(template, model);
    return model.clone(true);
  }
  const names = ['Bistro_S1B1', 'Bistro_S1B2', 'Bistro_S2B1'];
  const placements = [
    ...Array.from({ length: 8 }, (_, i) => ({ a: -0.12 + i * 0.24, side: 1, variant: i % 3 })),
    ...Array.from({ length: 5 }, (_, i) => ({
      a: -0.1 + i * 0.39,
      side: -1,
      variant: (i + 1) % 3,
    })),
    ...Array.from({ length: 8 }, (_, i) => ({ a: 1.9 + i * 0.55, side: 1, variant: i % 3 })),
  ];
  for (const p of placements) {
    const name = names[p.variant],
      source = assets.district.scene.getObjectByName(name),
      low = assets.districtLow.scene.getObjectByName(name);
    if (!source || !low) throw Error('Reviewed Bistro model missing: ' + name);
    const lod = new THREE.LOD();
    lod.addLevel(block(source, 1), 0);
    if (tier !== 'low') lod.addLevel(block(low, 1), 95);
    const radius = p.side > 0 ? 125 : 71;
    lod.position.set(Math.cos(p.a) * radius, 0, Math.sin(p.a) * radius);
    // Reviewed source façades: S1B1/S2B1 face +Z; S1B2 windows face -X.
    lod.rotation.y =
      -p.a + (p.side > 0 ? -Math.PI / 2 : Math.PI / 2) + (p.variant === 1 ? Math.PI / 2 : 0);
    scene.add(lod);
    if (p.a < 1.4 && p.side > 0) {
      const shop = sign(
        ['ATELIER / 24', 'CAFÉ NORD', 'LATE / SERVICE'][p.variant],
        p.variant === 1 ? '#e9c293' : '#a6c6df',
      );
      shop.scale.set(0.65, 0.65, 1);
      shop.position.set(Math.cos(p.a) * 116.5, 3.3, Math.sin(p.a) * 116.5);
      shop.rotation.y = -p.a - Math.PI / 2;
      scene.add(shop);
    }
  }
  const terrace = assets.district.scene.getObjectByName('Bistro_BistroProps');
  if (terrace)
    for (const a of [0.15, 0.73, 1.25]) {
      const props = block(terrace, 1);
      props.position.set(Math.cos(a) * 114.8, 0.22, Math.sin(a) * 114.8);
      props.rotation.y = -a;
      scene.add(props);
    }
  // Swept lamp geometry with fixture lens, feet and curved arm, instanced along both sidewalks.
  const metal = new THREE.MeshStandardMaterial({
    color: '#303a40',
    roughness: 0.44,
    metalness: 0.7,
  });
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 6, 0),
    new THREE.Vector3(-0.35, 7.4, 0),
    new THREE.Vector3(-2.8, 7.6, 0),
  ]);
  const pole = new THREE.TubeGeometry(path, 18, 0.085, 6, false);
  const poles = new THREE.InstancedMesh(pole, metal, 64),
    bulbs = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.15, 0.65, 3, 6),
      new THREE.MeshStandardMaterial({
        color: '#fae2b3',
        emissive: '#ffd49b',
        emissiveIntensity: 4,
      }),
      64,
    );
  const lampPositions: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (Math.floor(i / 2) / 32) * Math.PI * 2,
      r = R + (i % 2 ? 1 : -1) * (HALF + 3);
    dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    dummy.rotation.set(0, -a + (i % 2 ? 0 : Math.PI), 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    const pos = new THREE.Vector3(-2.5, 7.6, 0).applyMatrix4(dummy.matrix);
    lampPositions.push(pos);
    dummy.position.copy(pos);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.updateMatrix();
    bulbs.setMatrixAt(i, dummy.matrix);
  }
  scene.add(poles, bulbs);
  const lamps = Array.from({ length: preset.lamps }, () => {
    const l = new THREE.PointLight('#ffcea1', 95, 25, 2);
    scene.add(l);
    return l;
  });
  const rail = new THREE.CatmullRomCurve3(
    Array.from(
      { length: 193 },
      (_, i) =>
        new THREE.Vector3(
          Math.cos((i / 192) * Math.PI * 2) * (R + HALF + 0.6),
          0.72,
          Math.sin((i / 192) * Math.PI * 2) * (R + HALF + 0.6),
        ),
    ),
  );
  const railMesh = new THREE.Mesh(new THREE.TubeGeometry(rail, 256, 0.12, 5, false), metal);
  scene.add(railMesh);
  const boards = ['NEXUS / AFTER HOURS', 'NORTH QUARTER', 'RIVERSIDE / 03', 'OLD TOWN / 04'];
  for (let cp = 0; cp < 4; cp++) {
    const a = (cp * Math.PI) / 2 + 0.34,
      board = sign(boards[cp], cp % 2 ? '#a6ccf0' : '#d8ec98');
    board.position.set(Math.cos(a) * (R + HALF + 3), 5.4, Math.sin(a) * (R + HALF + 3));
    board.rotation.y = Math.PI - a;
    scene.add(board);
    const poleA = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 5, 8), metal);
    poleA.position.copy(board.position).add(new THREE.Vector3(0, -2.5, 0));
    scene.add(poleA);
  }
  const start = sign('MIDNIGHT / OUTLAWS', '#f2ebc8');
  start.position.set(R + HALF + 2, 3, -8);
  start.rotation.y = Math.PI;
  scene.add(start);
  // Static kerb reflectors are a single instanced draw, without hundreds of point lights.
  const studs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.09, 5, 3),
    new THREE.MeshStandardMaterial({ color: '#f0d28f', emissive: '#f5bd62', emissiveIntensity: 2 }),
    160,
  );
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * (R - HALF + 0.65), 0.06, Math.sin(a) * (R - HALF + 0.65));
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    studs.setMatrixAt(i, dummy.matrix);
  }
  scene.add(studs);
  const headlamps = [-0.65, 0.65].map((x) => {
    const l = new THREE.SpotLight('#cfe7ff', 220, 36, 0.36, 0.7, 2);
    scene.add(l, l.target);
    return { x, light: l };
  });
  const rear = new THREE.PointLight('#ff2920', 0, 6, 2);
  scene.add(rear);
  const cameraTarget = new THREE.Vector3();
  const effects = createRoadEffects(scene, tier);
  return {
    update(race: RaceState, braking: boolean, dt: number, boost: boolean) {
      effects.update(race, braking, dt, boost);
      key.position.set(race.x - 30, 55, race.z + 20);
      key.target.position.set(race.x, 0, race.z);
      key.target.updateMatrixWorld();
      const ordered = lampPositions
        .map((p, i) => ({ p, i, d: p.distanceToSquared(cameraTarget.set(race.x, 0, race.z)) }))
        .sort((a, b) => a.d - b.d);
      lamps.forEach((l, i) => l.position.copy(ordered[i].p));
      for (const { x, light } of headlamps) {
        light.position.set(
          race.x + Math.sin(race.heading) * 2.6 + Math.cos(race.heading) * x,
          0.75,
          race.z + Math.cos(race.heading) * 2.6 - Math.sin(race.heading) * x,
        );
        light.target.position.set(
          race.x + Math.sin(race.heading) * 21,
          0.02,
          race.z + Math.cos(race.heading) * 21,
        );
        light.target.updateMatrixWorld();
      }
      rear.position.set(
        race.x - Math.sin(race.heading) * 3.6,
        0.2,
        race.z - Math.cos(race.heading) * 3.6,
      );
      rear.intensity = braking ? 1.8 : 0;
    },
    dispose() {
      environment.dispose();
    },
  };
}
function createRoadEffects(scene: THREE.Scene, tier: RenderTier) {
  const vertices = new Float32Array(256 * 18),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setDrawRange(0, 0);
  const marks = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: '#060b0e',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marks.frustumCulled = false;
  scene.add(marks);
  const count = tier === 'low' ? 100 : 300,
    data = new Float32Array(count * 3);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() - 0.5) * 35;
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  const rain = new THREE.Points(
    rainGeometry,
    new THREE.PointsMaterial({
      color: '#b8cddd',
      size: 0.035,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  );
  rain.frustumCulled = false;
  scene.add(rain);
  const jets = new THREE.Group(),
    glow = new THREE.MeshBasicMaterial({
      color: '#a5e1ff',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
  for (const x of [-0.5, 0.5]) {
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.6, 6), glow);
    jet.rotation.x = -Math.PI / 2;
    jet.position.set(x, 0.36, -2.1);
    jets.add(jet);
  }
  scene.add(jets);
  let offset = 0,
    last: THREE.Vector3 | null = null;
  return {
    update(race: RaceState, braking: boolean, dt: number, boost: boolean) {
      rain.position.set(race.x, 7, race.z);
      for (let i = 1; i < data.length; i += 3) {
        data[i] -= dt * 14;
        if (data[i] < -17.5) data[i] = 17.5;
      }
      rainGeometry.attributes.position.needsUpdate = true;
      jets.position.set(race.x, 0, race.z);
      jets.rotation.y = race.heading;
      jets.visible = boost;
      if (braking && race.speed > 9) {
        const point = new THREE.Vector3(
          race.x - Math.sin(race.heading) * 1.5,
          0.043,
          race.z - Math.cos(race.heading) * 1.5,
        );
        if (last && point.distanceTo(last) < 4) {
          for (const side of [-1, 1]) {
            const axis = new THREE.Vector3(
                Math.cos(race.heading) * side * 0.9,
                0,
                -Math.sin(race.heading) * side * 0.9,
              ),
              width = new THREE.Vector3(
                Math.cos(race.heading) * 0.09,
                0,
                -Math.sin(race.heading) * 0.09,
              ),
              a = last.clone().add(axis),
              b = point.clone().add(axis);
            for (const p of [
              a.clone().sub(width),
              b.clone().sub(width),
              b.clone().add(width),
              a.clone().sub(width),
              b.clone().add(width),
              a.clone().add(width),
            ])
              for (const v of [p.x, p.y, p.z]) vertices[offset++ % vertices.length] = v;
          }
          geometry.attributes.position.needsUpdate = true;
          geometry.setDrawRange(0, Math.min(vertices.length / 3, offset / 3));
        }
        last = point;
      } else last = null;
    },
  };
}
