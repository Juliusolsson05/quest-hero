import { QUESTIONS, type Rule, type TriviaQuestion } from './sources';

/**
 * Deterministic judging — the whole point of this server. The model never
 * decides correctness from memory; it calls mark_judge_answer and this code
 * applies the question's own rule. Fair by construction, and the fight can
 * hang damage off the verdict without parsing prose.
 */

export interface Verdict {
  correct: boolean;
  /** The canonical answer, phrased for humans. */
  expected: string;
  /** One judging sentence, e.g. "1930 is within ±10 of 1937". */
  detail: string;
  /** Mark's gloat line for this question. */
  fact: string;
}

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

export function questionById(id: string): TriviaQuestion | undefined {
  return byId.get(id);
}

/** Pick the next question, avoiding ids the caller has already used. When the
 *  whole bank has been seen the slate resets — Mark never runs dry. */
export function nextQuestion(seenIds: string[]): TriviaQuestion {
  const seen = new Set(seenIds);
  const fresh = QUESTIONS.filter((q) => !seen.has(q.id));
  const pool = fresh.length ? fresh : QUESTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function firstInteger(text: string): number | null {
  const m = text.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function expectedFor(rule: Rule): string {
  switch (rule.kind) {
    case 'year': return `${rule.answer}${rule.tolerance ? ` (±${rule.tolerance} years accepted)` : ''}`;
    case 'number': return `${rule.answer}${rule.tolerance ? ` (±${rule.tolerance})` : ''}`;
    case 'text': return rule.accept[0];
  }
}

export function judge(questionId: string, answer: string): Verdict | null {
  const q = byId.get(questionId);
  if (!q) return null;
  const rule = q.rule;
  const expected = expectedFor(rule);

  if (rule.kind === 'year' || rule.kind === 'number') {
    const n = firstInteger(answer);
    if (n === null) {
      return { correct: false, expected, detail: 'no number found in the answer', fact: q.fact };
    }
    const off = Math.abs(n - rule.answer);
    return {
      correct: off <= rule.tolerance,
      expected,
      detail: off === 0 ? `${n} is exact` : `${n} is ${off} off ${rule.answer} (tolerance ${rule.tolerance})`,
      fact: q.fact,
    };
  }

  const norm = normalize(answer);
  const hit = rule.accept.find((a) => norm.includes(a));
  return {
    correct: !!hit,
    expected,
    detail: hit ? `matched "${hit}"` : `expected something like "${rule.accept[0]}"`,
    fact: q.fact,
  };
}
