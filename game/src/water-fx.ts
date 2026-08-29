import * as THREE from 'three';
import { SEA_Y } from './world';

const DROPS = 96;
const RINGS = 16;

/**
 * The two bits of feedback that make water read as water: a burst of droplets
 * where you break the surface, and rings spreading behind you while you swim.
 * Both are pooled — once the game is running this allocates nothing.
 */
export class WaterFx {
  readonly group = new THREE.Group();

  private readonly drops: THREE.Points;
  private readonly dropPos: THREE.BufferAttribute;
  private readonly dropVel: THREE.Vector3[] = [];
  private readonly dropLife: number[] = [];

  private readonly rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private ringGap = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DROPS * 3), 3));
    this.dropPos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < DROPS; i++) {
      this.dropVel.push(new THREE.Vector3());
      this.dropLife.push(0);
      this.dropPos.setY(i, -50); // parked below the world until used
    }
    this.drops = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xeaf8ff, size: 0.13, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.drops.frustumCulled = false;
    this.group.add(this.drops);

    const ringGeo = new THREE.RingGeometry(0.34, 0.46, 24);
    for (let i = 0; i < RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdff2ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, life: 0 });
    }
  }

  /** Break the surface: droplets out and up, and one hard ring. */
  splash(x: number, z: number, strength = 1): void {
    let spawned = 0;
    for (let i = 0; i < DROPS && spawned < 26; i++) {
      if (this.dropLife[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const out = (0.7 + Math.random() * 1.9) * strength;
      this.dropVel[i].set(Math.cos(a) * out, (1.8 + Math.random() * 2.6) * strength, Math.sin(a) * out);
      this.dropPos.setXYZ(i, x, SEA_Y, z);
      this.dropLife[i] = 0.5 + Math.random() * 0.4;
      spawned++;
    }
    this.dropPos.needsUpdate = true;
    this.spawnRing(x, z, 1);
  }

  /** Call each frame with the swimmer's position; rings trail behind them. */
  trail(x: number, z: number, moving: boolean, dt: number): void {
    this.ringGap -= dt;
    if (!moving || this.ringGap > 0) return;
    this.ringGap = 0.22;
    this.spawnRing(x, z, 0.5);
  }

  private spawnRing(x: number, z: number, strength: number): void {
    const r = this.rings.find((v) => v.life <= 0) ?? this.rings[0];
    r.life = 1;
    r.mesh.visible = true;
    r.mesh.position.set(x, SEA_Y + 0.02, z);
    r.mesh.scale.setScalar(0.5);
    r.mat.opacity = 0.5 * strength;
    (r.mesh as THREE.Mesh & { userData: { strength: number } }).userData.strength = strength;
  }

  update(dt: number): void {
    let live = false;
    for (let i = 0; i < DROPS; i++) {
      if (this.dropLife[i] <= 0) continue;
      live = true;
      this.dropLife[i] -= dt;
      const v = this.dropVel[i];
      v.y -= 16 * dt; // droplets fall back into the sea
      this.dropPos.setXYZ(
        i,
        this.dropPos.getX(i) + v.x * dt,
        this.dropPos.getY(i) + v.y * dt,
        this.dropPos.getZ(i) + v.z * dt,
      );
      if (this.dropLife[i] <= 0) this.dropPos.setY(i, -50);
    }
    if (live) this.dropPos.needsUpdate = true;

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt * 0.9;
      if (r.life <= 0) { r.mesh.visible = false; r.mat.opacity = 0; continue; }
      const strength = (r.mesh.userData.strength as number) ?? 1;
      r.mesh.scale.setScalar(0.5 + (1 - r.life) * 4.2 * strength);
      r.mat.opacity = r.life * 0.5 * strength;
    }
  }
}
