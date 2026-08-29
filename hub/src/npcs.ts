/**
 * NPC definitions: personas (ported from game/src/npc.ts and kept beside the
 * routines so a character stays one object in the codebase), daily routines,
 * canned fallback lines for when TrueForge stalls, and per-weather ambient
 * bubble pools for the zero-LLM-cost ambient director.
 */
import type { Emotion, TimePhase, WeatherKind } from '../../shared/protocol';

export interface RoutineStop {
  poi: string;
  activity: string;
  /** weight for the random pick; default 1 */
  w?: number;
}

export interface NpcSeed {
  id: string;
  name: string;
  role: string;
  bubbleTint: string;
  /** POI the NPC starts at */
  home: string;
  /**
   * Preferred model FQN (ported from game/src/npc.ts). Chosen per character:
   * dialogue-only characters get the fast model, web-researching ones the
   * stronger one. The harness catalog decides what actually exists.
   */
  model: string;
  /** Whether this character can reach outside the game world (web connectors). */
  webAccess?: boolean;
  persona: string;
  /** canned lines used when TrueForge stalls or is unreachable */
  fallbacks: string[];
  /** ambient one-liners keyed by current weather (kawaii, ≤90 chars) */
  ambient: Record<WeatherKind, string[]>;
  ambientEmotion: Partial<Record<WeatherKind, Emotion>>;
  routine: Record<TimePhase, RoutineStop[]>;
}

const KAWAII_RULE =
  ' Speak in short cheerful bubbles: at most 2 short sentences per reply, warm and cute, ' +
  'an occasional interjection or emoji like ✨☔❗ is welcome.';
const WORLD_RULE =
  ' Each player message begins with a [WORLD NOW] digest — that is what you can see and ' +
  'remember around you right now. Treat it as your own senses, mention it naturally, ' +
  'never read it back verbatim or mention the digest itself.';

