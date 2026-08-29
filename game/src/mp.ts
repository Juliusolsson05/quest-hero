import * as THREE from 'three';
import {
  insertCoin,
  myPlayer,
  onPlayerJoin,
  getRoomCode,
  type PlayerState,
} from 'playroomkit';
import { CharacterView } from './chars';
import type { AnimName } from '../../shared/protocol';
import { angleToward } from './util';

/**
 * Multiplayer, ported from worldplay4's net stack (src/lib/net/playroom.ts):
 * PlayroomKit through its IMPERATIVE API — insertCoin with an explicit room
 * code and skipLobby, each client authoritative over its OWN avatar pose,
 * broadcast unreliably every frame via player state; the roster comes from
 * onPlayerJoin/onQuit. The share link IS the invite: the room code lives in
 * the URL (?room=XYZ23A) — open the same link, land in the same room. The
 * world itself still streams from the hub; Playroom only carries the heroes.
 */

export interface MpPose { x: number; y: number; z: number; rot: number; anim: AnimName; t: number }

interface Remote {
  p: PlayerState;
  view: CharacterView;
  label: THREE.Sprite;
  target: THREE.Vector3;
  rot: number;
  color: string;
}

function safeName(p: PlayerState): string {
  try { return p.getProfile().name || 'traveller'; } catch { return 'traveller'; }
}
function safeColor(p: PlayerState): string {
  try { return p.getProfile().color.hexString; } catch { return '#a8e6cf'; }
}

/** Rounded name tag rendered to a sprite, hovering above a remote hero. */
function nameSprite(name: string, tint: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = '700 30px "Baloo 2", sans-serif';
  const w = Math.min(236, ctx.measureText(name).width + 36);
  const x = (256 - w) / 2;
  ctx.fillStyle = 'rgba(255,253,246,.94)';
  ctx.strokeStyle = '#35313f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, 8, w, 48, 24);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(x + 22, 32, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#35313f';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#35313f';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x + 38, 34);
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

export class Multiplayer {
  /** The boss fight is single-player: while false, remote heroes vanish
   *  (scene and minimap both) even though the room stays connected. */
  avatarsVisible = true;

  private ready = false;
  private readonly remotes = new Map<string, Remote>();
  status: 'connecting' | 'online' | 'solo' = 'connecting';
  onStatus: (status: Multiplayer['status'], room: string | null) => void = () => {};
  onRoster: (names: string[]) => void = () => {};

  constructor(private readonly scene: THREE.Scene) {}

  roomCode(): string | null {
    try { return getRoomCode() ?? null; } catch { return null; }
  }

  /** Everyone in the room, self included (for HUD counts). */
  count(): number { return this.remotes.size + (this.ready ? 1 : 0); }

  async join(): Promise<void> {
    // Room code from the link, else the shared city room — the hosted site is
    // ONE city, so two people who just open the bare URL meet by default
    // (minting a random code here put every visitor in their own empty room).
    // An explicit ?room=CODE still carves out a private city, and whatever is
    // in the address bar is the invite.
    const params = new URLSearchParams(location.search);
    let room = params.get('room')?.toUpperCase() ?? null;
    if (!room || !/^[A-Z0-9]{4,10}$/.test(room)) {
      room = 'SFQUEST';
      params.set('room', room);
      history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
    }
    try {
      await insertCoin({
        roomCode: room,
        skipLobby: true,
        maxPlayersPerRoom: 12,
        reconnectGracePeriod: 10_000,
      });
      this.ready = true;
      this.status = 'online';
      onPlayerJoin((p) => {
        let selfId = '';
        try { selfId = myPlayer().id; } catch { /* not ready */ }
        if (p.id === selfId) return;
        this.addRemote(p);
        p.onQuit(() => this.removeRemote(p.id));
      });
    } catch {
      this.status = 'solo'; // offline / blocked: the city still works alone
    }
    this.onStatus(this.status, this.roomCode());
  }

  /** Broadcast own pose (unreliable, every frame — remotes interpolate). */
  setPose(pose: MpPose): void {
    if (!this.ready) return;
    try { myPlayer().setState('pose', pose, false); } catch { /* noop */ }
  }

  private addRemote(p: PlayerState): void {
    if (this.remotes.has(p.id)) return;
    const color = safeColor(p);
    const view = new CharacterView(`mp-${p.id}`, parseInt(color.replace('#', ''), 16) || 0xa8e6cf, 1.5);
    const label = nameSprite(safeName(p), color);
    label.position.y = 2.35;
    view.root.add(label);
    view.root.visible = false; // until the first pose lands
    this.scene.add(view.root);
    this.remotes.set(p.id, { p, view, label, target: new THREE.Vector3(), rot: 0, color });
    this.onRoster(this.names());
  }

  private removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.view.root);
    this.remotes.delete(id);
    this.onRoster(this.names());
  }

  names(): string[] { return [...this.remotes.values()].map((r) => safeName(r.p)); }

  /** Minimap dots for everyone else in the room. */
  dots(): { x: number; z: number; color: string }[] {
    return [...this.remotes.values()]
      .filter((r) => r.view.root.visible)
      .map((r) => ({ x: r.view.root.position.x, z: r.view.root.position.z, color: r.color }));
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 10);
    for (const r of this.remotes.values()) {
      if (!this.avatarsVisible) { r.view.root.visible = false; continue; }
      let pose: MpPose | null = null;
      try { pose = (r.p.getState('pose') as MpPose) ?? null; } catch { /* noop */ }
      if (!pose || typeof pose.x !== 'number') continue;
      if (!r.view.root.visible) {
        r.view.root.visible = true;
        r.view.root.position.set(pose.x, pose.y, pose.z);
      }
      r.target.set(pose.x, pose.y, pose.z);
      r.rot = pose.rot;
      r.view.setAnim(pose.anim === 'idle' || pose.anim === 'walk' || pose.anim === 'run' ? pose.anim : 'idle');
      r.view.root.position.lerp(r.target, k);
      r.view.root.rotation.y = angleToward(r.view.root.rotation.y, r.rot, k);
      r.view.update(dt);
    }
  }
}
