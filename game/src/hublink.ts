import type { Quest, ServerFrame } from '../../shared/protocol';
import type { Bubbles } from './bubbles';
import type { Cartly } from './cartly';
import type { Entities } from './entities';
import type { CityFeed } from './feed';
import type { Atmosphere } from './fx';
import type { IrsEncounter } from './irs';
import { Net } from './net';
import type { Player } from './player';
import type { Ui } from './ui';
import { npcLabel } from './util';

/**
 * The hub link — the ONLY file that owns the WebSocket and interprets
 * ServerFrames. One frame fans out to many views (entities, HUD, fx, phone,
 * feed, bubbles); that fan-out lives here in one switch so a new frame type
 * touches exactly this file, and no view ever second-guesses another about
 * what the hub said. Also owns the quest map, the link-status watchdog, the
 * 10 Hz pose uplink, and the talk/accept sends off the HUD.
 */
export class HubLink {
  private readonly net = new Net('traveller');
  private readonly quests = new Map<string, Quest>();
  private npcCount = 0;

  constructor(private readonly deps: {
    player: Player;
    entities: Entities;
    ui: Ui;
    fx: Atmosphere;
    bubbles: Bubbles;
    feed: CityFeed;
    cartly: Cartly;
    irs: IrsEncounter;
  }) {
    const { player, ui, bubbles, feed } = deps;
    this.net.on((f) => this.apply(f));

    // Reconnect watchdog: the welcome frame flips it back on. After 8s with
    // no hub we stop pretending one is coming (static-host demo mode).
    const bootAt = Date.now();
    setInterval(() => ui.setLink(this.net.connected, Date.now() - bootAt > 8000), 1000);

    // Pose uplink at 10Hz.
    setInterval(() => {
      this.net.send({ t: 'pose', pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z }, rot: player.rot, anim: player.anim });
    }, 100);

    ui.onSay = (npcId, text) => {
      this.net.send({ t: 'talk', npcId, text });
      bubbles.push('player', 'you', '#e8f7ee', 'commit', text, 'neutral');
      feed.addTalk('you', '#e8f7ee', text);
    };
    ui.onAccept = (id) => this.net.send({ t: 'quest', id, action: 'accept' });
    deps.irs.sendBoss = (f) => this.net.send(f);

    // Conversation hold keep-alive: while the talk bar is open, re-send
    // `interact` every 5s so the hub's ~12s hold slides forward and the NPC
    // stands facing the player instead of wandering off mid-chat.
    setInterval(() => {
      const who = ui.talking;
      if (who) this.net.send({ t: 'interact', targetId: who });
    }, 5000);
  }

  /** The player opened a conversation: tell the hub so the NPC stops and
   *  faces them (the sim's engagePlayer hold). */
  interact(targetId: string): void {
    this.net.send({ t: 'interact', targetId });
  }

  private pushQuests(): void {
    const order = { offered: 0, active: 1, done: 2 };
    this.deps.ui.setQuests([...this.quests.values()].sort((a, b) => order[a.state] - order[b.state]));
  }

  private liveQuestCount(): number {
    return [...this.quests.values()].filter((q) => q.state !== 'done').length;
  }

  private apply(f: ServerFrame): void {
    const { entities, ui, fx, bubbles, feed, cartly } = this.deps;
    switch (f.t) {
      case 'welcome': {
        ui.setLink(true);
        cartly.setDestinations(f.world.npcs.map((n) => ({ id: n.id, label: `${n.name} the ${n.role}` })));
        entities.syncNpcs(f.world.npcs);
        entities.syncAnimals(f.world.animals);
        entities.syncObjects(f.world.objects);
        this.quests.clear();
        for (const q of f.world.quests) this.quests.set(q.id, q);
        this.pushQuests();
        fx.setWeather(f.world.weather.kind);
        fx.setTime(f.world.time.hour, f.world.time.phase);
        ui.setWeather(f.world.weather);
        ui.setTime(f.world.time);
        cartly.setWeather(f.world.weather.kind);
        this.npcCount = f.world.npcs.length;
        feed.seed(f.world.recentEvents);
        feed.setWeather(f.world.weather);
        feed.setTime(f.world.time);
        feed.setCounts(this.npcCount, this.liveQuestCount());
        break;
      }
      case 'pose': entities.applyPose(f); break;
      case 'boss': this.deps.irs.bossFrame(f); break;
      case 'bubble': {
        const npc = entities.npc(f.who)?.data;
        bubbles.push(f.who, npc ? npcLabel(npc) : f.who, npc?.bubbleTint ?? '#fffdf6', f.mode, f.text, f.emotion);
        if (f.mode !== 'thinking' && f.mode !== 'tool') {
          feed.addTalk(npc ? npcLabel(npc) : f.who, npc?.bubbleTint ?? '#fffdf6', f.text);
        }
        break;
      }
      case 'weather':
        fx.setWeather(f.weather.kind);
        ui.setWeather(f.weather);
        cartly.setWeather(f.weather.kind);
        feed.setWeather(f.weather);
        break;
      case 'time':
        fx.setTime(f.time.hour, f.time.phase);
        ui.setTime(f.time);
        feed.setTime(f.time);
        break;
      case 'object':
        if (f.op === 'add') entities.addObject(f.object);
        else entities.removeObject(f.object.id);
        break;
      case 'quest':
        this.quests.set(f.quest.id, f.quest);
        this.pushQuests();
        feed.setCounts(this.npcCount, this.liveQuestCount());
        break;
      case 'event': {
        const e = f.event;
        feed.addEvent(e);
        if (e.type === 'commit.landed') ui.toast(e.summary, '📦');
        else if (e.type === 'quest.created') ui.toast(e.summary, '📜');
        else if (e.type === 'quest.completed') ui.toast(e.summary, '🎉');
        else if (e.type === 'weather.changed') ui.toast(e.summary, '🌦️');
        else if (e.type === 'mcp.custom') ui.toast(e.summary, '🛰️');
        break;
      }
    }
  }
}
