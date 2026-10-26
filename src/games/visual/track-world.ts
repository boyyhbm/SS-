import * as THREE from 'three';
import { getTrack, type TrackId } from '../tracks/registry';
import {
  roadSectionPoint,
  projectRoad,
  sampleRoadDistance,
  type RoadSection,
} from '../tracks/geometry';
import { asphaltMaterial } from './city-world';
import { createShadowLighting } from './lighting';
import { qualityPresets, type RenderTier } from './quality';
import type { RaceAssets } from './assets';
import type { RaceState } from '../racing-physics';
import propsManifest from '../../../public/game-assets/track-manifest.json';
import { avoidCameraObstacles } from './camera';
type Placement = { x: number; y: number; z: number; heading: number; height: number };
function ribbon(
  sections: RoadSection[],
  a: (p: RoadSection) => number,
  b: (p: RoadSection) => number,
  lift: number,
  predicate?: (p: RoadSection) => boolean,
) {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const p = sections[i];
    for (const d of [a(p), b(p)]) {
      const q = roadSectionPoint(p, d, lift);
      positions.push(q.x, q.y, q.z);
      uv.push(d / 6, p.s / 6);
    }
    if (i < sections.length - 1 && (!predicate || predicate(p))) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function createTrackWorld(
  scene: THREE.Scene,
  assets: RaceAssets,
  tier: RenderTier,
  renderer: THREE.WebGLRenderer,
  trackId: TrackId,
) {
  const track = getTrack(trackId),
    road = track.roadGeometry,
    preset = qualityPresets[tier],
    mountain = track.environment === 'mountain',
    coast = track.environment === 'coast';
  const root = new THREE.Group();
  root.name = track.trackName;
  scene.add(root);
  scene.background = new THREE.Color(mountain ? '#182a3a' : coast ? '#b6b2a1' : '#748b9a');
  scene.fog = new THREE.FogExp2(mountain ? '#364654' : '#899ba4', tier === 'low' ? 0.006 : 0.00165);
  const ambient = new THREE.HemisphereLight(
    mountain ? '#b3c8e0' : '#d6e2eb',
    '#454632',
    mountain ? 0.9 : 1.5,
  );
  scene.add(ambient);
  const lighting = createShadowLighting(
    scene,
    tier,
    mountain ? '#b7cceb' : '#ffdec0',
    mountain ? 1.5 : 2.7,
    new THREE.Vector3(-35, 65, 25),
  );
  const pmrem = new THREE.PMREMGenerator(renderer),
    environment = pmrem.fromEquirectangular(assets.environment);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = mountain ? 0.5 : 0.65;
  const ownedGeometry: THREE.BufferGeometry[] = [],
    ownedMaterial: THREE.Material[] = [],
    ownedTextures: THREE.Texture[] = [],
    clusters: { group: THREE.Group; x: number; z: number; radius: number }[] = [],
    cameraBoxes: THREE.Box3[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, shadows = true) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = shadows;
    root.add(mesh);
    ownedGeometry.push(geometry);
    return mesh;
  };
  const asphalt = asphaltMaterial(assets, tier);
  asphalt.roughness = mountain ? 0.73 : 0.79;
  asphalt.envMapIntensity = 0.3;
  ownedMaterial.push(asphalt);
  add(
    ribbon(
      road.sections,
      (p) => -p.width / 2,
      (p) => p.width / 2,
      0,
    ),
    asphalt,
    false,
  );
  const white = new THREE.MeshStandardMaterial({
    color: '#d3d3c6',
    roughness: 0.72,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const red = new THREE.MeshStandardMaterial({ color: '#8b302b', roughness: 0.7 });
  ownedMaterial.push(white, red);
  for (const side of [-1, 1]) {
    add(
      ribbon(
        road.sections,
        (p) => side * (p.width / 2 - 0.35) - 0.06,
        (p) => side * (p.width / 2 - 0.35) + 0.06,
        0.025,
      ),
      white,
      false,
    );
    if (track.kind === 'circuit')
      for (const [mat, alternate] of [
        [white, 0],
        [red, 1],
      ] as const)
        add(
          ribbon(
            road.sections,
            (p) => (side * p.width) / 2 - 0.32,
            (p) => (side * p.width) / 2 + 0.32,
            0.07,
            (p) => Math.floor(p.s / 4.5) % 2 === alternate,
          ),
          mat,
          false,
        );
  }
  if (mountain || coast)
    add(
      ribbon(
        road.sections,
        () => -0.06,
        () => 0.06,
        0.025,
        (p) => Math.floor(p.s / 4.5) % 2 === 0,
      ),
      white,
      false,
    );
  // Fine continuous terrain, graded from the exact road surface near its corridor.
  const xs = road.sections.map((p) => p.x),
    zs = road.sections.map((p) => p.z),
    minX = Math.min(...xs) - 170,
    maxX = Math.max(...xs) + 170,
    minZ = Math.min(...zs) - 170,
    maxZ = Math.max(...zs) + 170;
  function terrainHeight(x: number, z: number) {
    if (coast) {
      const near = projectRoad(road, x, z),
        d = Math.max(0, Math.abs(near.lateral) - near.width / 2);
      const distant =
        near.lateral > 0 ? -4 : near.y + 18 + Math.sin(x * 0.009) * 13 + Math.cos(z * 0.017) * 9;
      return THREE.MathUtils.lerp(near.height - 0.6, distant, THREE.MathUtils.smoothstep(d, 4, 75));
    }
    if (!mountain) return -0.4 + Math.sin(x * 0.008) * Math.cos(z * 0.009) * 0.2;
    const near = projectRoad(road, x, z),
      d = Math.max(0, Math.abs(near.lateral) - near.width / 2),
      blend = THREE.MathUtils.smoothstep(d, 6, 95);
    const ridge =
      near.y +
      8 +
      Math.sin(x * 0.012 + z * 0.003) * 28 +
      Math.cos(z * 0.014) * 20 +
      Math.sin(x * 0.037) * Math.cos(z * 0.031) * 5;
    return THREE.MathUtils.lerp(near.height - 1.1, ridge, blend);
  }
  // Graded, continuous shoulders meet the same banked edge as the asphalt.
  // A low-resolution terrain cell must never leave a visible gap under the road.
  const shoulderMaterial = new THREE.MeshStandardMaterial({
    color: mountain ? '#625f51' : '#777a69',
    roughness: 0.96,
  });
  ownedMaterial.push(shoulderMaterial);
  for (const side of [-1, 1]) {
    const shoulder = ribbon(
      road.sections,
      (p) => (side * p.width) / 2,
      (p) => side * (p.width / 2 + 4),
      -0.015,
    );
    const attribute = shoulder.getAttribute('position');
    for (let i = 1; i < attribute.count; i += 2)
      attribute.setY(i, terrainHeight(attribute.getX(i), attribute.getZ(i)));
    shoulder.computeVertexNormals();
    add(shoulder, shoulderMaterial, false);
  }
  const resolution = tier === 'low' ? 96 : tier === 'medium' ? 144 : 208,
    positions: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const grass = new THREE.Color(mountain ? '#3b4636' : coast ? '#65734d' : '#566349'),
    stone = new THREE.Color('#6c6c60'),
    color = new THREE.Color();
  for (let j = 0; j <= resolution; j++)
    for (let i = 0; i <= resolution; i++) {
      const x = minX + ((maxX - minX) * i) / resolution,
        z = minZ + ((maxZ - minZ) * j) / resolution,
        y = terrainHeight(x, z);
      positions.push(x, y, z);
      uvs.push(x / 5, z / 5);
      const slope =
        mountain || coast
          ? Math.min(
              1,
              (Math.abs(terrainHeight(x + 1, z) - y) + Math.abs(terrainHeight(x, z + 1) - y)) * 0.7,
            )
          : 0;
      color.copy(grass).lerp(stone, slope);
      colors.push(color.r, color.g, color.b);
      if (i < resolution && j < resolution) {
        const n = j * (resolution + 1) + i;
        indices.push(n, n + resolution + 1, n + 1, n + 1, n + resolution + 1, n + resolution + 2);
      }
    }
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  terrainGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrainGeometry.setIndex(indices);
  terrainGeometry.computeVertexNormals();
  const ground = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    normalMap: assets.normal,
    normalScale: new THREE.Vector2(0.28, 0.28),
  });
  ownedMaterial.push(ground);
  add(terrainGeometry, ground, false);
  if (coast) {
    const size = 128,
      data = new Uint8Array(size * size * 4);
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const a = (x / size) * Math.PI * 2,
          b = (z / size) * Math.PI * 2,
          i = (z * size + x) * 4;
        const nx = 0.12 * Math.cos(a * 3 + b * 2) + 0.06 * Math.cos(a * 7 - b * 3),
          ny = 0.09 * Math.sin(b * 4 + a) + 0.04 * Math.sin(a * 5 + b * 6);
        data[i] = Math.round(128 + nx * 127);
        data[i + 1] = Math.round(128 + ny * 127);
        data[i + 2] = 250;
        data[i + 3] = 255;
      }
    const normal = new THREE.DataTexture(data, size, size);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(250, 250);
    normal.needsUpdate = true;
    ownedTextures.push(normal);
    const water = new THREE.MeshPhysicalMaterial({
      color: '#284d55',
      metalness: 0.05,
      roughness: 0.26,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      envMapIntensity: 0.65,
      clearcoat: 0.25,
      clearcoatRoughness: 0.3,
    });
    ownedMaterial.push(water);
    const sea = add(new THREE.PlaneGeometry(18000, 18000), water, false);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set((minX + maxX) / 2, -0.2, (minZ + maxZ) / 2);
    // An original, open-ended arched tunnel follows the actual elevated road.
    const tunnelPositions: number[] = [],
      tunnelUV: number[] = [],
      tunnelIndices: number[] = [],
      cross = 18,
      steps = 40,
      start = road.length * 0.61,
      span = 85;
    for (let i = 0; i <= steps; i++) {
      const p = sampleRoadDistance(road, start + (span * i) / steps),
        radius = p.width / 2 + 1.25;
      for (let j = 0; j <= cross; j++) {
        const theta = (Math.PI * j) / cross,
          lateral = -Math.cos(theta) * radius,
          q = roadSectionPoint(p, lateral);
        tunnelPositions.push(q.x, q.y + Math.sin(theta) * radius + 2.7, q.z);
        tunnelUV.push((j / cross) * 5, (i / steps) * 12);
        if (i < steps && j < cross) {
          const n = i * (cross + 1) + j;
          tunnelIndices.push(n, n + cross + 1, n + 1, n + 1, n + cross + 1, n + cross + 2);
        }
      }
    }
    const tunnelGeometry = new THREE.BufferGeometry();
    tunnelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tunnelPositions, 3));
    tunnelGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(tunnelUV, 2));
    tunnelGeometry.setIndex(tunnelIndices);
    tunnelGeometry.computeVertexNormals();
    const concrete = new THREE.MeshStandardMaterial({
      color: '#777769',
      roughness: 0.92,
      normalMap: assets.pavement.normal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      side: THREE.DoubleSide,
    });
    ownedMaterial.push(concrete);
    add(tunnelGeometry, concrete);
    for (const side of [-1, 1]) {
      const sections = road.sections.filter((p) => p.s >= start && p.s <= start + span);
      const wall = ribbon(
        sections,
        (p) => side * (p.width / 2 + 1.25),
        (p) => side * (p.width / 2 + 1.25),
        0,
      );
      const v = wall.getAttribute('position');
      for (let i = 1; i < v.count; i += 2) v.setY(i, v.getY(i) + 2.7);
      wall.computeVertexNormals();
      add(wall, concrete);
    }
  }
  function instances(name: string, placements: Placement[]) {
    const asset = assets.trackProps[name];
    if (!asset || !placements.length) return;
    const metadata = propsManifest.models[name as keyof typeof propsManifest.models],
      bounds = metadata.bounds,
      h = bounds.max[1] - bounds.min[1] || 1;
    asset.scene.updateMatrixWorld(true);
    const normalization = new THREE.Matrix4().makeTranslation(
      -(bounds.min[0] + bounds.max[0]) / 2,
      -bounds.min[1],
      -(bounds.min[2] + bounds.max[2]) / 2,
    );
    const source: THREE.Mesh[] = [];
    asset.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) source.push(o);
    });
    for (let offset = 0; offset < placements.length; offset += 48) {
      const batch = placements.slice(offset, offset + 48),
        group = new THREE.Group(),
        dummy = new THREE.Object3D(),
        matrix = new THREE.Matrix4();
      for (const original of source) {
        const mesh = new THREE.InstancedMesh(original.geometry, original.material, batch.length);
        mesh.castShadow = preset.shadows;
        mesh.receiveShadow = true;
        for (let i = 0; i < batch.length; i++) {
          const p = batch[i];
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, p.heading, 0);
          dummy.scale.setScalar(p.height / h);
          dummy.updateMatrix();
          matrix.copy(dummy.matrix).multiply(normalization).multiply(original.matrixWorld);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
      root.add(group);
      const box = new THREE.Box3().setFromObject(group),
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3());
      clusters.push({ group, x: center.x, z: center.z, radius: Math.hypot(size.x, size.z) / 2 });
    }
  }
  const barriers: Placement[] = [],
    lamps: Placement[] = [],
    treesA: Placement[] = [],
    treesB: Placement[] = [],
    rocks: Placement[] = [];
  const barrier = propsManifest.models.barrierWall,
    barrierLength =
      ((barrier.bounds.max[0] - barrier.bounds.min[0]) /
        (barrier.bounds.max[1] - barrier.bounds.min[1])) *
      0.8;
  for (let s = 0; s < road.length; s += Math.max(1, barrierLength * 0.94)) {
    const p = sampleRoadDistance(road, s);
    for (const side of [-1, 1]) {
      const q = roadSectionPoint(p, side * (p.width / 2 + 0.45));
      barriers.push({ ...q, heading: Math.atan2(p.tx, p.tz) - Math.PI / 2, height: 0.8 });
    }
  }
  if (assets.trackProps.barrierWall) instances('barrierWall', barriers);
  for (let s = 12; s < road.length; s += mountain ? 70 : 100) {
    const p = sampleRoadDistance(road, s),
      q = roadSectionPoint(p, p.width / 2 + 3);
    lamps.push({ ...q, heading: Math.atan2(p.tx, p.tz) + Math.PI, height: 7 });
  }
  instances('lightPostModern', lamps);
  if (mountain || coast) {
    for (let s = 0; s < road.length; s += 12 / Math.max(0.25, preset.vegetation)) {
      const p = sampleRoadDistance(road, s);
      for (const side of coast ? [-1] : [-1, 1]) {
        const lateral = side * (p.width / 2 + 15 + 7 * Math.sin(s * 0.07)),
          q = roadSectionPoint(p, lateral);
        q.y = terrainHeight(q.x, q.z);
        (Math.floor(s / 30) % 2 ? treesA : treesB).push({
          ...q,
          heading: s * 0.13,
          height: 5 + Math.sin(s * 0.09) * 1.4,
        });
      }
    }
    for (let s = 25; s < road.length; s += 23) {
      const p = sampleRoadDistance(road, s),
        q = roadSectionPoint(p, -p.width / 2 - 4);
      q.y = terrainHeight(q.x, q.z);
      rocks.push({ ...q, heading: s * 0.03, height: 1.4 + Math.abs(Math.sin(s * 0.05)) * 1.7 });
    }
    instances(coast ? 'tree_palm' : 'tree_pineDefaultA', treesA);
    instances(coast ? 'tree_palm' : 'tree_pineRoundA', treesB);
    instances('rock_largeA', rocks);
  } else {
    for (const [s, lateral, name, height] of [
      [100, 32, 'grandStandCovered', 8],
      [260, -28, 'pitsGarage', 5],
      [440, 30, 'grandStandCovered', 6],
    ] as const) {
      const p = sampleRoadDistance(road, s),
        q = roadSectionPoint(p, lateral);
      instances(name, [
        {
          ...q,
          heading: Math.atan2(p.tx, p.tz) + (lateral > 0 ? -Math.PI / 2 : Math.PI / 2),
          height,
        },
      ]);
    }
    const p = sampleRoadDistance(road, 18),
      meta = propsManifest.models.overheadLights,
      height =
        ((p.width + 2) / (meta.bounds.max[0] - meta.bounds.min[0])) *
        (meta.bounds.max[1] - meta.bounds.min[1]);
    instances('overheadLights', [
      { x: p.x, y: p.y, z: p.z, heading: Math.atan2(p.tx, p.tz), height },
    ]);
  }
  // Painted grid boxes use the actual registered start positions, not visual cars.
  for (const p of track.startGrid) {
    const g = new THREE.PlaneGeometry(2.8, 0.12),
      mesh = add(g, white, false);
    mesh.rotation.set(-Math.PI / 2, 0, -p.heading);
    mesh.position.set(p.x, p.y + 0.03, p.z - 1.7 * Math.cos(p.heading));
  }
  const headlights = [-0.65, 0.65].map((side) => {
    const light = new THREE.SpotLight('#e4efff', 28, 90, Math.PI / 7, 0.65, 1.8);
    light.layers.set(1);
    scene.add(light, light.target);
    return { light, side };
  });
  let capture = false;
  return {
    reflectionMaterials: [asphalt],
    prepareCapture() {
      capture = true;
      clusters.forEach((c) => (c.group.visible = true));
    },
    update(state: RaceState) {
      const y = state.y ?? 0;
      lighting.update(state.x, state.z, y);
      if (!capture)
        for (const c of clusters)
          c.group.visible =
            Math.hypot(c.x - state.x, c.z - state.z) < preset.cityDistance + c.radius;
      for (const { light, side } of headlights) {
        light.visible = !capture;
        light.position.set(
          state.x + Math.cos(state.heading) * side,
          y + 0.65,
          state.z - Math.sin(state.heading) * side,
        );
        light.target.position.set(
          state.x + Math.sin(state.heading) * 35,
          y + 0.3,
          state.z + Math.cos(state.heading) * 35,
        );
      }
      capture = false;
    },
    clipCamera(target: THREE.Vector3, desired: THREE.Vector3) {
      avoidCameraObstacles(target, desired, cameraBoxes);
      desired.y = Math.max(desired.y, terrainHeight(desired.x, desired.z) + 0.7);
    },
    dispose() {
      lighting.dispose();
      environment.dispose();
      root.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      scene.remove(root, ambient);
      for (const { light } of headlights) scene.remove(light, light.target);
      ownedGeometry.forEach((g) => g.dispose());
      ownedMaterial.forEach((m) => m.dispose());
      ownedTextures.forEach((t) => t.dispose());
    },
  };
}
