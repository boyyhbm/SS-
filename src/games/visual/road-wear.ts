import * as THREE from 'three';
import { roadEdges, edgeLength, sampleRoad } from '../road-network';
// Original sparse road-maintenance decals. Existing PBR asphalt remains the
// surface; these small, matte details never act as wet reflection masks.
export function createRoadWear(scene: THREE.Scene) {
  const resources: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    texture: THREE.Texture;
    mesh: THREE.InstancedMesh;
  }[] = [];
  for (const kind of ['cracks', 'tyres'] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const c = canvas.getContext('2d')!;
    let seed = kind === 'cracks' ? 6839 : 451;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (kind === 'cracks') {
      c.strokeStyle = 'rgba(18,23,23,0.48)';
      for (let branch = 0; branch < 7; branch++) {
        let x = 100 + rand() * 824,
          y = rand() * 220;
        c.beginPath();
        c.moveTo(x, y);
        c.lineWidth = 1.1 + rand() * 1.8;
        for (let i = 0; i < 9; i++) {
          x += (rand() - 0.5) * 135;
          y += 52 + rand() * 48;
          c.lineTo(x, y);
        }
        c.stroke();
      }
    } else {
      for (const x of [385, 615]) {
        c.beginPath();
        c.moveTo(x, 980);
        c.bezierCurveTo(x + 25, 620, x - 145, 330, x - 110, 50);
        c.strokeStyle = 'rgba(20,24,23,0.11)';
        c.lineWidth = 28;
        c.stroke();
        for (let i = 0; i < 8; i++) {
          c.beginPath();
          c.moveTo(x - 12 + i * 3, 980);
          c.bezierCurveTo(x + 13 + i * 3, 620, x - 157 + i * 3, 330, x - 122 + i * 3, 50);
          c.strokeStyle = 'rgba(16,20,19,0.08)';
          c.lineWidth = 1.4;
          c.stroke();
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      opacity: 0.72,
      roughness: 0.98,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const chosen =
      kind === 'cracks' ? ['i0-i1', 'i2-i3', 'd1-i0', 'r1-r2'] : ['d0-d1', 'i3-i5', 'r0-r1'];
    const geometry = new THREE.PlaneGeometry(
        kind === 'cracks' ? 4.4 : 3.2,
        kind === 'cracks' ? 6 : 12,
      ),
      mesh = new THREE.InstancedMesh(geometry, material, chosen.length),
      dummy = new THREE.Object3D();
    chosen.forEach((id, i) => {
      const edge = roadEdges.find((e) => e.id === id)!;
      const p = sampleRoad(edge, edgeLength(edge) * (0.35 + i * 0.13), edge.width * 0.2);
      dummy.position.set(p.x, 0.041, p.z);
      dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(p.tx, p.tz));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.receiveShadow = true;
    mesh.name = 'Original_road_' + kind;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    resources.push({ geometry, material, texture, mesh });
  }
  return {
    dispose() {
      for (const r of resources) {
        scene.remove(r.mesh);
        r.geometry.dispose();
        r.material.dispose();
        r.texture.dispose();
      }
    },
  };
}