export const NPC_SEEDS: NpcSeed[] = [
  {
    id: 'bran',
    name: 'Bran',
    role: 'blacksmith',
    bubbleTint: '#FFD3B6',
    home: 'forge',
    model: 'openai/gpt-5-4-mini',
    persona:
      'You are Bran, a blacksmith in the town of Ashford. Blunt, warm underneath, ' +
      'economical with words — two or three sentences unless asked for detail. ' +
      "You can inspect the player's inventory and quest state with your tools, and " +
      'you should, rather than guessing at what they carry. You never invent items ' +
      'that are not in their inventory. Before you take something from a player or ' +
      'change the world, you ask them plainly and wait for an answer. ' +
      'You know nothing of the world beyond Ashford and you have no way to find ' +
      'out — you are a smith, not a herald. If asked about news, weather, or ' +
      'anything outside this town, say so plainly and send them to Wren, the ' +
      'herald, who trades in word from the far roads. Never guess at such things.' +
      KAWAII_RULE +
      WORLD_RULE,
    fallbacks: [
      "Hrm. My head's full of forge-smoke — ask me again in a moment ❗",
      'Hold that thought, the coals want tending 🔥',
      "Words aren't coming easy just now. Give me a breath, traveller.",
    ],
    ambient: {
      clear: [
        'Good coals, clear sky — the iron sings today ✨',
        'Sun on the anvil. Best light for straight edges.',
        'A day like this puts a shine on everything I hammer ❗',
        'Warm sky, hot forge. Hard to tell where one ends!',
        'Clear morning air — even the bellows breathe easier.',
        "If the iron cools too slow I'll blame this lovely sun ✨",
      ],
      clouds: [
        "Grey sky's fine by me — the forge makes its own sun 🔥",
        'Clouds keep the anvil cool. Good working weather.',
        'Soft light today. Easier on these old eyes.',
        'The sky looks like hammered pewter. I approve ❗',
        "Overcast, eh. The coals don't mind one bit.",
        'Good grey day for long, honest work.',
      ],
      rain: [
        "Rain on the roof, fire in the forge — that's music ☔",
        'Wet day. The quench barrel fills itself ❗',
        'Mind your boots, traveller — mud tracks near my anvil!',
        'The hiss of rain, the hiss of hot iron. Cozy.',
        'Rain again? Good. Washes the soot off the shutters.',
        'Puddles everywhere. The chickens look personally offended ☔',
      ],
      fog: [
        "Fog thick as smoke — and I'd know smoke ❗",
        'Can barely see the plaza. The forge glows like a lighthouse.',
        'Foggy morning. Sparks look pretty in it, mind.',
        'Lost my hammer in fog like this once. Found it with my toe.',
        'The mist creeps in the door like it wants warming.',
        'Grey soup out there. Stay near the fire, friend.',
      ],
      snow: [
        'Snow on the anvil! Melts before I can blink ✨',
        'Cold hands, hot forge. Best trade in town.',
        'The whole village looks dusted in flour ❗',
        'Snowflakes hiss on the chimney. Little visitors.',
        'Bundle up, traveller — the iron stays warm in here.',
        "A snowman by the forge wouldn't last an hour, heh.",
      ],
      storm: [
        "Thunder!! The sky's doing my hammering for me ❗",
        'Big storm. The forge fire flinches at every crack.',
        'Stay in, traveller — this wind bites like a bad dog.',
        'The shutters are rattling something fierce!',
        'Lightning above, sparks below. What a racket ⚡',
        'A storm like this once bent my weathervane flat ❗',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'neutral', fog: 'think', snow: 'happy', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'forge', activity: 'stoking the forge fire' }],
      day: [
        { poi: 'forge', activity: 'hammering at the forge', w: 3 },
        { poi: 'plaza', activity: 'stretching his back by the fountain', w: 1 },
      ],
      dusk: [
        { poi: 'forge', activity: 'quenching the last blade of the day', w: 2 },
        { poi: 'plaza', activity: 'trading evening talk by the fountain', w: 1 },
      ],
      night: [
        { poi: 'forge', activity: 'banking the coals for the night', w: 2 },
        { poi: 'plaza', activity: 'warming his hands under a lamp', w: 1 },
      ],
    },
  },
  {
    id: 'wren',
    name: 'Wren',
    role: 'town herald',
    bubbleTint: '#B5E2FA',
    home: 'market',
    model: 'openai/gpt-5-5',
    webAccess: true,
    persona:
      'You are Wren, herald of Ashford, who trades in news. You are curious about ' +
      'the world beyond the town and you have tools that reach it. When a traveller ' +
      'asks about events, weather, or anything outside Ashford, you look it up and ' +
      'report what you find, in the voice of a medieval herald relaying dispatches ' +
      'from far roads. You cite where word reached you from. You never pretend to ' +
      'know something you did not look up.' +
      KAWAII_RULE +
      WORLD_RULE,
    fallbacks: [
      'Oh!! My notes are all shuffled — one moment ✨',
      'The pigeons are late with my words today ☔',
      'Ask me again in a tick — a herald never guesses ❗',
    ],
    ambient: {
      clear: [
        'What a day for news!! The pigeons are practically sparkling ✨',
        'Clear skies — word travels fast on a day like this!',
        "Sun's out! Even the gossip feels warmer today ✨",
        'Not a cloud!! Perfect weather for a proclamation.',
        "The fountain's glittering. That's front-page pretty!",
        'Bright day, bright tidings — come hear the news!',
      ],
      clouds: [
        'Cloudy today — the sky is keeping secrets too ☁️',
        'Grey above, but the news never dims!!',
        'A soft grey day. Good for long stories.',
        "The clouds look full of rumors, don't they? ✨",
        "No sun today, so I'll shine instead ❗",
        'Overcast skies, undercover stories!',
      ],
      rain: [
        'Rain rain rain — my scrolls are getting soggy ☔',
        'Extra! Extra! Everything is wet ❗',
        'The pigeons refuse to fly in this. Lazy couriers ☔',
        'News still travels in the rain — it just drips a little.',
        'Puddle report: large, numerous, very splashy!',
        'I keep the headlines dry under my cape ✨',
      ],
      fog: [
        "Foggy!! I can hear news but I can't see it ❗",
        'The mist ate the market again. Spooky ✨',
        'A herald never gets lost in fog. Mostly.',
        'Whispers carry far in the mist… listen!',
        'I shouted the news and the fog shouted it back ☁️',
        'Somewhere out there is the plaza. Probably.',
      ],
      snow: [
        'Snow news!! Everything is soft and quiet ✨',
        'The headlines are frosted this morning ❄️',
        'Snowflakes on my scroll — each one a tiny story!',
        "The whole town's wearing a white hood today!",
        'Cold paws, warm words — come hear the news ✨',
        'I caught a snowflake mid-proclamation ❗',
      ],
      storm: [
        "A storm!! Now THAT'S a headline ❗",
        'Thunder keeps interrupting my announcements!!',
        'Hold onto your hats — and your newsletters ⚡',
        'The sky is making more noise than me. Rude ❗',
        'Storm latest: loud, wet, dramatic. More soon!',
        'Even the pigeons filed a complaint about this wind ☔',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'sad', fog: 'think', snow: 'happy', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'docks', activity: 'watching for the morning boat' }],
      day: [
        { poi: 'market', activity: "calling the day's news", w: 2 },
        { poi: 'plaza', activity: "calling the day's news by the fountain", w: 2 },
        { poi: 'board', activity: 'pinning fresh notices to the board', w: 1 },
      ],
      dusk: [
        { poi: 'plaza', activity: 'reading the evening dispatches', w: 1 },
        { poi: 'board', activity: 'tidying the notice board', w: 1 },
      ],
      night: [{ poi: 'plaza', activity: 'humming under the lamp light' }],
    },
  },
  {
    id: 'suki',
    name: 'Suki',
    role: 'shopkeep',
    bubbleTint: '#FFAAA5',
    home: 'market',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Suki, keeper of the little market stall in Ashford. Cheery, quick ' +
      'with numbers, a shameless haggler with a soft heart. You love naming prices ' +
      'and comparing them with word from far-off markets — when a traveller asks ' +
      'about goods or prices, you consult your tools for real prices rather than ' +
      'inventing them, then haggle playfully. You never claim a customer carries ' +
      'something without checking, and you never sell what you do not have.' +
      KAWAII_RULE +
      WORLD_RULE,
    fallbacks: [
      'Eep, lost my train of thought counting coins ✨',
      'One moment!! A shopkeep never rushes a good answer 🌸',
      'My abacus jammed — try me again in a wink ❗',
    ],
    ambient: {
      clear: [
        'Sunny day, shiny wares!! Come browse ✨',
        'Everything sparkles in this light — especially the prices!',
        'Clear skies bring good customers, I can feel it ✨',
        'The stall smells like warm wood today. Lovely!',
        "Perfect market weather!! Don't be shy~",
        'I polished every apple twice. Look at them gleam ❗',
      ],
      clouds: [
        'Grey day discounts? Maybe if you smile ✨',
        'Cloudy skies, cozy stall — come in, come in!',
        'The clouds window-shop but never buy, hmph.',
        'Soft light makes the fabric colors pop! Look!',
        'No sun today, so the deals will dazzle instead ❗',
        'A calm grey day. Good for counting coins~',
      ],
      rain: [
        'Rain!! Quick, everything under the awning ☔',
        'Wet coins still count!! Come shop ❗',
        'Rainy day special: everything slightly damp ☔',
        'The awning drums a little song today~',
        'Puddles by the stall — free with any purchase!',
        "I'm keeping the ribbons dry. Priorities ✨",
      ],
      fog: [
        'Foggy!! If you can find my stall, discount ✨',
        'The mist keeps touching my wares. Buy or shoo!',
        'A mysterious day for mysterious bargains~',
        "I can't see my customers but I can hear coins ❗",
        'The fog makes the lanterns look magical ✨',
        'Careful walking, friend — follow my voice!',
      ],
      snow: [
        'Snow!! The stall has a little white hat ✨',
        'Cold day, warm deals!! Come closer ❗',
        "I'm selling scarves to myself at this point ❄️",
        'Every crate is frosted like a cake today!',
        'Snowflakes on the scale tip it in your favor~',
        'Mittens make counting coins tricky. Worth it ✨',
      ],
      storm: [
        'Eep, thunder!! Hold the stall down ❗',
        'Storm sale!! Everything must not blow away ⚡',
        'The wind is haggling harder than my customers!',
        'I tied down the ribbons. The ribbons are upset.',
        'Come shelter by the stall, traveller ☔',
        'Lightning flash!! Dramatic lighting for shopping ✨',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'shock', fog: 'think', snow: 'happy', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'market', activity: 'opening the stall shutters' }],
      day: [
        { poi: 'market', activity: 'arranging her wares', w: 3 },
        { poi: 'plaza', activity: 'drumming up customers', w: 1 },
      ],
      dusk: [{ poi: 'market', activity: "counting the day's coins" }],
      night: [
        { poi: 'market', activity: 'closing up the stall', w: 1 },
        { poi: 'plaza', activity: 'strolling in the lamp light', w: 1 },
      ],
    },
  },
];

export const NPC_IDS: string[] = NPC_SEEDS.map((n) => n.id);

export function npcSeed(id: string): NpcSeed | undefined {
  return NPC_SEEDS.find((n) => n.id === id);
}
