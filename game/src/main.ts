import * as THREE from 'three';
import { Player } from './player';
import { buildWorld } from './world';
import { Npc, NPCS } from './npc';
import { Dialogue } from './dialogue';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
buildWorld(scene);

const player = new Player(renderer.domElement);
const npcs = NPCS.map((def) => new Npc(def));
for (const n of npcs) scene.add(n.mesh);

const promptEl = document.getElementById('prompt')!;
const startEl = document.getElementById('start')!;
const dialogue = new Dialogue(() => player.requestLock());

/** Squared talk radius — the player must genuinely walk up to a character. */
const TALK_RADIUS_SQ = 3.2 * 3.2;
let nearest: Npc | null = null;

startEl.addEventListener('click', () => {
  startEl.classList.add('hidden');
  player.requestLock();
});

addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && nearest && !dialogue.isOpen) dialogue.open(nearest.def);
});

addEventListener('resize', () => {
  player.camera.aspect = innerWidth / innerHeight;
  player.camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  // Clamp dt so a backgrounded tab doesn't teleport the player on return.
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!dialogue.isOpen) player.update(dt);

  nearest = null;
  let best = TALK_RADIUS_SQ;
  for (const n of npcs) {
    const d = n.distanceToSq(player.camera.position);
    if (d < best) { best = d; nearest = n; }
    if (d < 400) n.faceToward(player.camera.position);
  }

  if (nearest && !dialogue.isOpen) {
    promptEl.innerHTML = `<kbd>E</kbd> talk to ${nearest.def.name}`;
    promptEl.classList.add('on');
  } else {
    promptEl.classList.remove('on');
  }

  renderer.render(scene, player.camera);
});
