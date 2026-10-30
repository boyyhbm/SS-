import {
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Object3D,
  type Vector3Like,
} from 'three';
export class ForgeEffects {
  readonly root = new Group();
  private geometry = new OctahedronGeometry(0.025);
  private material = new MeshBasicMaterial({ color: '#ffce67' });
  private mesh = new InstancedMesh(this.geometry, this.material, 32);
  private particles = new Float32Array(32 * 7);
  private cursor = 0;
  private dummy = new Object3D();
  private count = 4;
  setQuality(quality: 'low' | 'medium' | 'high') {
    this.count = quality === 'low' ? 1 : quality === 'medium' ? 3 : 5;
  }
  constructor() {
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    for (let i = 0; i < 32; i++) this.particles[i * 7 + 6] = -1;
  }
  emit(p: Vector3Like) {
    for (let k = 0; k < this.count; k++) {
      const i = (this.cursor++ % 32) * 7;
      this.particles[i] = p.x;
      this.particles[i + 1] = p.y;
      this.particles[i + 2] = p.z;
      this.particles[i + 3] = Math.sin(this.cursor * 7) * 1.3;
      this.particles[i + 4] = 1.5;
      this.particles[i + 5] = Math.cos(this.cursor * 3) * 1.3;
      this.particles[i + 6] = 0.2;
    }
  }
  update(dt: number) {
    for (let k = 0; k < 32; k++) {
      const i = k * 7;
      this.particles[i + 6] -= dt;
      const alive = this.particles[i + 6] > 0;
      this.dummy.scale.setScalar(alive ? 1 : 0);
      if (alive) {
        this.particles[i] += this.particles[i + 3] * dt;
        this.particles[i + 1] += this.particles[i + 4] * dt;
        this.particles[i + 2] += this.particles[i + 5] * dt;
        this.dummy.position.set(this.particles[i], this.particles[i + 1], this.particles[i + 2]);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(k, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
