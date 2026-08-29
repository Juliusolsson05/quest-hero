import * as THREE from 'three';
import type { Island } from '../../../shared/protocol';
import type { Player } from '../player';
import { IrsArena, IRS_ARENA } from './arena';
import { BossFight } from './boss-fight';

/**
 * The IRS encounter, whole: the door on the island, the knock ritual, the
 * veil fade between worlds, the audit chamber + IRS Mark (arena.ts), and the
 * bazooka fight (boss-fight.ts + fight-fx.ts). main.ts is the single
 * consumer — it puts prompt()/act() on the interactable list and calls
 * update() each frame. Nothing else may import this directory, and this
 * directory reaches nothing but the player it is handed.
 */
export class IrsEncounter {
  private readonly arena = new IrsArena();
  private readonly fight: BossFight;
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
    this.arena.group.visible = false; // only rendered while you are inside
    const p = island.pois.find((q) => q.id === 'irs')?.pos ?? { x: 20.6, y: 2, z: 52 };
    this.door = new THREE.Vector3(p.x, p.y, p.z);

    this.fight = new BossFight(scene, this.arena, player, {
      onAudited: () => this.exit('you have been audited. it will happen again', '📋'),
      toast,
    });

    // A soft black blink for stepping between worlds.
    this.veil = document.createElement('div');
    this.veil.style.cssText =
      'position:fixed;inset:0;background:#0b0b12;opacity:0;pointer-events:none;transition:opacity .28s;z-index:40';
    document.body.append(this.veil);

    // Hold Space to return fire — only inside the chamber, so the jump key
    // keeps meaning jump everywhere else. (You can still hop while firing;
    // the player's own Space handler runs regardless.)
    addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !this.inArena || document.body.dataset.typing === '1') return;
      e.preventDefault();
      this.fight.setFiring(true);
    });
    addEventListener('keyup', (e) => { if (e.code === 'Space') this.fight.setFiring(false); });
    addEventListener('blur', () => this.fight.setFiring(false));
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
      this.arena.group.visible = true;
      this.player.setArena(IRS_ARENA.bounds);
      this.player.teleport(new THREE.Vector3(IRS_ARENA.entrance.x, IRS_ARENA.floorY, IRS_ARENA.entrance.z));
      this.player.setYaw(0); // walk in facing IRS Mark, not the door you came through
      this.fight.begin();
    });
  }

  /** Leave the chamber, however it ended — walked out, or carried out. */
  private exit(line: string, icon: string): void {
    this.fadeThrough(() => {
      this.fight.reset();
      this.inArena = false;
      this.arena.group.visible = false;
      this.knocked = false;
      this.player.setArena(null);
      this.player.teleport(new THREE.Vector3(this.door.x + 0.8, this.door.y, this.door.z));
      this.toast(line, icon);
    });
  }

  /** Interactable surface: what the pill should read here, or null. */
  prompt(): string | null {
    if (this.inArena) {
      if (this.arena.nearExit(this.player.pos)) return `<kbd>E</kbd> leave before the audit 🚪`;
      return this.fight.active ? `hold <kbd>Space</kbd> to return fire 🔫` : null;
    }
    if (this.nearDoor()) {
      return this.knocked ? `<kbd>E</kbd> meet the taxcollector 🧾` : `<kbd>E</kbd> knock on the IRS door 🚪`;
    }
    return null;
  }

  /** True when the press was consumed. Inside the chamber E never falls
   *  through to city interactions, even away from the exit. */
  act(): boolean {
    if (this.inArena) {
      if (this.arena.nearExit(this.player.pos)) this.exit('you step back into the sunlight. unaudited. for now', '🌤️');
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
    if (this.inArena) {
      this.arena.update(dt, this.player.pos);
      this.fight.update(dt); // after player + arena so shake lands on the final camera
    }
    if (this.knocked && !this.nearDoor()) this.knocked = false; // walked away; knock again
  }
}
