import * as THREE from 'three';
import type { AnimName } from '../../shared/protocol';
import type { IslandView } from './world';
import { CharacterView } from './chars';

/**
 * Third-person controller: the hero walks the island, a spring-arm camera
 * follows. Drag to orbit, wheel to zoom, WASD moves relative to the camera,
 * Shift runs. Collision is the island height grid — step up one block, never
 * into water — which is all a village stroll needs.
 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly view: CharacterView;
  readonly pos = new THREE.Vector3();
  rot = 0;
  anim: AnimName = 'idle';

  private island: IslandView | null = null;
  private readonly keys = new Set<string>();
  private camYaw = Math.PI * 0.85;
  private camPitch = 0.52;
  private camDist = 7.5;
  private dragging = false;
  private groundY = 2;

  private static readonly WALK = 3.4;
  private static readonly RUN = 6.4;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 560);
    this.view = new CharacterView('hero', 0xa8e6cf, 1.5);

    addEventListener('keydown', (e) => {
      if (document.body.dataset.typing === '1') return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) { this.dragging = true; dom.setPointerCapture(e.pointerId); }
    });
    addEventListener('pointerup', () => { this.dragging = false; });
    addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.camYaw -= e.movementX * 0.0055;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * 0.004, 0.12, 1.25);
    });
    addEventListener('wheel', (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(e.deltaY) * 0.8, 3.5, 18);
    }, { passive: true });
  }

  bindIsland(island: IslandView, spawn: THREE.Vector3): void {
    this.island = island;
    this.pos.copy(spawn);
    this.groundY = island.heightAt(spawn.x, spawn.z);
    this.pos.y = this.groundY;
  }

  /** Drop the hero somewhere else on the island (cart rides, cutscenes). */
  teleport(to: THREE.Vector3): void {
    this.pos.set(to.x, to.y, to.z);
    if (this.island) {
      this.groundY = this.island.heightAt(to.x, to.z);
      this.pos.y = this.groundY;
    }
  }

  update(dt: number): void {
    const fwd = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const str = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const moving = (fwd !== 0 || str !== 0) && this.island;

    if (moving && this.island) {
      const speed = running ? Player.RUN : Player.WALK;
      const dir = new THREE.Vector3(str, 0, -fwd)
        .normalize()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camYaw);
      // Axis-separated moves so we slide along blocked tiles and walls instead
      // of sticking; canMove also collides with building footprints.
      const nx = this.pos.x + dir.x * speed * dt;
      if (this.island.canMove(this.pos.x, this.pos.z, nx, this.pos.z)) this.pos.x = nx;
      const nz = this.pos.z + dir.z * speed * dt;
      if (this.island.canMove(this.pos.x, this.pos.z, this.pos.x, nz)) this.pos.z = nz;

      this.groundY = this.island.heightAt(this.pos.x, this.pos.z);
      const target = Math.atan2(dir.x, dir.z);
      // Shortest-path angle lerp so the hero turns, not spins.
      let d = target - this.rot;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.rot += d * Math.min(1, dt * 14);
      this.anim = running ? 'run' : 'walk';
    } else {
      this.anim = 'idle';
    }

    // Smooth step up/down.
    this.pos.y += (this.groundY - this.pos.y) * Math.min(1, dt * 12);

    this.view.setAnim(this.anim);
    this.view.update(dt);
    this.view.root.position.copy(this.pos);
    this.view.root.rotation.y = this.rot;

    // Spring-arm camera.
    const target = new THREE.Vector3(this.pos.x, this.pos.y + 1.35, this.pos.z);
    const off = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).multiplyScalar(this.camDist);
    const wanted = target.clone().add(off);
    if (this.island) {
      // Pull in when a building would occlude the hero…
      const t = this.island.cameraClearT(target, wanted);
      if (t < 1) wanted.lerpVectors(target, wanted, Math.max(0.14, t));
      // …and keep the camera above the terrain skin.
      const ch = this.island.heightAt(wanted.x, wanted.z);
      wanted.y = Math.max(wanted.y, ch + 0.6);
    }
    this.camera.position.lerp(wanted, Math.min(1, dt * 10));
    this.camera.lookAt(target);
  }
}
