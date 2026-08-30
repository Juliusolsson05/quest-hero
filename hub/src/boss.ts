import type { ServerFrame } from '../../shared/protocol';
import { HarnessUnavailable, sessionFor, streamTurn, userMessage } from './trueforge';

/**
 * Mark the startup enemy's brain — the broker between the boss fight and his
 * TrueForge agent. One channel per WebSocket connection (rounds are private:
 * a question must never broadcast onto another player's screen), one shared
 * agent session (his memory of you surviving rematches).
 *
 * The verdict is DATA, never prose: the agent is required to call the mark
 * MCP server's tools, and this file reads the tool RESULTS off the stream —
 * mark_next_question for the question, mark_judge_answer for the verdict —
 * while the model's words ride along as flavor. When the harness has no
 * model (or the turn dies), the same tools answer over the mark server's
 * REST mirror and canned lines stand in for the trash talk. The fight works
 * keyless; it just gets funnier with a model.
 */

const MARK_URL = process.env.MARK_URL ?? 'http://localhost:8813';
const DEADLINE_S = 20;

const MARK_PERSONA =
  'You are Mark, the startup enemy — a massive, immaculately dressed man who ' +
  'runs an audit chamber under the startup office in a voxel San Francisco, ' +
  'and is currently in a boss fight against the player, a would-be founder. ' +
  'Your catchphrase: "You are NEVER going to make it as a founder." ' +
  'You trash-talk the player between rounds of San Francisco trivia — sharp, ' +
  'playful, condescending, never cruel, two sentences maximum. ' +
  'RULES YOU NEVER BREAK: when asked for a question, call mark_next_question ' +
  'and recite the returned question VERBATIM — never invent one, never reveal ' +
  'or hint at the answer. When judging, call mark_judge_answer and accept its ' +
  'verdict completely — never judge from memory, never overrule the tool. ' +
  'Use mark_taunt_material when you want fresh facts to gloat with. ' +
  'Write plain speech only: no markdown, no asterisks, no bullet lists, no ' +
  'stage directions. You are speaking out loud in a boxing ring of paperwork.';

const CANNED_LINES = {
  asking: [
    'Pop quiz, founder. Get this wrong and it goes on your permanent record.',
    'Let us see if you know ANYTHING about the city you claim to disrupt.',
    'Question time. I would say take your time, but your runway disagrees.',
  ],
  right: [
    'Fine. Correct. Even a broken cap table is right twice a day.',
    'Correct. I will pretend I am not surprised.',
    'Right answer. The bar was on the floor and you cleared it. Barely.',
  ],
  wrong: [
    'WRONG. You are NEVER going to make it as a founder.',
    'Wrong. Add it to the pile of things you did not research.',
    'Incorrect. This is why nobody leads your round.',
  ],
  idle: [
    'You are NEVER going to make it as a founder.',
    'I have seen better aim from a pitch deck.',
    'Keep shooting. It is the only traction you will ever have.',
    'Your form is bad and your TAM is worse.',
    'Dodge all you want — the market already rejected you.',
    'Is that your strategy? It looks like your revenue: flat.',
  ],
};
const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

const MARK_DEF = {
  registryName: 'mark-startup-enemy',
  persona: MARK_PERSONA,
  connectors: ['mark'],
  subagents: false,
};

// ── the mark server's REST mirror: the deterministic, keyless path ──────────

interface RestQuestion { id: string; question: string; taunt: string }
interface RestVerdict { correct: boolean; expected: string; detail: string; fact: string }

