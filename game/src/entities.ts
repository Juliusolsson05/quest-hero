import * as THREE from 'three';
import type { Animal, Npc, ServerFrame, WObject } from '../../shared/protocol';
import { AnimalView, CharacterView } from './chars';
import { objectMesh } from './world';
import { angleToward } from './util';

/**
 * Views for everything the hub animates: NPCs, critters, spawned objects.
 * The hub streams coarse poses at 10Hz; we exponentially smooth toward them so
 * motion reads soft even when frames jitter.
 */

export class Entities {
  readonly group = new THREE.Group();
  private npcs = new Map<string, { view: CharacterView; target: THREE.Vector3; rot: number; data: Npc }>();
  private animals = new Map<string, { view: AnimalView; target: THREE.Vector3; rot: number; kind: Animal['kind'] }>();
  private objects = new Map<string, THREE.Group>();
  private pops: { obj: THREE.Object3D; t: number }[] = [];

  syncNpcs(list: Npc[]): void {
    for (const n of list) {
      if (this.npcs.has(n.id)) continue;
      const view = new CharacterView(n.id, parseInt(n.bubbleTint?.replace('#', '') || 'ffd3b6', 16), 1.5, n.look);
      view.root.position.set(n.pos.x, n.pos.y, n.pos.z);
      view.root.rotation.y = n.rot;
      this.group.add(view.root);
      this.npcs.set(n.id, { view, target: new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z), rot: n.rot, data: n });
    }
  }

  syncAnimals(list: Animal[]): void {
    for (const a of list) {
      if (this.animals.has(a.id)) continue;
      const view = new AnimalView(a.kind);
      view.root.position.set(a.pos.x, a.pos.y, a.pos.z);
      this.group.add(view.root);
      this.animals.set(a.id, { view, target: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), rot: a.rot, kind: a.kind });
    }
  }

  syncObjects(list: WObject[]): void {
    for (const o of list) this.addObject(o, false);
  }

  addObject(o: WObject, pop = true): void {
    if (this.objects.has(o.id)) return;
    const mesh = objectMesh(o.kind);
    mesh.position.set(o.pos.x, o.pos.y, o.pos.z);
    mesh.rotation.y = Math.abs(Math.sin(o.pos.x * 7 + o.pos.z * 13)) * Math.PI;
    this.group.add(mesh);
    this.objects.set(o.id, mesh);
    if (pop) { mesh.scale.setScalar(0.01); this.pops.push({ obj: mesh, t: 0 }); }
  }

  removeObject(id: string): void {
    const m = this.objects.get(id);
    if (m) { this.group.remove(m); this.objects.delete(id); }
  }

  applyPose(frame: Extract<ServerFrame, { t: 'pose' }>): void {
    for (const p of frame.npcs) {
      const e = this.npcs.get(p.id);
      if (!e) continue;
      e.target.set(p.pos.x, p.pos.y, p.pos.z);
      e.rot = p.rot;
      e.view.setAnim(p.anim);
    }
    for (const a of frame.animals) {
      const e = this.animals.get(a.id);
      if (!e) continue;
      e.target.set(a.pos.x, a.pos.y, a.pos.z);
      e.rot = a.rot;
      e.view.state = a.state;
    }
  }

  npc(id: string) { return this.npcs.get(id); }
  npcList(): Npc[] { return [...this.npcs.values()].map((e) => e.data); }

  /** World anchor for a speaker's bubble (above the head). */
  anchor(who: string): THREE.Vector3 | null {
    const n = this.npcs.get(who);
    if (n) return n.view.root.position.clone().add(new THREE.Vector3(0, 2.1, 0));
    return null;
  }

  nearestNpc(pos: THREE.Vector3, maxDist: number): Npc | null {
    let best: Npc | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.npcs.values()) {
      const d = e.view.root.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = e.data; }
    }
    return best;
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 8);
    for (const e of this.npcs.values()) {
      e.view.root.position.lerp(e.target, k);
      e.view.root.rotation.y = angleToward(e.view.root.rotation.y, e.rot, k);
      e.view.update(dt);
    }
    for (const e of this.animals.values()) {
      const speed = e.kind === 'butterfly' ? 3.5 : 6;
      e.view.root.position.lerp(e.target, Math.min(1, dt * speed));
      e.view.root.rotation.y = angleToward(e.view.root.rotation.y, e.rot, dt * 6);
      e.view.update(dt);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt * 3;
      const s = p.t >= 1 ? 1 : 1.12 - Math.pow(1 - p.t, 2) * 1.11; // pop-overshoot
      p.obj.scale.setScalar(Math.max(0.01, Math.min(s, 1 + Math.sin(p.t * 6) * 0.08 * (1 - p.t))));
      if (p.t >= 1) { p.obj.scale.setScalar(1); this.pops.splice(i, 1); }
    }
  }
}
