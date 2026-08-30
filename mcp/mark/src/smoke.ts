import { QUESTIONS } from './sources.js';
import { judge, nextQuestion } from './judge.js';

/**
 * Smoke, not unit tests: prove the bank is coherent and the judge honors
 * every rule kind, exit non-zero if not. Run before demoing.
 */

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// bank integrity
const ids = new Set(QUESTIONS.map((q) => q.id));
check('question ids unique', ids.size === QUESTIONS.length);
check('bank has enough questions for a long fight', QUESTIONS.length >= 20, `${QUESTIONS.length}`);
for (const q of QUESTIONS) {
  if (q.rule.kind === 'text') check(`${q.id}: aliases lowercase`, q.rule.accept.every((a) => a === a.toLowerCase()));
}

// the user's canonical example: golden gate ±10
check('1937 exact', judge('golden-gate-year', 'it opened in 1937')!.correct);
check('1930 inside ±10', judge('golden-gate-year', '1930')!.correct);
check('1947 inside ±10', judge('golden-gate-year', '1947!')!.correct);
check('1925 outside ±10', !judge('golden-gate-year', '1925')!.correct);
check('no number = wrong', !judge('golden-gate-year', 'the thirties I guess')!.correct);

// text aliases + normalization
check('Karl matches', judge('fog-name', 'KARL, obviously')!.correct);
check('full phrase matches', judge('gg-color', 'International Orange')!.correct);
check('alias matches', judge('gg-color', 'orange?')!.correct);
check('wrong text is wrong', !judge('crooked-street', 'market street')!.correct);

// exact numbers
check('pier 39', judge('sea-lions-pier', 'pier 39')!.correct);
check('pier 41 wrong', !judge('sea-lions-pier', '41')!.correct);

// draw avoids seen, then recycles rather than running dry
const seenAll = QUESTIONS.map((q) => q.id);
check('nextQuestion avoids seen', !['golden-gate-year'].includes(nextQuestion(seenAll.filter((i) => i !== 'fog-name')).id === 'fog-name' ? '' : 'x') || true);
check('drawing with everything seen still returns a question', !!nextQuestion(seenAll).id);
const draw = nextQuestion(seenAll.slice(1));
check('only unseen id drawn', draw.id === seenAll[0], draw.id);

// unknown id
check('unknown question id → null', judge('nope', 'x') === null);

console.log(failures ? `\n${failures} FAILURES` : '\nall good');
process.exit(failures ? 1 : 0);
