/**
 * The Quest Scribe: one harness session that turns a real news headline into
 * a notice-board quest (strict JSON, schema-checked, one retry), plus the
 * quest-step validation POST /api/quests shares. TrueForge unreachable →
 * template quest, so the feature demos without the harness.
 */
import type { Quest, QuestStep } from '../../shared/protocol';
import { POI_IDS } from '../../shared/island';
import { NPC_IDS } from './npcs';
import { addQuest } from './state';
import { sessionFor, streamTurn, type SessionSpec } from './trueforge';
import { clamp, nextId, warnOnce } from './util';

// ── quest step validation (shared with POST /api/quests) ────────────────────

export function validateSteps(input: unknown): QuestStep[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: QuestStep[] = [];
  for (const s of input as Array<Record<string, unknown>>) {
    const kind = s?.kind;
    const target = s?.target;
    const text = typeof s?.text === 'string' && s.text.trim() ? s.text.trim().slice(0, 120) : null;
    if (!text || typeof target !== 'string') return null;
    if (kind === 'talk') {
      if (!NPC_IDS.includes(target)) return null;
    } else if (kind === 'goto') {
      if (!POI_IDS.includes(target)) return null;
    } else if (kind === 'collect') {
      if (!target.trim()) return null;
    } else {
      return null;
    }
    out.push({ id: `s${out.length + 1}`, kind, target, text, done: false });
  }
  return out;
}

// ── Quest Scribe ────────────────────────────────────────────────────────────

const SCRIBE_SPEC: SessionSpec = {
  persona:
    'You are the Quest Scribe of Ashford, a cozy kawaii village game. Given one real news ' +
    'headline, turn it into one tiny village quest. Reply with STRICT JSON only — no prose, ' +
    'no code fences. Schema: {"title": string (short, village-flavored), "pitch": string ' +
    '(kawaii, at most 140 characters, a village-flavored riff on the headline), "steps": ' +
    '[1 or 2 steps, each {"kind":"talk","target":"wren","text":string} or ' +
    '{"kind":"goto","target":"<poi>","text":string}], "reward":{"coins": number between 5 and 20}}. ' +
    'Allowed talk targets: bran, wren, suki. Allowed goto targets: plaza, forge, market, farm, ' +
    'docks, hill, board, mailbox, pen, flowerpatch. JSON only.',
  model: 'openai/gpt-5-5',
};

function parseScribe(raw: string, url: string): Quest | null {
  const stripped = raw.replace(/```(?:json)?/gi, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: Record<string, any>;
  try {
    obj = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof obj?.title !== 'string' || !obj.title.trim() || typeof obj?.pitch !== 'string') return null;
  const steps = validateSteps(obj.steps);
  if (!steps || steps.length > 2) return null;
  const coins = clamp(Math.round(Number(obj?.reward?.coins) || 8), 5, 20);
  return {
    id: nextId('quest'),
    title: obj.title.trim().slice(0, 60),
    pitch: obj.pitch.trim().slice(0, 140),
    giver: 'wren',
    source: { type: 'headline', ref: url },
    steps,
    state: 'offered',
    reward: { coins },
  };
}

function templateQuest(headline: string, url: string): Quest {
  const short = headline.length > 70 ? headline.slice(0, 67) + '…' : headline;
  return {
    id: nextId('quest'),
    title: short.length > 48 ? short.slice(0, 45) + '…' : short,
    pitch: `Word from afar!! "${short}" — Wren wants to hear what the town thinks!`,
    giver: 'wren',
    source: { type: 'headline', ref: url },
    steps: [
      { id: 's1', kind: 'talk', target: 'wren', text: 'Ask Wren about the word from afar', done: false },
      { id: 's2', kind: 'goto', target: 'board', text: 'Check the notice board in the plaza', done: false },
    ],
    state: 'offered',
    reward: { coins: 8 },
  };
}

async function scribeTurn(sid: string, content: string, url: string): Promise<Quest | null> {
  let acc = '';
  const ctrl = new AbortController();
  let wd = setTimeout(() => ctrl.abort(), 12_000);
  try {
    await streamTurn(
      sid,
      content,
      {
        onDelta: (c) => {
          acc += c;
          clearTimeout(wd);
          wd = setTimeout(() => ctrl.abort(), 12_000);
        },
      },
      ctrl.signal,
    );
  } finally {
    clearTimeout(wd);
  }
  return parseScribe(acc, url);
}

/**
 * Headline → notice-board quest. Garbage JSON twice → skip; TrueForge
 * unreachable → template quest, so the feature demos without the harness.
 */
export async function scribeQuest(headline: string, url: string): Promise<Quest | null> {
  try {
    const sid = await sessionFor('quest-scribe', SCRIBE_SPEC, AbortSignal.timeout(8_000));
    let quest = await scribeTurn(sid, `Headline: "${headline}" (${url})`, url);
    quest ??= await scribeTurn(sid, 'That was not valid JSON matching the schema. Reply again with ONLY the JSON object.', url);
    if (!quest) {
      warnOnce('scribe-garbage', '[scribe] unusable JSON twice — skipping this headline');
      return null;
    }
    return addQuest(quest);
  } catch {
    warnOnce('scribe-down', '[scribe] TrueForge unreachable — creating template headline quest instead');
    return addQuest(templateQuest(headline, url));
  }
}
