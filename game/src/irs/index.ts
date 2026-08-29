import * as THREE from 'three';
import type { Island } from '../../../shared/protocol';
import type { Player } from '../player';
import { IrsArena, IRS_ARENA } from './arena';

/**
 * The IRS encounter, whole: the door on the island, the knock ritual, the
 * veil fade between worlds, and the audit chamber + taxcollector (arena.ts).
 * main.ts is the single consumer — it puts prompt()/act() on the interactable
 * list and calls update() each frame. Nothing else may import this directory,
 * and this directory reaches nothing but the player it is handed.
 */
export class IrsEncounter {
  private readonly arena = new IrsArena();
  private readonly door: THREE.Vector3;
  private readonly veil: HTMLDivElement;
  private knocked = false;
  private inArena = false;

  constructor(
    scene: THREE.Scene,
    island: Island,
    private readonly player: Player,
    private readonly toast: (text: string, icon: string) => void,
  ) {
    scene.add(this.arena.group);
    const p = island.pois.find((q) => q.id === 'irs')?.pos ?? { x: 20.6, y: 2, z: 52 };
    this.door = new THREE.Vector3(p.x, p.y, p.z);

    // A soft black blink for stepping between worlds.
    this.veil = document.createElement('div');
    this.veil.style.cssText =
      'position:fixed;inset:0;background:#0b0b12;opacity:0;pointer-events:none;transition:opacity .28s;z-index:40';
    document.body.append(this.veil);
  }

  private nearDoor(): boolean {
    return this.door.distanceTo(this.player.pos) < 2.6;
  }

  private fadeThrough(mid: () => void): void {
    this.veil.style.opacity = '1';
    setTimeout(() => { mid(); this.veil.style.opacity = '0'; }, 300);
  }

  private enter(): void {
    this.fadeThrough(() => {
      this.inArena = true;
      this.player.setArena(IRS_ARENA.bounds);
      this.player.teleport(new THREE.Vector3(IRS_ARENA.entrance.x, IRS_ARENA.floorY, IRS_ARENA.entrance.z));
      this.player.setYaw(0); // walk in facing the taxcollector, not the door you came through
      this.toast('the taxcollector looks up from his clipboard', '🧾');
    });
  }

  private leave(): void {
    this.fadeThrough(() => {
      this.inArena = false;
      this.knocked = false;
      this.player.setArena(null);
      this.player.teleport(new THREE.Vector3(this.door.x + 0.8, this.door.y, this.door.z));
      this.toast('you step back into the sunlight. unaudited. for now', '🌤️');
    });
  }

  /** Interactable surface: what the pill should read here, or null. */
  prompt(): string | null {
    if (this.inArena) return this.arena.nearExit(this.player.pos) ? `<kbd>E</kbd> leave before the audit 🚪` : null;
    if (this.nearDoor()) {
      return this.knocked ? `<kbd>E</kbd> meet the taxcollector 🧾` : `<kbd>E</kbd> knock on the IRS door 🚪`;
    }
    return null;
  }

  /** True when the press was consumed. Inside the chamber E never falls
   *  through to city interactions, even away from the exit. */
  act(): boolean {
    if (this.inArena) {
      if (this.arena.nearExit(this.player.pos)) this.leave();
      return true;
    }
    if (!this.nearDoor()) return false;
    if (!this.knocked) {
      this.knocked = true;
      this.toast('a voice from inside: "COME IN. BRING RECEIPTS."', '🧾');
    } else this.enter();
    return true;
  }

  update(dt: number): void {
    this.arena.update(dt, this.player.pos);
    if (this.knocked && !this.nearDoor()) this.knocked = false; // walked away; knock again
  }
}
