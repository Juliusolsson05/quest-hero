/**
 * The authoritative game state.
 *
 * This module is deliberately the ONLY place mutable world data lives, because
 * the quest-hero-world MCP server reads and writes through exactly this
 * surface. If NPC agents could reach into the renderer or the player object
 * directly, "what the agent believes" and "what the player sees" would drift
 * apart the first time we refactored. One store, one truth, both consumers.
 */

export type ItemId = 'iron-ingot' | 'ember-flask' | 'cracked-blade' | 'coin';

export interface QuestStep {
  id: string;
  text: string;
  done: boolean;
}

export interface Quest {
  id: string;
  title: string;
  giver: string;
  started: boolean;
  steps: QuestStep[];
}

export interface WorldState {
  player: {
    position: { x: number; y: number; z: number };
    inventory: Partial<Record<ItemId, number>>;
  };
  quests: Quest[];
  /** Append-only log. NPCs read this to know what already happened, which is
   *  cheaper and more reliable than re-deriving history from state diffs. */
  events: { at: number; text: string }[];
}

export const state: WorldState = {
  player: {
    position: { x: 0, y: 0, z: 0 },
    inventory: { coin: 12, 'cracked-blade': 1 },
  },
  quests: [
    {
      id: 'reforge',
      title: 'The Cracked Blade',
      giver: 'smith',
      started: false,
      steps: [
        { id: 'ask-smith', text: 'Ask Bran about the cracked blade', done: false },
        { id: 'get-ingot', text: 'Bring Bran an iron ingot', done: false },
        { id: 'reforged', text: 'Collect the reforged blade', done: false },
      ],
    },
  ],
  events: [],
};

export function log(text: string): void {
  state.events.push({ at: Date.now(), text });
  if (state.events.length > 200) state.events.shift();
}

export function give(item: ItemId, n = 1): void {
  state.player.inventory[item] = (state.player.inventory[item] ?? 0) + n;
  log(`player received ${n}x ${item}`);
}

export function take(item: ItemId, n = 1): boolean {
  const have = state.player.inventory[item] ?? 0;
  if (have < n) return false;
  state.player.inventory[item] = have - n;
  log(`player gave up ${n}x ${item}`);
  return true;
}

export function completeStep(questId: string, stepId: string): boolean {
  const step = state.quests.find((q) => q.id === questId)?.steps.find((s) => s.id === stepId);
  if (!step || step.done) return false;
  step.done = true;
  log(`quest ${questId}: completed "${step.text}"`);
  return true;
}

/** Snapshot for the MCP layer. Structured-cloned so a tool call can never
 *  hand an agent a live reference it could mutate behind the game's back. */
export function snapshot(): WorldState {
  return structuredClone(state);
}
