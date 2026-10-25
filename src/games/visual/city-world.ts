import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RaceAssets } from './assets';
import { qualityPresets, type RenderTier } from './quality';
import { batchStaticMeshes } from './geometry';
import { createCar } from './car';
import { addStreetFurniture } from './street-furniture';
import { avoidCameraObstacles } from './camera';
import {
  cityParkedCars,
  roadNodes,
  roadEdges,
  edgeLength,
  sampleRoad,
  getCityRoute,
  type CityRouteId,
  type Point,
} from '../road-network';
import { roadSurfaces, polygonSurface, curbGeometry, createRoadMarkings } from './roads';
import type { RaceState } from '../racing-physics';

export function asphaltMaterial(assets: RaceAssets, tier: RenderTier) {
  const m = tier === 'low' ? new THREE.MeshStandardMaterial() : new THREE.MeshPhysicalMaterial();
  m.map = assets.color;
  m.normalMap = assets.normal;
  m.normalScale.set(0.2, 0.2);
  m.roughnessMap = assets.roughness;
  m.roughness = 0.94;
  m.metalness = 0;
  m.envMapIntensity = 0.65;
  if (m instanceof THREE.MeshPhysicalMaterial) {
    m.clearcoat = 0.12;
    m.clearcoatRoughness = 0.38;
  }
  // World-space low-amplitude variation suppresses the tile grid without binary
  // puddle masks or a second, sharp planar reflection render.
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 asphaltWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nasphaltWorld=(modelMatrix*vec4(transformed,1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 asphaltWorld;')
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nfloat damp=0.5+0.25*sin(asphaltWorld.x*0.027+sin(asphaltWorld.z*0.019))+0.25*sin(asphaltWorld.z*0.033);\nroughnessFactor=clamp(roughnessFactor-0.075*damp,0.5,0.88);\ndiffuseColor.rgb*=0.94+0.06*sin(asphaltWorld.x*0.113+asphaltWorld.z*0.079);',
      );
  };
  m.customProgramCacheKey = () => 'nexus-asphalt-2';
  return m;
}
function label(text: string, width = 5, color = '#e9dfa8') {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#172223';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 996, 228);
  ctx.fillStyle = color;
  ctx.font = '600 66px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 128, 920);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshStandardMaterial({
      map: t,
      emissiveMap: t,
      emissive: '#e9d4a5',
      emissiveIntensity: 0.32,
      roughness: 0.7,
      side: THREE.FrontSide,
    }),
  );
}
type Placement = Point & { yaw: number; scale?: number; height?: number };
export function createCityWorld(
  scene: THREE.Scene,
  assets: RaceAssets,
  tier: RenderTier,
  renderer: THREE.WebGLRenderer,
) {
  const preset = qualityPresets[tier];
  scene.background = new THREE.Color('#0b151f');
  scene.fog = new THREE.FogExp2('#17252c', tier === 'low' ? 0.0046 : 0.0026);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(60, preset.cityDistance * 0.7), 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 skyDirection;void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:
        'varying vec3 skyDirection;void main(){vec3 n=normalize(skyDirection);float h=pow(max(n.y,0.0),0.45);vec3 color=mix(vec3(0.045,0.065,0.075),vec3(0.006,0.014,0.028),h);float moon=smoothstep(0.9997,0.99986,dot(n,normalize(vec3(-0.5,0.75,-0.3))));gl_FragColor=vec4(color+vec3(0.38,0.39,0.35)*moon,1.0);\n#include <colorspace_fragment>\n}',
    }),
  );
  scene.add(sky);
  scene.add(new THREE.HemisphereLight('#9badc7', '#65513b', 0.6));
  const key = new THREE.DirectionalLight('#d0d5d4', 0.8);
  key.position.set(-30, 45, -18);
  key.castShadow = preset.shadows;
  key.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024);
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.0003;
  Object.assign(key.shadow.camera, {
    left: -28,
    right: 28,
    top: 28,
    bottom: -28,
    near: 1,
    far: 110,
  });
  scene.add(key, key.target);
  const pmrem = new THREE.PMREMGenerator(renderer),
    env = pmrem.fromEquirectangular(assets.environment);
  pmrem.dispose();
  scene.environment = env.texture;
  scene.environmentIntensity = 0.3;
  scene.environmentRotation.y = 0.9;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1700, 1500),
    new THREE.MeshStandardMaterial({ color: '#17231e', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.04, 40);
  ground.receiveShadow = true;
  scene.add(ground);
  const furnitureBoxes = addStreetFurniture(scene);
  const surfaces = roadSurfaces(),
    road = new THREE.Mesh(polygonSurface(surfaces.asphalt, 0.02), asphaltMaterial(assets, tier));
  road.receiveShadow = true;
  road.name = 'City_asphalt_union';
  scene.add(road);
  const pavement = new THREE.Mesh(
    polygonSurface(surfaces.sidewalk, 0.17),
    new THREE.MeshStandardMaterial({
      color: '#727776',
      roughness: 0.88,
      normalMap: assets.normal,
      normalScale: new THREE.Vector2(0.1, 0.1),
    }),
  );
  pavement.receiveShadow = true;
  scene.add(pavement);
  const kerb = new THREE.Mesh(
    curbGeometry(surfaces.asphalt),
    new THREE.MeshStandardMaterial({ color: '#a2a293', roughness: 0.84, side: THREE.DoubleSide }),
  );
  kerb.receiveShadow = true;
  scene.add(kerb);
  const lines = createRoadMarkings();
  for (const [name, color] of [
    ['white', '#d0d3c4'],
    ['yellow', '#bdab73'],
  ] as const) {
    const parts = lines[name],
      g = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.name = 'metric_' + name + '_markings';
    scene.add(mesh);
  }
  const colliders: THREE.Box3[] = [...furnitureBoxes],
    cityMaterials = new Map<THREE.Material, THREE.Material>(),
    templates = new Map<string, THREE.Group>();
  function template(name: string, low: boolean) {
    const cacheKey = name + low;
    const cached = templates.get(cacheKey);
    if (cached) return cached;
    const source = (low ? assets.districtLow : assets.district).scene.getObjectByName(name);
    if (!source) return undefined;
    const model = new THREE.Group();
    model.add(source.clone(true));
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const original = o.material as THREE.MeshStandardMaterial;
      let material = cityMaterials.get(original) as THREE.MeshStandardMaterial | undefined;
      if (!material) {
        material = original.clone();
        material.envMapIntensity = 0.35;
        if (tier === 'low') material.normalMap = null;
        if (/Curtain|Interior|Fabric/.test(material.name)) {
          material.emissive.set('#e7b17b');
          material.emissiveMap = material.map;
          material.emissiveIntensity = 0.32;
        }
        cityMaterials.set(original, material);
      }
      o.material = material;
    });
    batchStaticMeshes(model);
    templates.set(cacheKey, model);
    return model;
  }
  // Batch reviewed GLB façades by spatial block and material, with real LOD levels.
  // Each instance retains the authored doors, balconies, stonework and window UVs.
  function instances(name: string, placements: Placement[], buildings = true) {
    const cells = new Map<string, Placement[]>();
    for (const p of placements) {
      const cell = `${Math.floor(p.x / 60)},${Math.floor(p.z / 60)}`;
      cells.set(cell, [...(cells.get(cell) ?? []), p]);
    }
    for (const entries of cells.values()) {
      const center = new THREE.Vector3(
        entries.reduce((s, p) => s + p.x, 0) / entries.length,
        0,
        entries.reduce((s, p) => s + p.z, 0) / entries.length,
      );
      const lod = new THREE.LOD();
      lod.position.copy(center);
      for (const low of tier === 'low' ? [true] : [false, true]) {
        const source = template(name, low);
        if (!source) continue;
        const group = new THREE.Group();
        source.updateMatrixWorld(true);
        source.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const mesh = new THREE.InstancedMesh(o.geometry, o.material, entries.length),
            matrix = new THREE.Matrix4(),
            dummy = new THREE.Object3D();
          entries.forEach((p, i) => {
            dummy.position.set(p.x - center.x, 0.17, p.z - center.z);
            dummy.rotation.y = p.yaw;
            dummy.scale.set(p.scale ?? 1, (p.scale ?? 1) * (p.height ?? 1), p.scale ?? 1);
            dummy.updateMatrix();
            matrix.multiplyMatrices(dummy.matrix, o.matrixWorld);
            mesh.setMatrixAt(i, matrix);
          });
          mesh.receiveShadow = true;
          mesh.castShadow = buildings && tier === 'high' && !low;
          mesh.computeBoundingSphere();
          group.add(mesh);
        });
        lod.addLevel(group, low && tier !== 'low' ? 65 : 0);
      }
      scene.add(lod);
    }
  }
  const placements: Record<string, Placement[]> = {
    Bistro_S1B1: [],
    Bistro_S1B2: [],
    Bistro_S2B1: [],
    Bistro_S3B1: [],
    Bistro_S5B1: [],
  };
  for (const x of [-100, 30, 170])
    for (const z of [-40, 80]) {
      const industrial = x > 0;
      for (const side of [-1, 1])
        for (const dz of [-23, 23]) {
          const name = industrial
            ? dz < 0
              ? 'Bistro_S5B1'
              : 'Bistro_S3B1'
            : dz < 0
              ? 'Bistro_S1B1'
              : 'Bistro_S2B1';
          placements[name].push({
            x: x + side * 34,
            z: z + dz,
            yaw: (side * Math.PI) / 2,
            scale: industrial ? 1.05 : 1,
            height: industrial ? 0.65 : 1,
          });
        }
      for (const side of [-1, 1]) {
        const name = industrial ? 'Bistro_S3B1' : 'Bistro_S1B2';
        placements[name].push({
          x,
          z: z + side * 37,
          yaw: (side < 0 ? Math.PI : 0) + (name === 'Bistro_S1B2' ? Math.PI / 2 : 0),
          scale: industrial ? 1.05 : 1,
          height: industrial ? 0.8 : 1,
        });
      }
    }
  placements.Bistro_S1B1.push({ x: -230, z: -123, yaw: 0 }, { x: -225, z: 165, yaw: Math.PI });
  for (const [name, p] of Object.entries(placements)) {
    const source = template(name, tier === 'low');
    if (!source) throw Error('Reviewed city asset missing: ' + name);
    for (const item of p) {
      const clone = source.clone(true);
      clone.position.set(item.x, 0.17, item.z);
      clone.rotation.y = item.yaw;
      clone.scale.set(item.scale ?? 1, (item.scale ?? 1) * (item.height ?? 1), item.scale ?? 1);
      clone.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(clone);
      colliders.push(box);
    }
    instances(name, p);
  }
  instances(
    'Bistro_BistroProps',
    [
      { x: -128, z: -81, yaw: 0, scale: 0.7 },
      { x: -75, z: 121, yaw: Math.PI, scale: 0.7 },
      { x: -133, z: 42, yaw: Math.PI, scale: 0.7 },
    ],
    false,
  );
  instances(
    'Bistro_Tree',
    [
      { x: -333, z: -65, yaw: 0.6, scale: 0.8 },
      { x: -335, z: 65, yaw: 1.6, scale: 0.85 },
      { x: -262, z: 175, yaw: 2.6, scale: 0.9 },
      { x: -211, z: 204, yaw: 0.2, scale: 0.7 },
      { x: -100, z: -38, yaw: 0.4, scale: 0.65 },
      { x: -100, z: 84, yaw: 2, scale: 0.65 },
    ],
    false,
  );
  const cypresses: Placement[] = [];
  for (const e of roadEdges.filter((e) => e.district === 'downtown'))
    for (let s = 35; s < edgeLength(e) - 20; s += 40) {
      const p = sampleRoad(e, s, e.width / 2 + 1.5);
      cypresses.push({ x: p.x, z: p.z, yaw: s, scale: 0.65 });
    }
  instances('Bistro_Cypress', cypresses, false);
  instances(
    'Bistro_Hedge',
    [
      { x: -245, z: 161, yaw: Math.PI / 2, scale: 1.2 },
      { x: -238, z: 161, yaw: Math.PI / 2, scale: 1.2 },
      { x: -105, z: -25, yaw: Math.PI / 2, scale: 1.1 },
      { x: -98, z: -25, yaw: Math.PI / 2, scale: 1.1 },
    ],
    false,
  );
  // Shops are front-sided and face the carriageway; backside text is never mirrored.
  for (const p of [
    { x: -124, z: -83, yaw: Math.PI, text: 'ATELIER / 24' },
    { x: -67, z: 123, yaw: 0, text: 'CAFÉ NORD' },
    { x: 74, z: -83, yaw: Math.PI, text: 'DOCK 07 / SERVICE' },
    { x: 195, z: 123, yaw: 0, text: 'NEXUS / WORKS' },
    { x: -230, z: -112, yaw: 0, text: 'RIVERSIDE / NORD' },
  ]) {
    const s = label(p.text, 6);
    s.position.set(p.x, 3.1, p.z);
    s.rotation.y = p.yaw;
    scene.add(s);
  }
  // Swept authored fixtures: one instanced draw per material, no light per pole.
  const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 5.8, 0),
      new THREE.Vector3(-0.3, 6.9, 0),
      new THREE.Vector3(-2.4, 7, 0),
    ]),
    metal = new THREE.MeshStandardMaterial({ color: '#3a4143', metalness: 0.65, roughness: 0.55 });
  const fixturePositions: { point: THREE.Vector3; warm: boolean }[] = [],
    poleTransforms: THREE.Matrix4[] = [],
    dummy = new THREE.Object3D();
  for (const e of roadEdges)
    for (let s = 22; s < edgeLength(e) - 15; s += 36)
      for (const side of [-1, 1]) {
        const p = sampleRoad(e, s, side * (e.width / 2 + 1.3));
        dummy.position.set(p.x, 0.17, p.z);
        dummy.rotation.set(0, Math.atan2(p.tx, p.tz) + (side < 0 ? 0 : Math.PI), 0);
        dummy.updateMatrix();
        poleTransforms.push(dummy.matrix.clone());
        fixturePositions.push({
          point: new THREE.Vector3(-2.3, 7, 0).applyMatrix4(dummy.matrix),
          warm: e.district !== 'industrial',
        });
      }
  const poles = new THREE.InstancedMesh(
      new THREE.TubeGeometry(curve, 14, 0.075, 6, false),
      metal,
      poleTransforms.length,
    ),
    lenses = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.15, 0.55, 3, 6),
      new THREE.MeshStandardMaterial({
        color: '#f7dfb4',
        emissive: '#ffcf8e',
        emissiveIntensity: 2.4,
      }),
      poleTransforms.length,
    );
  poleTransforms.forEach((matrix, i) => {
    const foot = new THREE.Vector3().setFromMatrixPosition(matrix);
    colliders.push(
      new THREE.Box3(
        new THREE.Vector3(foot.x - 0.12, 0, foot.z - 0.12),
        new THREE.Vector3(foot.x + 0.12, 6.9, foot.z + 0.12),
      ),
    );
    poles.setMatrixAt(i, matrix);
    dummy.position.copy(fixturePositions[i].point);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.updateMatrix();
    lenses.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poles, lenses);
  const lamps = Array.from({ length: preset.lamps }, () => {
    const l = new THREE.PointLight('#f4c58f', 100, 28, 2);
    scene.add(l);
    return l;
  });
  // Crossroads receive traffic signals and readable district directions.
  for (const n of roadNodes.filter((n) => ['d0', 'd3', 'i2', 'r1'].includes(n.id))) {
    const board = label(
      n.id.startsWith('i') ? 'INDUSTRIAL →' : n.id.startsWith('r') ? 'DOWNTOWN →' : 'RIVERSIDE ←',
      5,
      '#bed7c0',
    );
    board.position.set(n.x + 13, 3.6, n.z + 13);
    board.rotation.y = Math.PI;
    scene.add(board);
    for (const side of [-1, 1]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 4.7, 7), metal);
      mast.position.set(n.x + side * 11, 2.5, n.z + side * 12);
      scene.add(mast);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.35), metal);
      housing.position.copy(mast.position).add(new THREE.Vector3(0, 1.5, 0));
      scene.add(housing);
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.1, 12),
        new THREE.MeshStandardMaterial({
          color: side > 0 ? '#76c498' : '#e27c58',
          emissive: side > 0 ? '#65d1a0' : '#df5142',
          emissiveIntensity: 1.7,
        }),
      );
      lens.position
        .copy(housing.position)
        .add(new THREE.Vector3(0, side > 0 ? -0.29 : 0.29, side * 0.19));
      if (side < 0) lens.rotation.y = Math.PI;
      scene.add(lens);
    }
  }
  // PBR metal covers and drainage slots, with actual geometry, sit flush with asphalt.
  const covers = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.016, 20),
    new THREE.MeshStandardMaterial({
      color: '#51534e',
      metalness: 0.72,
      roughness: 0.67,
      normalMap: assets.normal,
    }),
    roadEdges.length,
  );
  roadEdges.forEach((e, i) => {
    const p = sampleRoad(e, edgeLength(e) * 0.42, e.width * 0.25);
    dummy.position.set(p.x, 0.034, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    covers.setMatrixAt(i, dummy.matrix);
  });
  scene.add(covers);
  const parked = cityParkedCars.map((p) => ({ ...p, yaw: p.heading }));
  const parkedTemplate = createCar(assets.car.scene, true);
  parkedTemplate.update(0, 0, false, false, 0, 'silver');
  const batch = batchStaticMeshes(parkedTemplate.group);
  parkedTemplate.group.updateMatrixWorld(true);
  for (const p of parked) {
    const group = new THREE.Group();
    group.position.set(p.x, 0.04, p.z);
    group.rotation.y = p.yaw;
    parkedTemplate.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mesh = new THREE.Mesh(o.geometry, o.material);
      mesh.matrix.copy(o.matrixWorld);
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.castShadow = preset.shadows;
      group.add(mesh);
    });
    scene.add(group);
    colliders.push(new THREE.Box3().setFromObject(group));
  }
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 620),
    new THREE.MeshStandardMaterial({
      color: '#1e353e',
      roughness: 0.55,
      metalness: 0.13,
      normalMap: assets.normal,
      normalScale: new THREE.Vector2(0.08, 0.08),
      envMapIntensity: 0.45,
    }),
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(-378, -0.35, 35);
  scene.add(river);
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  let routeId: CityRouteId | undefined;
  const routeMaterial = new THREE.MeshStandardMaterial({
    color: '#c9db92',
    emissive: '#aabd73',
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const headlights = [-0.64, 0.64].map((x) => {
    const light = new THREE.SpotLight('#e0e8ee', 140, 38, 0.34, 0.7, 2);
    scene.add(light, light.target);
    return { x, light };
  });
  return {
    clipCamera(target: THREE.Vector3, desired: THREE.Vector3) {
      avoidCameraObstacles(target, desired, colliders);
    },
    setRoute(id: CityRouteId, checkpoint: number, free: boolean) {
      if (id !== routeId) {
        for (const child of routeGroup.children)
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        routeGroup.clear();
        routeId = id;
        const r = getCityRoute(id);
        for (const [i, g] of r.gates.entries()) {
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(g.halfWidth * 2, 0.45),
            routeMaterial,
          );
          mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(g.tx, g.tz));
          mesh.position.set(g.x, 0.05, g.z);
          mesh.userData.checkpoint = i + 1;
          routeGroup.add(mesh);
        }
      }
      for (const mesh of routeGroup.children)
        mesh.visible = !free && mesh.userData.checkpoint === checkpoint;
    },
    update(race: RaceState, braking: boolean, dt: number, boost: boolean) {
      sky.position.set(race.x, 0, race.z);
      void braking;
      void dt;
      void boost;
      key.position.set(race.x - 30, 45, race.z - 18);
      key.target.position.set(race.x, 0, race.z);
      const nearest = [...fixturePositions].sort(
        (a, b) =>
          a.point.distanceToSquared(new THREE.Vector3(race.x, 0, race.z)) -
          b.point.distanceToSquared(new THREE.Vector3(race.x, 0, race.z)),
      );
      lamps.forEach((lamp, i) => {
        lamp.position.copy(nearest[i].point);
        lamp.color.set(nearest[i].warm ? '#ffd19a' : '#dce3d4');
      });
      for (const { x, light } of headlights) {
        const sin = Math.sin(race.heading),
          cos = Math.cos(race.heading);
        light.position.set(race.x + cos * x + sin * 1.8, 0.65, race.z - sin * x + cos * 1.8);
        light.target.position.set(race.x + sin * 20, 0.01, race.z + cos * 20);
      }
    },
    dispose() {
      env.dispose();
      routeMaterial.dispose();
      batch.geometries.forEach((g) => g.dispose());
      parkedTemplate.dispose();
    },
  };
}
