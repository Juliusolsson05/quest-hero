import * as THREE from 'three';
import { state } from './state';

/**
 * First-person controller.
 *
 * Uses Pointer Lock rather than orbit controls because the player needs to
 * physically walk up to an NPC to talk to it — proximity is the trigger, so
 * movement has to feel direct.
 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private locked = false;

  /** Eye height in metres. Anything much lower reads as crouching. */
  private static readonly EYE = 1.7;
  private static readonly SPEED = 4.5;

  constructor(private readonly dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, Player.EYE, 6);

    addEventListener('keydown', (e) => {
      // Ignore keystrokes while the player is typing to an NPC, or WASD would
      // walk them away mid-sentence.
      if (document.body.dataset.typing === '1') return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      // Dropping the lock while keys are held would leave the player sliding.
      if (!this.locked) this.keys.clear();
    });

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      // Clamp just short of straight up/down; hitting the pole makes the
      // camera basis degenerate and the view rolls.
      const limit = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
  }

  requestLock(): void {
    this.dom.requestPointerLock();
  }

  update(dt: number): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));

    this.velocity.set(strafe, 0, -forward);
    if (this.velocity.lengthSq() > 0) {
      // Normalise so diagonal movement isn't faster than cardinal.
      this.velocity.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.camera.position.addScaledVector(this.velocity, Player.SPEED * dt);
    }

    // Soft bounds keep the player on the built area without collision meshes.
    this.camera.position.x = Math.max(-24, Math.min(24, this.camera.position.x));
    this.camera.position.z = Math.max(-24, Math.min(24, this.camera.position.z));
    this.camera.position.y = Player.EYE;

    const p = this.camera.position;
    state.player.position = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
  }
}
