import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Quest, ServerFrame } from '../../shared/protocol';
import { Net } from './net';
import { buildIsland, IslandView } from './world';
import { buildDistance } from './distance';
import { WaterFx } from './water-fx';
import { Player } from './player';
import { Entities } from './entities';
import { Bubbles } from './bubbles';
import { Atmosphere } from './fx';
import { Ui } from './ui';
import { loadManifest } from './chars';
import { initProps3d } from './props3d';
import { CartService } from './taxi';
import { CartlyPhone } from './cartly';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const fx = new Atmosphere(scene);
const player = new Player(renderer.domElement);
const entities = new Entities();
scene.add(entities.group, player.view.root);
const bubbles = new Bubbles();
const ui = new Ui();
const phone = new CartlyPhone();
const waterFx = new WaterFx();
scene.add(waterFx.group);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, player.camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.65, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let island: IslandView | null = null;
let boardPos: THREE.Vector3 | null = null;
const quests = new Map<string, Quest>();

function pushQuests(): void {
  const order = { offered: 0, active: 1, done: 2 };
  ui.setQuests([...quests.values()].sort((a, b) => order[a.state] - order[b.state]));
}

const net = new Net('traveller');

net.on((f: ServerFrame) => {
  switch (f.t) {
    case 'welcome': {
      ui.setLink(true);
      if (!island) {
        island = new IslandView(f.island);
        const built = buildIsland(f.island);
        scene.add(built.group);
        fx.attachWorld(built);
        initProps3d(scene, island); // Tripo kawaii props + the parked fleet
        // The painted distance: rocks, headlands, a skyline — so the eye never
        // finds the edge of the tile grid.
        const far = buildDistance(new THREE.Vector3(f.island.size / 2, 0, f.island.size / 2));
        scene.add(far.group);
        fx.attachDistance(far.layers);
        const spawn = f.island.pois.find((p) => p.id === 'plaza')?.pos ?? { x: 24, y: 2, z: 30 };
        player.bindIsland(island, new THREE.Vector3(spawn.x, spawn.y, spawn.z + 4));
        boardPos = (() => {
          const b = f.island.pois.find((p) => p.id === 'board');
          return b ? new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z) : null;
        })();
      }
      entities.syncNpcs(f.world.npcs);
      entities.syncAnimals(f.world.animals);
      entities.syncObjects(f.world.objects);
      quests.clear();
      for (const q of f.world.quests) quests.set(q.id, q);
      pushQuests();
      fx.setWeather(f.world.weather.kind);
      fx.setTime(f.world.time.hour, f.world.time.phase);
      ui.setWeather(f.world.weather);
      ui.setTime(f.world.time);
      phone.setWeather(f.world.weather.kind);
      break;
    }
    case 'pose': entities.applyPose(f); break;
    case 'bubble': {
      const npc = entities.npc(f.who)?.data;
      bubbles.push(f.who, npc?.name ?? f.who, npc?.bubbleTint ?? '#fffdf6', f.mode, f.text, f.emotion);
      break;
    }
    case 'weather':
      fx.setWeather(f.weather.kind);
      ui.setWeather(f.weather);
      phone.setWeather(f.weather.kind);
      break;
    case 'time':
      fx.setTime(f.time.hour, f.time.phase);
      ui.setTime(f.time);
      break;
    case 'object':
      if (f.op === 'add') entities.addObject(f.object);
      else entities.removeObject(f.object.id);
      break;
    case 'quest':
      quests.set(f.quest.id, f.quest);
      pushQuests();
      break;
    case 'event': {
      const e = f.event;
      if (e.type === 'commit.landed') ui.toast(e.summary, '📦');
      else if (e.type === 'quest.created') ui.toast(e.summary, '📜');
      else if (e.type === 'quest.completed') ui.toast(e.summary, '🎉');
      else if (e.type === 'weather.changed') ui.toast(e.summary, '🌦️');
      else if (e.type === 'mcp.custom') ui.toast(e.summary, '🛰️');
      break;
    }
  }
});

// Reconnect watchdog: the welcome frame flips it back on.
setInterval(() => ui.setLink(net.connected), 1000);