async function restQuestion(seen: string[]): Promise<RestQuestion> {
  const res = await fetch(`${MARK_URL}/question?seen=${encodeURIComponent(seen.join(','))}`, {
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`mark /question: ${res.status}`);
  return (await res.json()) as RestQuestion;
}

async function restJudge(questionId: string, answer: string): Promise<RestVerdict> {
  const res = await fetch(`${MARK_URL}/judge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question_id: questionId, answer }),
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`mark /judge: ${res.status}`);
  return (await res.json()) as RestVerdict;
}

// ── tool-result capture off the agent stream ────────────────────────────────

/** MCP tool results arrive as the ok() JSON the mark server produced. */
function parseToolJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** ~35s guard around a whole agent exchange; the REST path is the net. */
const AGENT_TIMEOUT_MS = 35_000;

export interface BossChannel {
  handle(frame: { t: 'boss' } & ({ do: 'question' } | { do: 'taunt' } | { do: 'answer'; qid: string; text: string })): void;
}

export function makeBossChannel(send: (f: ServerFrame) => void): BossChannel {
  const seen: string[] = [];
  let busy = false;

  /** Throttled flavor-text relay: Mark's words, one frame per beat. */
  const makeSayRelay = () => {
    let buf = '';
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      timer = null;
      const text = buf.trim();
      buf = '';
      if (text) send({ t: 'boss', ev: 'say', text });
    };
    return {
      delta: (chunk: string) => {
        buf += chunk;
        if (!timer) timer = setTimeout(flush, 700);
      },
      done: () => {
        if (timer) clearTimeout(timer);
        flush();
      },
    };
  };

  async function askQuestion(): Promise<void> {
    // Agent path: Mark draws via his tool; we read the tool result as data.
    let q: { id: string; question: string } | null = null;
    try {
      const ctrl = AbortSignal.timeout(AGENT_TIMEOUT_MS);
      const sid = await sessionFor('boss:mark', MARK_DEF, ctrl);
      const relay = makeSayRelay();
      await streamTurn(
        sid,
        userMessage(
          '[ROUND] Time for a trivia round. Call mark_next_question with ' +
          `seen_ids=${JSON.stringify(seen)}, then say one short taunt and ask the ` +
          'returned question verbatim. Do not reveal the answer.',
        ),
        {
          onDelta: (chunk) => relay.delta(chunk),
          onToolResponse: (name, content) => {
            if (name === 'mark_next_question' && !q) {
              q = parseToolJson<{ id: string; question: string }>(content);
            }
          },
        },
        ctrl,
      );
      relay.done();
    } catch (e) {
      if (!(e instanceof HarnessUnavailable)) console.warn('[boss] agent question failed:', e instanceof Error ? e.message : e);
    }

    if (!q) {
      // Keyless (or the model ignored its tools): deterministic REST path.
      const r = await restQuestion(seen);
      send({ t: 'boss', ev: 'say', text: r.taunt || pick(CANNED_LINES.asking) });
      q = { id: r.id, question: r.question };
    }
    seen.push(q.id);
    send({ t: 'boss', ev: 'question', qid: q.id, text: q.question, deadline: DEADLINE_S });
  }

  /** Pure flavor between rounds — the game asks on a timer. A round op
   *  preempts an in-flight taunt (new turn cancels the old; that's fine). */
  let taunting = false;
  async function taunt(): Promise<void> {
    if (taunting) return;
    taunting = true;
    try {
      const ctrl = AbortSignal.timeout(AGENT_TIMEOUT_MS);
      const sid = await sessionFor('boss:mark', MARK_DEF, ctrl);
      const relay = makeSayRelay();
      await streamTurn(
        sid,
        userMessage(
          '[MID-FIGHT] The player is still shooting at you. One fresh insult, one or ' +
          'two sentences, in character. Call mark_taunt_material first if you want a ' +
          'real San Francisco fact to sharpen it. Do not ask a question.',
        ),
        { onDelta: (chunk) => relay.delta(chunk) },
        ctrl,
      );
      relay.done();
    } catch {
      send({ t: 'boss', ev: 'say', text: pick(CANNED_LINES.idle) });
    } finally {
      taunting = false;
    }
  }

  async function judgeAnswer(qid: string, text: string): Promise<void> {
    const answer = text.trim() || '(said nothing and stared)';
    let v: RestVerdict | null = null;
    let line = '';
    try {
      const ctrl = AbortSignal.timeout(AGENT_TIMEOUT_MS);
      const sid = await sessionFor('boss:mark', MARK_DEF, ctrl);
      const result = await streamTurn(
        sid,
        userMessage(
          `[PLAYER ANSWER] The player answers: "${answer}". Call mark_judge_answer ` +
          `with question_id="${qid}" and that answer, then react to the verdict in ` +
          'one or two spoken sentences. If they were right, be grudging; if wrong, gloat.',
        ),
        {
          onDelta: () => { /* the reaction arrives whole, with the verdict */ },
          onToolResponse: (name, content) => {
            if (name === 'mark_judge_answer' && !v) v = parseToolJson<RestVerdict>(content);
          },
        },
        ctrl,
      );
      line = result.text.trim();
    } catch (e) {
      if (!(e instanceof HarnessUnavailable)) console.warn('[boss] agent judge failed:', e instanceof Error ? e.message : e);
    }

    if (!v) v = await restJudge(qid, answer);
    const verdict: RestVerdict = v;
    if (!line) line = `${pick(verdict.correct ? CANNED_LINES.right : CANNED_LINES.wrong)} ${verdict.fact}`;
    send({
      t: 'boss', ev: 'verdict', qid,
      correct: verdict.correct, expected: verdict.expected, detail: verdict.detail, line,
    });
  }

  return {
    handle(frame): void {
      if (frame.do === 'taunt') { void taunt(); return; } // flavor never blocks rounds
      if (busy) return; // one round op in flight per player; the client waits
      busy = true;
      const run = frame.do === 'question' ? askQuestion() : judgeAnswer(frame.qid, frame.text);
      void run
        .catch((e) => {
          // Even the REST net failed (mark server down): concede the round.
          console.warn('[boss] round failed entirely:', e instanceof Error ? e.message : e);
          if (frame.do === 'answer') {
            send({
              t: 'boss', ev: 'verdict', qid: frame.qid, correct: true,
              expected: '(the auditor lost his paperwork)',
              detail: 'mark server unreachable',
              line: 'I... appear to have misplaced the question. This round is yours, founder.',
            });
          } else {
            send({ t: 'boss', ev: 'say', text: 'My question ledger is... missing. Consider yourself lucky.' });
          }
        })
        .finally(() => { busy = false; });
    },
  };
}
