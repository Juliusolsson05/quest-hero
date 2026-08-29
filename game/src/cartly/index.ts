import type * as THREE from 'three';
import type { WeatherKind } from '../../../shared/protocol';
import type { Player } from '../player';
import type { IslandView } from '../world';
import { CartService, type CartKind } from './carts';
import { CartlyPhone } from './phone';

/**
 * Cartly, whole: the scrying-glass phone UI (phone.ts), the street-driving
 * fleet (carts.ts), and the wiring between them that used to live in main.ts.
 * main.ts is the single consumer; the feature reaches the rest of the game
 * only through the callbacks handed to the constructor.
 */
export class Cartly {
  private readonly phone = new CartlyPhone();
  private readonly carts: CartService;

  constructor(
    scene: THREE.Scene,
    player: Player,
    island: () => IslandView | null,
    deps: {
      toast: (text: string, icon: string) => void;
      /** "meet <NPC>" rides: resolve the citizen's live position at boarding time. */
      resolveNpc: (id: string) => { label: string; x: number; z: number } | null;
    },
  ) {
    this.carts = new CartService(scene, player, island);
    this.phone.onSummon = (kind: CartKind) => {
      void this.carts.summon(kind);
      deps.toast(`${this.carts.cartLabel} summoned — rolling in over the Golden Gate!`, '🚕');
    };
    this.phone.onCancel = () => this.carts.cancel();
    this.carts.pickDestination = () => {
      const d = this.phone.destination;
      return d === 'auto' ? null : deps.resolveNpc(d);
    };
    this.carts.onEta = (s) => this.phone.setEta(s);
    this.carts.onArrived = () => {
      this.phone.arrived(this.carts.cartLabel);
      deps.toast(`thy ${this.carts.cartLabel} has arrived — press E to hop in`, '🚕');
    };
    this.carts.onRideEnd = (dest) => {
      this.phone.backToRequest();
      this.phone.close();
      deps.toast(`dropped at ${dest} — 5 stars for the driver? ⭐`, '🚕');
    };
  }

  /** P key / phone button: raise or lower the glass, pickup label refreshed. */
  /** Put the phone away — photo mode takes the whole screen. */
  closePhone(): void { this.phone.close(); }

  togglePhone(fromLabel: string): void {
    this.phone.setFrom(fromLabel);
    this.phone.toggle();
  }

  setDestinations(npcs: { id: string; label: string }[]): void {
    this.phone.setDestinations(npcs);
  }

  setWeather(kind: WeatherKind): void {
    this.phone.setWeather(kind);
  }

  /** Minimap dot for the summoned cart, or null. */
  get cartPos(): THREE.Vector3 | null {
    return this.carts.pos;
  }

  /** Interactable surface: boarding a waiting cart. */
  prompt(): string | null {
    return this.carts.nearCart() ? `<kbd>E</kbd> hop into the ${this.carts.cartLabel} 🚕` : null;
  }

  act(): boolean {
    if (!this.carts.nearCart()) return false;
    this.carts.board();
    this.phone.close();
    return true;
  }

  update(dt: number): void {
    this.carts.update(dt);
  }
}
