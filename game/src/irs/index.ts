import * as THREE from 'three';
import type { ServerFrame } from '../../../shared/protocol';
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
  private roundT = 14;   // seconds until the first audit question
  private tauntT = 7;    // seconds until Mark's first insult
  private awaitingQ: ReturnType<typeof setTimeout> | null = null;
  private pendingQid: string | null = null;
  private fireBtn: HTMLButtonElement | null = null;

  /** Fired entering/leaving the chamber — main hides the other heroes: the
   *  roast is single-player, whoever else is online. */
  onSeclusion: (secluded: boolean) => void = () => {};

  /** Mark's voice — main wires this to the town bubble system so his trash
   *  talk floats over his head exactly like any citizen's speech. */
  speak: (text: string) => void = () => {};

  private readonly anchorVec = new THREE.Vector3();

  /** Where Mark's bubble hangs: above his head, only while you are in there. */
  markAnchor(): THREE.Vector3 | null {
    if (!this.inArena) return null;
    const p = this.arena.boss.root.position;
    return this.anchorVec.set(p.x, p.y + 3.1, p.z);
  }

  /** Outgoing boss frames; the hub link assigns the real sender. Without a
   *  hub this stays a no-op and the fight is simply all shooter, no quiz. */
  sendBoss: (f: { t: 'boss' } & ({ do: 'question' } | { do: 'taunt' } | { do: 'answer'; qid: string; text: string })) => void =
    () => {};

  /** Incoming boss frames, routed here by the hub link. */
  bossFrame(f: Extract<ServerFrame, { t: 'boss' }>): void {
    if (!this.inArena) return; // stale reply after leaving — drop it
    if (f.ev === 'say') {
      this.speak(f.text);
      return;
    }
    if (f.ev === 'question') {
      if (this.awaitingQ) { clearTimeout(this.awaitingQ); this.awaitingQ = null; }
      this.pendingQid = f.qid;
      this.fight.askQuestion(f.text, f.deadline, (answer) => {
        this.sendBoss({ t: 'boss', do: 'answer', qid: f.qid, text: answer });
        // if the verdict never comes back, concede the round to lag
        this.awaitingQ = setTimeout(() => this.abandonRound(), 45_000);
      });
      return;
    }
    if (f.ev === 'verdict' && f.qid === this.pendingQid) {
      if (this.awaitingQ) { clearTimeout(this.awaitingQ); this.awaitingQ = null; }
      this.pendingQid = null;
      this.fight.applyVerdict(f.correct, f.expected, f.line);
    }
  }

  private abandonRound(): void {
    this.awaitingQ = null;
    this.pendingQid = null;
    this.fight.cancelRound();
  }

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
      onAudited: () => this.exit('Mark: "You are NEVER going to make it as a founder."', '📉'),
      toast,
    });

    this.fight.say = (text) => this.speak(text);

    // A soft black blink for stepping between worlds.
    this.veil = document.createElement('div');
    this.veil.style.cssText =
      'position:fixed;inset:0;background:#0b0b12;opacity:0;pointer-events:none;transition:opacity .28s;z-index:40';
    document.body.append(this.veil);

    // Hold F to return fire — Space stays the jump, left mouse stays the
    // camera. Touch devices get a hold-to-FIRE button instead.
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyF' || !this.inArena || document.body.dataset.typing === '1') return;
      this.fight.setFiring(true);
    });
    addEventListener('keyup', (e) => { if (e.code === 'KeyF') this.fight.setFiring(false); });
    addEventListener('blur', () => this.fight.setFiring(false));

    if (matchMedia('(pointer: coarse)').matches) {
      this.fireBtn = document.createElement('button');
      this.fireBtn.textContent = 'FIRE';
      this.fireBtn.style.cssText =
        'position:fixed;right:18px;bottom:132px;width:78px;height:78px;border-radius:50%;z-index:30;' +
        'display:none;border:3px solid #fffdf6;background:#e4574f;color:#fffdf6;' +
        'font:900 17px "Baloo 2",system-ui;box-shadow:0 4px 0 rgba(53,49,63,.3);touch-action:none;';
      document.body.append(this.fireBtn);
      this.fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.fight.setFiring(true); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const)
        this.fireBtn.addEventListener(ev, () => this.fight.setFiring(false));
    }
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
      this.player.setYaw(0); // walk in facing Mark, not the door you came through
      this.fight.begin();
      this.roundT = 14;
      this.tauntT = 7;
      this.onSeclusion(true);
      if (this.fireBtn) this.fireBtn.style.display = 'block';
    });
  }

  /** Leave the chamber, however it ended — walked out, or carried out. */
  private exit(line: string, icon: string): void {
    this.fadeThrough(() => {
      if (this.awaitingQ) { clearTimeout(this.awaitingQ); this.awaitingQ = null; }
      this.pendingQid = null;
      this.fight.reset();
      this.inArena = false;
      this.arena.group.visible = false;
      this.knocked = false;
      this.player.setArena(null);
      this.player.teleport(new THREE.Vector3(this.door.x + 0.8, this.door.y, this.door.z));
      this.onSeclusion(false);
      if (this.fireBtn) this.fireBtn.style.display = 'none';
      this.toast(line, icon);
    });
  }

  /** Interactable surface: what the pill should read here, or null. */
  prompt(): string | null {
    if (this.inArena) {
      // no firing hint — the gun explains itself
      return this.arena.nearExit(this.player.pos) ? `<kbd>E</kbd> leave before the roast 🚪` : null;
    }
    if (this.nearDoor()) {
      return this.knocked ? `<kbd>E</kbd> meet Mark the startup enemy 🥊` : `<kbd>E</kbd> knock on the startup office door 🚪`;
    }
    return null;
  }

  /** True when the press was consumed. Inside the chamber E never falls
   *  through to city interactions, even away from the exit. */
  act(): boolean {
    if (this.inArena) {
      if (this.arena.nearExit(this.player.pos)) this.exit('you step back into the sunlight. still a founder', '🌤️');
      return true;
    }
    if (!this.nearDoor()) return false;
    if (!this.knocked) {
      this.knocked = true;
      this.toast('a voice from inside: "COME IN. BRING YOUR PITCH DECK."', '🥊');
    } else this.enter();
    return true;
  }

  update(dt: number): void {
    if (this.inArena) {
      this.arena.update(dt, this.player.pos);
      this.fight.update(dt); // after player + arena so shake lands on the final camera

      // The exam schedule and the insult schedule, both only while the
      // shooter is live and THIS player's fight is not already paused.
      if (this.fight.inCombat && !this.fight.frozen) {
        this.roundT -= dt;
        this.tauntT -= dt;
        if (this.roundT <= 0 && this.fight.tryFreezeForRound()) {
          this.roundT = 26;
          this.tauntT = Math.max(this.tauntT, 8); // no insult on top of the exam
          this.sendBoss({ t: 'boss', do: 'question' });
          // hub silent (down, or no mark server): resume rather than hang
          this.awaitingQ = setTimeout(() => this.abandonRound(), 8_000);
        } else if (this.tauntT <= 0) {
          this.tauntT = 12 + Math.random() * 7;
          this.sendBoss({ t: 'boss', do: 'taunt' });
        }
      }
    }
    if (this.knocked && !this.nearDoor()) this.knocked = false; // walked away; knock again
  }
}
