import * as THREE from 'three';
import type { AnimName } from '../../shared/protocol';
import { SEA_Y, type IslandView } from './world';
import { CharacterView } from './chars';
import { angleToward } from './util';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Third-person controller: the hero walks the island, a spring-arm camera
 * follows. Drag to orbit, wheel to zoom, WASD moves relative to the camera,
 * Shift runs, Space hops. Collision is the island height grid — step up one
 * block; walk into the sea and you swim, and the current turns you back before
 * the world runs out.
 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly view: CharacterView;
  readonly pos = new THREE.Vector3();
  rot = 0;
  anim: AnimName = 'idle';
  swimming = false;
  /** False while something else owns the hero's pose — a cart ride. The sea
   *  must not grab a passenger who is crossing the bridge above it. */
  controlled = true;
  /**
   * Photo mode: the spring arm collapses to the hero's eyes and the pitch
   * clamp opens up, because the whole point is looking *up* at a building.
   * Owned here rather than in a camera of its own so that walking, looking and
   * the movement basis stay one thing — WASD is still relative to where you
   * are pointed, which is what makes framing a shot feel like standing there.
   */
  photoMode = false;
  /** Vertical field of view while in photo mode: the zoom ring. */
  photoFov = 40;

  /** Fired on the frame the hero hits the water, leaves it, and drifts out
   *  far enough for the current to take hold. */
  onEnterWater: ((x: number, z: number) => void) | null = null;
  onLeaveWater: (() => void) | null = null;
  onCurrent: (() => void) | null = null;

  private island: IslandView | null = null;
  /** When set, movement lives in this rectangular room (the boss arena)
   *  instead of the island grid — a flat floor and four hard walls. */
  private arena: { minX: number; maxX: number; minZ: number; maxZ: number; y: number;
                   blockers?: { x: number; z: number; r: number }[] } | null = null;
  /** One-frame flag: after a teleport the camera snaps to its new berth
   *  instead of flying there — a cross-map lerp is a guided tour of the void. */
  private camSnap = false;
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly mobileMove = new THREE.Vector2();
  private pinchDist = 0;
  private camYaw = Math.PI * 0.85;
  private camPitch = 0.52;
  private camDist = 7.5;
  private groundY = 2;

  // Vertical state. `vy` only matters while airborne; on the ground the hero
  // rides the height grid the way he always has.
  private vy = 0;
  private airborne = false;
  private coyote = 0; // grace after walking off an edge
  private buffer = 0; // grace for a jump pressed just before landing
  private squashY = 1;
  private t = 0;
  private pushed = false; // already told about the current on this excursion

  // update()/finish() scratch — reused every frame instead of allocated.
  private readonly moveDir = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly camOff = new THREE.Vector3();
  private readonly camWanted = new THREE.Vector3();

  private static readonly WALK = 3.4;
  private static readonly RUN = 6.4;
  private static readonly SWIM = 2.2;   // water is heavy; you feel it
  /** How deep the hero floats — the waterline crosses the torso. */
  private static readonly SWIM_DEPTH = 0.45;
  /** Climbing out: beaches and low shore, never a cliff face. */
  private static readonly HAUL_OUT = 1.3;
  // 9.8 against 30 puts the apex a block and a half up, feet back down at
  // 0.65s: a hop with weight to it that never leaves the village silhouette.
  private static readonly GRAVITY = 30;
  private static readonly JUMP_V = 9.8;
  private static readonly COYOTE = 0.12;
  private static readonly BUFFER = 0.12;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900);
    this.view = new CharacterView('hero', 0xa8e6cf, 1.5);

    addEventListener('keydown', (e) => {
      if (document.body.dataset.typing === '1') return;
      if (e.code === 'Space') {
        e.preventDefault(); // otherwise the page scrolls under the canvas
        // In photo mode space is the shutter: a photographer lining up a shot
        // should not hop the moment they take it.
        if (!this.photoMode) this.buffer = Player.BUFFER;
        return;
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); });

    // Camera pointers, per-id so a joystick thumb never fights the orbit
    // finger: one canvas pointer orbits, two pinch-zoom. Client deltas, not
    // movementX — iOS reports zero movement on touch pointer events.
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    const drop = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    addEventListener('pointerup', drop);
    addEventListener('pointercancel', drop);
    addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const mx = e.clientX - p.x, my = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        // Pinching zooms whichever ring is in your hand: the spring arm
        // normally, the lens in photo mode.
        if (this.photoMode) this.photoFov = THREE.MathUtils.clamp(this.photoFov - (d - this.pinchDist) * 0.1, 14, 68);
        else this.camDist = THREE.MathUtils.clamp(this.camDist - (d - this.pinchDist) * 0.02, 3.5, 18);
        this.pinchDist = d;
        return;
      }
      // A long lens magnifies a twitch as much as it magnifies the city, so
      // looking slows down as you zoom in.
      const look = this.photoMode ? this.photoFov / 58 : 1;
      this.camYaw -= mx * 0.0055 * look;
      // How far down the camera may look. On the island it never dips
      // near-level (terrain would fill the view); the arena must, or you could
      // not aim an SMG at a distant boss; and the viewfinder must go further
      // still, because the whole point of it is looking *up* at a building.
      const floor = this.photoMode ? -1.15 : this.arena ? -0.08 : 0.12;
      this.camPitch = THREE.MathUtils.clamp(
        this.camPitch + my * 0.004 * look, floor, this.photoMode ? 1.15 : 1.25);
    });
    addEventListener('wheel', (e) => {
      if (this.photoMode) {
        this.photoFov = THREE.MathUtils.clamp(this.photoFov + Math.sign(e.deltaY) * 3, 14, 68);
        return;
      }
      this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(e.deltaY) * 0.8, 3.5, 18);
    }, { passive: true });
  }

  /**
   * Enter or leave the viewfinder. The hero's own mesh goes with it — you
   * cannot stand behind your own head — and the pitch is pulled back into the
   * orbit camera's range on the way out, or the third-person view would come
   * back staring at the sky.
   */
  setPhotoMode(on: boolean): void {
    if (this.photoMode === on) return;
    this.photoMode = on;
    this.view.root.visible = !on;
    if (on) {
      // The orbit camera looks down at the hero; a photographer raising a
      // camera looks at the horizon. Keep the yaw — you were facing that way
      // for a reason — and level the pitch.
      this.camPitch = Math.min(this.camPitch, 0.06);
    } else {
      this.camPitch = THREE.MathUtils.clamp(this.camPitch, this.arena ? -0.08 : 0.12, 1.25);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Where the lens is pointed, as a unit vector — what the aim test needs. */
  viewDir(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.camYaw) * Math.cos(this.camPitch),
      -Math.sin(this.camPitch),
      -Math.cos(this.camYaw) * Math.cos(this.camPitch),
    );
  }

  /** Analog stick input from TouchControls: x right, y down, each -1..1. */
  setMobileMove(x: number, y: number): void {
    this.mobileMove.set(x, y);
  }

  bindIsland(island: IslandView, spawn: THREE.Vector3): void {
    this.island = island;
    this.pos.copy(spawn);
    this.groundY = island.heightAt(spawn.x, spawn.z);
    this.pos.y = this.groundY;
    this.land();
    this.buffer = 0;
  }

  /** Drop the hero somewhere else on the island (cart rides, cutscenes). */
  teleport(to: THREE.Vector3): void {
    this.pos.set(to.x, to.y, to.z);
    this.camSnap = true;
    if (this.arena) {
      this.groundY = this.arena.y;
      this.pos.y = this.groundY;
    } else if (this.island) {
      this.groundY = this.island.heightAt(to.x, to.z);
      this.pos.y = this.groundY;
    }
    this.land();
    this.buffer = 0;
  }

  private land(): void {
    this.airborne = false;
    this.vy = 0;
  }

  private isWater(x: number, z: number): boolean {
    const island = this.island!;
    return island.tileAt(x, z) === '~' || island.heightAt(x, z) < 1;
  }

  /**
   * Open water is always enterable — walk off the sand, fall in off a jump,
   * either way you end up swimming. Land is the island's one-block step rule
   * when grounded; airborne that rule still holds (a hop never blocks what a
   * stride allowed) plus anything you are now above; and swimming, you may
   * only haul out onto shore close enough to the waterline to climb.
   */
  private passable(x: number, z: number): boolean {
    const island = this.island!;
    if (this.isWater(x, z)) return true;
    // A wall is a wall whether you are walking, hauling out, or mid-jump.
    if (island.blocked(this.pos.x, this.pos.z, x, z)) return false;
    const h = island.heightAt(x, z);
    if (this.swimming) return h <= SEA_Y + Player.HAUL_OUT;
    if (!this.airborne) return island.walkable(x, z, island.heightAt(this.pos.x, this.pos.z));
    return h - this.groundY <= 1 || h <= this.pos.y + 0.05;
  }

  /**
   * Past the shore the current builds until it simply turns you around. A
   * boundary you gave up on beats a boundary you bounced off.
   */
  private applyCurrent(dt: number): void {
    if (!this.island || !this.swimming) return; // it is a sea current, not a leash
    const c = this.island.island.size / 2;
    const dx = this.pos.x - c, dz = this.pos.z - c;
    const d = Math.hypot(dx, dz);
    const soft = c + 22, hard = c + 30;
    if (d <= soft) { this.pushed = false; return; }
    if (!this.pushed) { this.pushed = true; this.onCurrent?.(); }

    const pull = Math.min(1, (d - soft) / (hard - soft)) * Player.SWIM * 1.6 * dt;
    this.pos.x -= (dx / d) * pull;
    this.pos.z -= (dz / d) * pull;
    if (d > hard) { // however hard you kick, this is the line
      this.pos.x = c + (dx / d) * hard;
      this.pos.z = c + (dz / d) * hard;
    }
  }

  /** Enter (or with null, leave) an off-grid room. */
  setArena(a: Player['arena']): void {
    this.arena = a;
  }

  /** Point the camera (cutscene entrances: face the taxcollector, not a wall). */
  setYaw(yaw: number): void {
    this.camYaw = yaw;
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.controlled) { this.finish(dt); return; }
    let fwd = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    let str = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    let running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (this.mobileMove.lengthSq() > 0.02) { // the touch joystick wins when held
      str = this.mobileMove.x;
      fwd = -this.mobileMove.y; // stick up = forward
      running = this.mobileMove.length() > 0.82;
    }
    const moving = (fwd !== 0 || str !== 0) && this.island;

    if (moving && this.island) {
      const speed = this.swimming ? Player.SWIM : running ? Player.RUN : Player.WALK;
      const dir = this.moveDir.set(str, 0, -fwd)
        .normalize()
        .applyAxisAngle(UP, this.camYaw);
      // Axis-separated moves so we slide along blocked tiles and walls instead
      // of sticking; passable() covers water, ledges and building footprints.
      // In the arena the room's rectangle is the whole law — plus the cover
      // pillars, which use the island's rule: inward blocked, outward free.
      const can = (tx: number, tz: number): boolean => {
        if (!this.arena) return this.passable(tx, tz);
        if (tx < this.arena.minX || tx > this.arena.maxX || tz < this.arena.minZ || tz > this.arena.maxZ) return false;
        for (const b of this.arena.blockers ?? []) {
          const dn = Math.hypot(tx - b.x, tz - b.z);
          if (dn >= b.r) continue;
          if (dn < Math.hypot(this.pos.x - b.x, this.pos.z - b.z) - 1e-6) return false;
        }
        return true;
      };
      const nx = this.pos.x + dir.x * speed * dt;
      if (can(nx, this.pos.z)) this.pos.x = nx;
      const nz = this.pos.z + dir.z * speed * dt;
      if (can(this.pos.x, nz)) this.pos.z = nz;

      this.rot = angleToward(this.rot, Math.atan2(dir.x, dir.z), dt * 14);
      // The wire only speaks idle/walk/run; a swimmer reads as walking.
      this.anim = this.swimming ? 'walk' : running ? 'run' : 'walk';
    } else {
      this.anim = 'idle';
    }
    this.applyCurrent(dt);
    // Off the island grid every tile reads as deep water at height 0, so the
    // arena must supply its own floor — and can never count as sea.
    if (this.arena) this.groundY = this.arena.y;
    else if (this.island) this.groundY = this.island.heightAt(this.pos.x, this.pos.z);

    // ── in and out of the water ─────────────────────────────────────────────
    // Falling in only counts once you reach the surface, so a jump over a
    // channel stays a jump right up until it isn't.
    const overWater = this.island && !this.arena ? this.isWater(this.pos.x, this.pos.z) : false;
    if (overWater && !this.swimming && this.pos.y <= SEA_Y + 0.15) {
      this.swimming = true;
      this.airborne = false;
      this.vy = 0;
      this.squashY = 1;
      this.onEnterWater?.(this.pos.x, this.pos.z);
    } else if (!overWater && this.swimming) {
      this.swimming = false;
      this.onLeaveWater?.();
    }
    this.view.setSwimming(this.swimming);

    // ── vertical ────────────────────────────────────────────────────────────
    this.buffer = Math.max(0, this.buffer - dt);
    if (this.swimming) {
      // Float on the same swell the water tiles ride, so the hero bobs with
      // the sea rather than sitting on a flat sheet of it.
      const line = SEA_Y - Player.SWIM_DEPTH + Math.sin(this.t * 1.1) * 0.045;
      this.pos.y += (line - this.pos.y) * Math.min(1, dt * 6);
      this.buffer = 0; // no jumping out of the water
      this.squashY += (1 - this.squashY) * Math.min(1, dt * 9);
      this.view.root.scale.setScalar(1);
      this.finish(dt);
      return;
    }

    // Walking off a ledge starts a fall rather than a glide down the lerp.
    if (!this.airborne && this.groundY < this.pos.y - 0.15) { this.airborne = true; this.vy = 0; }

    // Flight resolves first, so a jump buffered mid-fall launches on the very
    // frame the hero touches down.
    if (this.airborne) {
      this.vy -= Player.GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.vy <= 0 && this.pos.y <= this.groundY) {
        const impact = -this.vy;
        this.pos.y = this.groundY;
        this.land();
        this.squashY = 1 - THREE.MathUtils.clamp(impact * 0.022, 0, 0.22);
      }
    }
    this.coyote = this.airborne ? Math.max(0, this.coyote - dt) : Player.COYOTE;

    if (this.buffer > 0 && this.coyote > 0 && this.island) {
      this.vy = Player.JUMP_V;
      this.airborne = true;
      this.coyote = 0;
      this.buffer = 0;
    } else if (!this.airborne) {
      // Smooth step up/down.
      this.pos.y += (this.groundY - this.pos.y) * Math.min(1, dt * 12);
    }

    // Squash and stretch: stretch with vertical speed, spring back off a
    // landing. Cosmetic only — nothing else touches the hero's root scale.
    const wantY = this.airborne ? 1 + THREE.MathUtils.clamp(this.vy * 0.028, -0.1, 0.13) : 1;
    this.squashY += (wantY - this.squashY) * Math.min(1, dt * (this.airborne ? 16 : 9));
    const flat = 1 / Math.sqrt(this.squashY); // keep the volume honest
    this.view.root.scale.set(flat, this.squashY, flat);

    this.finish(dt);
  }

  /** Pose the hero and settle the camera — the tail of every frame. */
  private finish(dt: number): void {
    this.view.setAnim(this.anim);
    this.view.update(dt);
    this.view.root.position.copy(this.pos);
    this.view.root.rotation.y = this.rot;

    // Viewfinder: the camera *is* the hero's eyes. No spring, no lerp, no
    // occlusion pull-in — a viewfinder that drifts toward where you looked is
    // impossible to aim, and there is nothing left to be occluded by.
    if (this.photoMode) {
      if (this.camera.fov !== this.photoFov) {
        this.camera.fov = this.photoFov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.position.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
      this.camera.lookAt(this.camera.position.clone().add(this.viewDir()));
      return;
    }

    // Spring-arm camera.
    const target = this.camTarget.set(this.pos.x, this.pos.y + 1.35, this.pos.z);
    const off = this.camOff.set(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).multiplyScalar(this.camDist);
    const wanted = this.camWanted.copy(target).add(off);
    if (this.island && !this.arena) {
      // When a building would occlude the hero, pull in — but never far enough
      // to end up inside the wall. Past halfway the camera climbs instead, so
      // a hero hard against a row house is filmed over the rooftop.
      const t = this.island.cameraClearT(target, wanted);
      if (t < 1) {
        wanted.lerpVectors(target, wanted, Math.max(0.42, t));
        if (t < 0.75) wanted.y += ((0.75 - t) / 0.75) * 6.5;
      }
      // …and keep the camera above the terrain skin.
      const ch = this.island.heightAt(wanted.x, wanted.z);
      wanted.y = Math.max(wanted.y, ch + 0.6);
    } else if (this.arena) {
      // The room is windowless on purpose; the camera never leaves it. Clamp
      // the spring arm inside the walls and under the ceiling — and when a
      // wall compresses the arm, drop the camera proportionally so the LOOK
      // ANGLE survives the pinch. Otherwise backing toward a wall tips the
      // camera downward and the crosshair dives into the floor at range.
      const wx = THREE.MathUtils.clamp(wanted.x, this.arena.minX, this.arena.maxX);
      const wz = THREE.MathUtils.clamp(wanted.z, this.arena.minZ, this.arena.maxZ);
      if (wx !== wanted.x || wz !== wanted.z) {
        const dFull = Math.hypot(wanted.x - target.x, wanted.z - target.z);
        const dPinch = Math.hypot(wx - target.x, wz - target.z);
        wanted.y = target.y + (wanted.y - target.y) * (dPinch / Math.max(0.001, dFull));
      }
      wanted.x = wx;
      wanted.z = wz;
      wanted.y = THREE.MathUtils.clamp(wanted.y, this.arena.y + 0.4, this.arena.y + 7.2);
    }
    if (this.camSnap) {
      this.camera.position.copy(wanted);
      this.camSnap = false;
    } else {
      this.camera.position.lerp(wanted, Math.min(1, dt * 10));
    }
    this.camera.lookAt(target);
  }
}