ui.onSay = (npcId, text) => {
  net.send({ t: 'talk', npcId, text });
  bubbles.push('player', 'you', '#e8f7ee', 'commit', text, 'neutral');
};
ui.onAccept = (id) => net.send({ t: 'quest', id, action: 'accept' });

// ── the sea ────────────────────────────────────────────────────────────────
player.onEnterWater = (x, z) => waterFx.splash(x, z, 1);
player.onLeaveWater = () => waterFx.splash(player.pos.x, player.pos.z, 0.5);
player.onCurrent = () => ui.toast('the current out here is brutal — best turn back', '🌊');

// ── Cartly: a real cart from the Tripo fleet rolls in over the Golden Gate ──
const carts = new CartService(scene, player, () => island);
phone.onSummon = (kind) => {
  void carts.summon(kind);
  ui.toast(`${carts.cartLabel} summoned — rolling in over the Golden Gate!`, '🚕');
};
phone.onCancel = () => carts.cancel();
carts.onEta = (s) => phone.setEta(s);
carts.onArrived = () => {
  phone.arrived(carts.cartLabel);
  ui.toast(`thy ${carts.cartLabel} has arrived — press E to hop in`, '🚕');
};
carts.onRideEnd = (dest) => {
  phone.backToRequest();
  phone.close();
  ui.toast(`dropped at ${dest} — 5 stars for the driver? ⭐`, '🚕');
};

function nearestPoiLabel(): string {
  let best = 'the village';
  let bestD = Infinity;
  for (const p of island?.island.pois ?? []) {
    const d = (p.pos.x - player.pos.x) ** 2 + (p.pos.z - player.pos.z) ** 2;
    if (d < bestD) { bestD = d; best = p.label; }
  }
  return best;
}

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && ui.questsOpen) ui.closeQuests();
  if (document.body.dataset.typing === '1') return;
  if (e.code === 'KeyP') { phone.setFrom(nearestPoiLabel()); phone.toggle(); return; }
  if (e.code !== 'KeyE') return;
  if (carts.nearCart()) { carts.board(); phone.close(); return; }
  const npc = entities.nearestNpc(player.pos, 3.4);
  if (npc) { ui.openTalk(npc.id, `${npc.name} · ${npc.role}`); return; }
  if (boardPos && boardPos.distanceTo(player.pos) < 3.2) ui.openQuests();
});

// Pose uplink at 10Hz.
setInterval(() => {
  if (island) net.send({ t: 'pose', pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z }, rot: player.rot, anim: player.anim });
}, 100);

const startEl = document.getElementById('start')!;
startEl.addEventListener('click', () => startEl.classList.add('hidden'));

addEventListener('resize', () => {
  player.camera.aspect = innerWidth / innerHeight;
  player.camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

void loadManifest();

const playerAnchor = new THREE.Vector3();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  // Some hosts (emulated viewports, panes) never fire `resize` — poll instead.
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== innerWidth || size.y !== innerHeight) {
    player.camera.aspect = innerWidth / innerHeight;
    player.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  }
  const dt = Math.min(clock.getDelta(), 0.1);
  player.update(dt);
  carts.update(dt); // after player.update so a ride overrides the hero's pose
  entities.update(dt);
  if (player.swimming) waterFx.trail(player.pos.x, player.pos.z, player.anim !== 'idle', dt);
  waterFx.update(dt);
  fx.update(dt, player.camera);

  // Interaction prompt.
  if (document.body.dataset.typing !== '1') {
    const npc = entities.nearestNpc(player.pos, 3.4);
    if (carts.nearCart()) ui.setPrompt(`<kbd>E</kbd> hop into the ${carts.cartLabel} 🚕`);
    else if (npc) ui.setPrompt(`<kbd>E</kbd> talk to ${npc.name} 💬`);
    else if (boardPos && boardPos.distanceTo(player.pos) < 3.2) ui.setPrompt(`<kbd>E</kbd> read the notice board 📋`);
    else ui.setPrompt(null);
  } else ui.setPrompt(null);

  bubbles.update(dt, player.camera, (who) =>
    who === 'player'
      ? playerAnchor.copy(player.pos).add(new THREE.Vector3(0, 2.05, 0))
      : entities.anchor(who));

  composer.render();
});
