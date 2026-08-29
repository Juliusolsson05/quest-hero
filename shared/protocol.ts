/**
 * Wire contract shared by the World Hub (hub/), the game client (game/), and —
 * by copy or import — the MCP servers. This file is the single source of truth
 * for shapes that cross a process boundary; docs/API.md is its prose twin.
 * If you change one, change the other in the same commit.
 */

export type WeatherKind = 'clear' | 'clouds' | 'rain' | 'fog' | 'snow' | 'storm';
export type TimePhase = 'dawn' | 'day' | 'dusk' | 'night';
export type Emotion = 'happy' | 'sad' | 'shock' | 'think' | 'neutral';
export type AnimName = 'idle' | 'walk' | 'run';

export interface Vec3 { x: number; y: number; z: number }

/** Everything that happens becomes one of these. NPCs are briefed from the
 *  tail of this log, which is why "she saw it" is literally true. */
export interface WorldEvent {
  id: number;
  at: number; // epoch ms
  type:
    | 'weather.changed' | 'time.phase'
    | 'npc.moved' | 'npc.said' | 'npc.action'
    | 'animal.action'
    | 'object.spawned' | 'object.removed'
    | 'quest.created' | 'quest.accepted' | 'quest.step' | 'quest.completed'
    | 'commit.landed'
    | 'player.joined' | 'player.said'
    | 'mcp.custom';
  actor?: string;
  summary: string; // one plain-English line — this is what goes in NPC briefings
  data?: Record<string, unknown>;
}

export interface Npc {
  id: string;
  name: string;
  role: string;
  pos: Vec3;
  rot: number; // yaw, radians
  anim: AnimName;
  activity: string; // "hammering at the forge", "walking to the plaza"
  mood: Emotion;
  persona: string;
  bubbleTint: string; // pastel hex for this NPC's bubbles
}

export type AnimalKind = 'cat' | 'chicken' | 'butterfly';
export interface Animal {
  id: string;
  kind: AnimalKind;
  pos: Vec3;
  rot: number;
  state: string; // 'peck' | 'wander' | 'nap' | 'chase' | 'flutter' ...
}

export type ObjectKind =
  | 'crate' | 'barrel' | 'flower' | 'pumpkin' | 'gift' | 'torch' | 'snowman';
export interface WObject {
  id: string;
  kind: ObjectKind;
  pos: Vec3;
  spawnedBy: string; // 'world' | 'mcp' | 'commit:<sha7>' | npc id
  expiresAt?: number;
}

export type QuestStepKind = 'talk' | 'goto' | 'collect';
export interface QuestStep {
  id: string;
  kind: QuestStepKind;
  target: string; // npc id | poi id | item id
  text: string;
  done: boolean;
}
export interface Quest {
  id: string;
  title: string;
  pitch: string; // kawaii flavor text on the notice board
  giver: string; // npc id
  source: { type: 'headline' | 'handcrafted' | 'mcp'; ref?: string };
  steps: QuestStep[];
  state: 'offered' | 'active' | 'done';
  reward: { coins: number; item?: string };
}

export interface PlayerState {
  id: string;
  name: string;
  pos: Vec3;
  rot: number;
  anim: AnimName;
  inventory: Record<string, number>;
}

export interface TimeState { phase: TimePhase; hour: number; real: boolean }
export interface WeatherState {
  kind: WeatherKind;
  tempC: number;
  real: boolean; // false while an override is active
  summary: string; // "12°C and foggy in San Francisco right now"
}

export interface World {
  time: TimeState;
  weather: WeatherState;
  npcs: Npc[];
  animals: Animal[];
  objects: WObject[];
  quests: Quest[];
  players: PlayerState[];
  recentEvents: WorldEvent[];
}

/** Static scenery placed at build time (dynamic spawns are WObject instead). */
export type PropKind =
  | 'tree' | 'pine' | 'lamp' | 'fence' | 'stall' | 'fountain' | 'board'
  | 'forge' | 'anvil' | 'house' | 'mailbox' | 'pen' | 'boat' | 'rock'
  | 'flowerpatch' | 'shrine' | 'well';
export interface Prop { kind: PropKind; pos: Vec3; rot?: number; scale?: number }

/** Static island description sent once in the welcome frame. */
export interface Island {
  size: number; // tiles per side
  /** rows of tile chars: ~ water, . grass, , dirt, : path, # plaza, s sand */
  tiles: string[];
  /** column heights aligned with tiles, '0'-'9' per char */
  heights: string[];
  pois: { id: string; label: string; pos: Vec3 }[];
  props: Prop[];
}

// ── WebSocket frames ────────────────────────────────────────────────────────

export type BubbleMode = 'delta' | 'commit' | 'ambient' | 'thinking' | 'tool';

export type ServerFrame =
  | { t: 'welcome'; world: World; island: Island; you: string }
  | { t: 'event'; event: WorldEvent }
  | { t: 'pose'; npcs: Pick<Npc, 'id' | 'pos' | 'rot' | 'anim'>[];
      animals: Pick<Animal, 'id' | 'pos' | 'rot' | 'state'>[] }
  | { t: 'bubble'; who: string; convId?: string; text: string;
      emotion: Emotion; mode: BubbleMode }
  | { t: 'weather'; weather: WeatherState }
  | { t: 'time'; time: TimeState }
  | { t: 'object'; op: 'add' | 'remove'; object: WObject }
  | { t: 'quest'; quest: Quest };

export type ClientFrame =
  | { t: 'hello'; name: string }
  | { t: 'pose'; pos: Vec3; rot: number; anim: AnimName }
  | { t: 'talk'; npcId: string; text: string }
  | { t: 'interact'; targetId: string }
  | { t: 'quest'; id: string; action: 'accept' };
