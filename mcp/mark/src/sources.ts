/**
 * The question bank — configuration the server builds its tools from, so the
 * tools and the data cannot drift. Every question carries its own judging
 * rule; the answer key lives HERE and nowhere else (never in an agent's
 * instructions — the TrueForge agent library is not private).
 *
 * Rules: `year`/`number` accept the first integer found in the player's
 * answer, within ±tolerance. `text` accepts any listed alias as a
 * case-insensitive substring. The `fact` line doubles as taunt material.
 */

export type Rule =
  | { kind: 'year'; answer: number; tolerance: number }
  | { kind: 'number'; answer: number; tolerance: number }
  | { kind: 'text'; accept: string[] };

export interface TriviaQuestion {
  id: string;
  category: 'landmarks' | 'history' | 'culture' | 'city-life';
  difficulty: 1 | 2 | 3;
  question: string;
  rule: Rule;
  /** One true sentence for Mark to gloat with after judging. */
  fact: string;
}

export const QUESTIONS: TriviaQuestion[] = [
  {
    id: 'golden-gate-year', category: 'landmarks', difficulty: 1,
    question: 'What year did the Golden Gate Bridge open? I will generously allow you ten years either way.',
    rule: { kind: 'year', answer: 1937, tolerance: 10 },
    fact: 'The Golden Gate Bridge opened in 1937 and came in under budget — unlike every startup you will ever run.',
  },
  {
    id: 'quake-year', category: 'history', difficulty: 1,
    question: 'The great San Francisco earthquake and fire — what year? Within ten years.',
    rule: { kind: 'year', answer: 1906, tolerance: 10 },
    fact: 'April 18, 1906. The city burned for three days and rebuilt faster than your cap table will.',
  },
  {
    id: 'cable-car-year', category: 'history', difficulty: 3,
    question: 'What year did the first cable car run in San Francisco? Ten years of slack, since you clearly need it.',
    rule: { kind: 'year', answer: 1873, tolerance: 10 },
    fact: 'Andrew Hallidie ran the first cable car down Clay Street in 1873 — real hardware, no seed round.',
  },
  {
    id: 'alcatraz-closed', category: 'history', difficulty: 2,
    question: 'What year did the federal prison on Alcatraz close? Ten years either way.',
    rule: { kind: 'year', answer: 1963, tolerance: 10 },
    fact: 'Alcatraz closed in 1963 because it was too expensive to run. Sound familiar, founder?',
  },
  {
    id: 'summer-of-love', category: 'culture', difficulty: 2,
    question: 'The Summer of Love in Haight-Ashbury — what year? Within ten.',
    rule: { kind: 'year', answer: 1967, tolerance: 10 },
    fact: '1967. A hundred thousand people showed up with flowers and no business model. Your people.',
  },
  {
    id: 'gold-rush', category: 'history', difficulty: 1,
    question: 'What year did the forty-niners flood into San Francisco for the gold rush? Ten-year window.',
    rule: { kind: 'year', answer: 1849, tolerance: 10 },
    fact: 'The forty-niners of 1849 — the original get-rich-quick crowd. The ones who got rich sold shovels.',
  },
  {
    id: 'bart-year', category: 'city-life', difficulty: 3,
    question: 'What year did BART start carrying passengers? Within ten years.',
    rule: { kind: 'year', answer: 1972, tolerance: 10 },
    fact: 'BART opened in 1972 and has been "experiencing delays" ever since.',
  },
  {
    id: 'un-charter', category: 'history', difficulty: 3,
    question: 'The United Nations Charter was signed right here in San Francisco. What year? Ten years of grace.',
    rule: { kind: 'year', answer: 1945, tolerance: 10 },
    fact: 'The UN Charter was signed at the Veterans War Memorial in 1945. World peace shipped from SF before your MVP did.',
  },
  {
    id: 'levis-year', category: 'culture', difficulty: 3,
    question: 'Levi Strauss patented riveted blue jeans in this city. What year? I will allow ten either way.',
    rule: { kind: 'year', answer: 1873, tolerance: 10 },
    fact: 'Levi Strauss and Jacob Davis patented riveted denim in 1873 — profitable from year one. Imagine that.',
  },
  {
    id: 'giants-arrived', category: 'culture', difficulty: 2,
    question: 'What year did the Giants move from New York to San Francisco? Ten-year window.',
    rule: { kind: 'year', answer: 1958, tolerance: 10 },
    fact: 'The Giants arrived in 1958. Even baseball teams pivot to SF.',
  },
  {
    id: 'hills-count', category: 'city-life', difficulty: 1,
    question: 'San Francisco is famously built on how many original hills? Exact number.',
    rule: { kind: 'number', answer: 7, tolerance: 0 },
    fact: 'Seven hills, like Rome — except Rome never made you walk up Filbert Street for a coffee.',
  },
  {
    id: 'sea-lions-pier', category: 'city-life', difficulty: 1,
    question: 'The sea lions haul out at which numbered pier? Exact number.',
    rule: { kind: 'number', answer: 39, tolerance: 0 },
    fact: 'Pier 39. The sea lions showed up in 1989, paid no rent, and became the biggest draw on the waterfront. Great unit economics.',
  },
  {
    id: 'gg-color', category: 'landmarks', difficulty: 1,
    question: 'What is the official color of the Golden Gate Bridge called?',
    rule: { kind: 'text', accept: ['international orange', 'orange'] },
    fact: 'International Orange — chosen because the Navy wanted black with yellow stripes. Design review saved the century.',
  },
  {
    id: 'fog-name', category: 'culture', difficulty: 1,
    question: 'The San Francisco fog has a first name. What is it?',
    rule: { kind: 'text', accept: ['karl'] },
    fact: 'Karl the Fog — more followers than your startup will ever have.',
  },
  {
    id: 'coit-hill', category: 'landmarks', difficulty: 2,
    question: 'Coit Tower stands on top of which hill?',
    rule: { kind: 'text', accept: ['telegraph'] },
    fact: 'Telegraph Hill — named for the semaphore that announced arriving ships. The original push notification.',
  },
  {
    id: 'painted-park', category: 'landmarks', difficulty: 2,
    question: 'The Painted Ladies face which square?',
    rule: { kind: 'text', accept: ['alamo'] },
    fact: 'Alamo Square. Seven Victorians that survived 1906 and every real-estate cycle since.',
  },
  {
    id: 'crooked-street', category: 'landmarks', difficulty: 1,
    question: 'Name the street everyone calls the crookedest in the world.',
    rule: { kind: 'text', accept: ['lombard'] },
    fact: 'Lombard Street — eight hairpins on a 27% grade. Still straighter than your growth curve.',
  },
  {
    id: 'transamerica-shape', category: 'landmarks', difficulty: 1,
    question: 'The Transamerica building is famous for what shape?',
    rule: { kind: 'text', accept: ['pyramid', 'triangle'] },
    fact: 'A pyramid — designed so light reaches the street. Skyscrapers used to have manners.',
  },
  {
    id: 'bread-kind', category: 'culture', difficulty: 1,
    question: 'Which bread is San Francisco world-famous for?',
    rule: { kind: 'text', accept: ['sourdough'] },
    fact: 'Sourdough — the local wild yeast is literally named lactobacillus sanfranciscensis. The city has a bacterium with better branding than you.',
  },
  {
    id: 'mission-name', category: 'history', difficulty: 2,
    question: 'The oldest surviving building in the city is a mission. Which one?',
    rule: { kind: 'text', accept: ['dolores'] },
    fact: 'Mission Dolores, 1776 — two hundred and fifty years of uptime. Beat that SLA.',
  },
  {
    id: 'chinatown-gate', category: 'landmarks', difficulty: 3,
    question: 'The gate at the Grant Avenue entrance to Chinatown is called the what Gate?',
    rule: { kind: 'text', accept: ['dragon'] },
    fact: "The Dragon Gate — a 1970 gift, and the only real ceremonial gate outside Asia. Chinatown here is the oldest in North America.",
  },
  {
    id: 'burning-beach', category: 'culture', difficulty: 2,
    question: 'Which famous festival was born on Baker Beach before it moved to the desert?',
    rule: { kind: 'text', accept: ['burning man'] },
    fact: 'Burning Man started on Baker Beach in 1986 — proof that even bonfires scale out of the city eventually.',
  },
];

/** Canned trash talk for the keyless fallback path; the agent improvises live. */
export const CANNED_TAUNTS = [
  'You are NEVER going to make it as a founder.',
  'I have audited lemonade stands with better fundamentals than you.',
  'Your burn rate is impressive. Everything else, no.',
  'Answer me this — if your last demo did not.',
  'I ask the questions here. You provide the disappointing answers.',
];
