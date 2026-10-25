import * as THREE from 'three';
import { batchStaticMeshes } from './geometry';
import { roadEdges, edgeLength, sampleRoad, cityParkedCars, type Point } from '../road-network';
// Small original street assets. Major architecture, vehicles and foliage remain
// reviewed glTF models; these meshes add functional street details at low draw cost.
export function addStreetFurniture(scene: THREE.Scene) {
  const cameraBoxes: THREE.Box3[] = [];
  const metal = new THREE.MeshStandardMaterial({
      color: '#4b5557',
      metalness: 0.62,
      roughness: 0.5,
    }),
    wood = new THREE.MeshStandardMaterial({ color: '#7b6247', roughness: 0.8 }),
    glass = new THREE.MeshPhysicalMaterial({
      color: '#a7c3c0',
      metalness: 0.08,
      roughness: 0.18,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.035) =>
    new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, r, 6, false);
  const rounded = (width: number, height: number, depth: number, r = 0.06) => {
    const s = new THREE.Shape(),
      x = -width / 2,
      y = -height / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + width - r, y);
    s.quadraticCurveTo(x + width, y, x + width, y + r);
    s.lineTo(x + width, y + height - r);
    s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    s.lineTo(x + r, y + height);
    s.quadraticCurveTo(x, y + height, x, y + height - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 4,
    });
  };
  const stop = new THREE.Group();
  for (const x of [-2.1, 2.1])
    for (const z of [0, 1.3]) {
      const m = new THREE.Mesh(
        tube(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 2.6, z), 0.05),
        metal,
      );
      stop.add(m);
    }
  const rear = new THREE.Mesh(rounded(4.1, 1.8, 0.015), glass);
  rear.position.set(0, 1.5, 1.3);
  stop.add(rear);
  for (const x of [-2.1, 2.1]) {
    const pane = new THREE.Mesh(rounded(1.2, 1.8, 0.015), glass);
    pane.rotation.y = Math.PI / 2;
    pane.position.set(x, 1.5, 0.65);
    stop.add(pane);
  }
  const roofPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.3, 2.65, -0.18),
    new THREE.Vector3(-2.3, 2.85, 0.6),
    new THREE.Vector3(-2.3, 2.65, 1.5),
  ]);
  const roofPoints = roofPath.getPoints(12),
    vertices: number[] = [];
  for (let i = 1; i < roofPoints.length; i++) {
    const a = roofPoints[i - 1],
      b = roofPoints[i];
    for (const p of [
      [-2.3, a.y, a.z],
      [2.3, a.y, a.z],
      [2.3, b.y, b.z],
      [-2.3, a.y, a.z],
      [2.3, b.y, b.z],
      [-2.3, b.y, b.z],
    ])
      vertices.push(...p);
  }
  const roofG = new THREE.BufferGeometry();
  roofG.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  roofG.computeVertexNormals();
  stop.add(
    new THREE.Mesh(
      roofG,
      new THREE.MeshStandardMaterial({
        color: '#46635e',
        roughness: 0.7,
        metalness: 0.4,
        side: THREE.DoubleSide,
      }),
    ),
  );
  for (const z of [0.63, 0.78, 0.93]) {
    const slat = new THREE.Mesh(rounded(3.1, 0.12, 0.08, 0.025), wood);
    slat.rotation.x = -Math.PI / 2;
    slat.position.set(0, 0.52, z);
    stop.add(slat);
  }
  for (const x of [-1.2, 1.2])
    stop.add(
      new THREE.Mesh(
        tube(new THREE.Vector3(x, 0, 0.55), new THREE.Vector3(x, 0.5, 0.9), 0.06),
        metal,
      ),
    );
  batchStaticMeshes(stop);
  for (const p of [
    { x: -171.2, z: -50, yaw: Math.PI / 2 },
    { x: 55, z: 150.9, yaw: Math.PI },
  ]) {
    const copy = stop.clone(true);
    copy.position.set(p.x, 0.17, p.z);
    copy.rotation.y = p.yaw;
    scene.add(copy);
    cameraBoxes.push(new THREE.Box3().setFromObject(copy));
  }
  const bins = new THREE.Group(),
    profile = [
      new THREE.Vector2(0.28, 0),
      new THREE.Vector2(0.32, 0.06),
      new THREE.Vector2(0.34, 0.88),
      new THREE.Vector2(0.36, 0.9),
      new THREE.Vector2(0.36, 1),
      new THREE.Vector2(0.28, 1.02),
      new THREE.Vector2(0.27, 0.9),
      new THREE.Vector2(0.27, 0.12),
    ];
  bins.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 16), metal));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    bins.add(
      new THREE.Mesh(
        tube(
          new THREE.Vector3(Math.cos(a) * 0.34, 0.12, Math.sin(a) * 0.34),
          new THREE.Vector3(Math.cos(a) * 0.34, 0.88, Math.sin(a) * 0.34),
          0.014,
        ),
        metal,
      ),
    );
  }
  batchStaticMeshes(bins);
  for (const p of [
    { x: -173, z: -43 },
    { x: -48, z: -112 },
    { x: -149, z: 72 },
    { x: 88, z: 59 },
    { x: 255, z: 65 },
    { x: -269, z: 151 },
  ]) {
    const copy = bins.clone(true);
    copy.position.set(p.x, 0.17, p.z);
    scene.add(copy);
    cameraBoxes.push(new THREE.Box3().setFromObject(copy));
  }
  const drainGeometry = rounded(0.42, 0.78, 0.014, 0.025),
    drains: THREE.Matrix4[] = [],
    dummy = new THREE.Object3D();
  for (const e of roadEdges)
    for (let s = 28; s < edgeLength(e) - 14; s += 65) {
      const p = sampleRoad(e, s, e.width / 2 - 0.28);
      dummy.position.set(p.x, 0.035, p.z);
      dummy.rotation.set(-Math.PI / 2, 0, -Math.atan2(p.tx, p.tz));
      dummy.updateMatrix();
      drains.push(dummy.matrix.clone());
    }
  const drainMesh = new THREE.InstancedMesh(
    drainGeometry,
    new THREE.MeshStandardMaterial({ color: '#2d3435', metalness: 0.7, roughness: 0.75 }),
    drains.length,
  );
  drains.forEach((m, i) => drainMesh.setMatrixAt(i, m));
  scene.add(drainMesh);
  const parking = new THREE.Group(),
    paint = new THREE.MeshStandardMaterial({ color: '#bcc3b8', roughness: 0.9 });
  function line(a: Point, b: Point) {
    const length = Math.hypot(a.x - b.x, a.z - b.z),
      m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, length), paint);
    m.rotation.set(-Math.PI / 2, 0, -Math.atan2(b.x - a.x, b.z - a.z));
    m.position.set((a.x + b.x) / 2, 0.027, (a.z + b.z) / 2);
    parking.add(m);
  }
  for (const p of [
    ...cityParkedCars,
    ...[-111.5, -105, -98.5].map((x) => ({ x, z: 27, heading: Math.PI / 2 })),
  ]) {
    const corners = [
      [-1.3, -3],
      [1.3, -3],
      [1.3, 3],
      [-1.3, 3],
    ].map(([x, z]) => ({
      x: p.x + x * Math.cos(p.heading) + z * Math.sin(p.heading),
      z: p.z - x * Math.sin(p.heading) + z * Math.cos(p.heading),
    }));
    for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4]);
  }
  batchStaticMeshes(parking);
  scene.add(parking);
  const rails = new THREE.Group();
  for (let z = -145; z < 205; z += 10) {
    for (const y of [0.5, 1])
      rails.add(
        new THREE.Mesh(
          tube(new THREE.Vector3(-343, y, z), new THREE.Vector3(-343, y, z + 10), 0.045),
          metal,
        ),
      );
    rails.add(
      new THREE.Mesh(
        tube(new THREE.Vector3(-343, 0, z), new THREE.Vector3(-343, 1.15, z), 0.065),
        metal,
      ),
    );
  }
  batchStaticMeshes(rails);
  scene.add(rails);
  return cameraBoxes;
}
