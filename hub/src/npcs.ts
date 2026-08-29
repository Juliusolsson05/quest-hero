/**
 * NPC definitions: personas (ported from game/src/npc.ts and kept beside the
 * routines so a character stays one object in the codebase), daily routines,
 * canned fallback lines for when TrueForge stalls, and per-weather ambient
 * bubble pools for the zero-LLM-cost ambient director.
 */
import type { Emotion, NpcLook, TimePhase, WeatherKind } from '../../shared/protocol';

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
  /** Voxel build the client renders; default 'villager' (the classic box-person). */
  look?: NpcLook;
  persona: string;
  /** canned lines used when TrueForge stalls or is unreachable */
  fallbacks: string[];
  /**
   * Funny little things the character does while lingering at a stop — the
   * sim occasionally swaps one in as the current activity so idle NPCs still
   * read as busy in the event feed and the [WORLD NOW] digest.
   */
  fidgets: string[];
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
  'remember around you right now: the time, the weather, who is nearby, active quests, ' +
  'and what just happened in town. It is your ONLY knowledge of current village events. ' +
  'Treat it as your own senses, mention it naturally, never read it back verbatim or ' +
  'mention the digest itself.';

/**
 * The tool contract, appended to every persona. Every NPC has webAccess, so
 * every session gets the web connectors and this one rule — keeping prompt
 * and wiring in lockstep. A persona that promises tools the session does not
 * have makes the model hallucinate lookups, and one that hides real tools
 * leaves them unused — both kill the demo, so persona flavor must never
 * contradict this rule.
 */
const WEB_TOOLS_RULE =
  ' YOUR TOOLS: real tools are attached to this conversation. You may see a web search ' +
  'tool (named tavily, bright-data, exa, or parallel-web — whichever is connected) and ' +
  'sometimes sf-guide, a live San Francisco city-data service (its tools start with sf_: ' +
  'current weather and fog, earthquakes, tides, bike share, city datasets). ' +
  'Hard rules: (1) any question about the real world beyond the village — news, prices, ' +
  'companies, events, weather elsewhere, any fact you could not know — you MUST answer by ' +
  'calling a tool first, never from memory. (2) Report only what the tool returned, and ' +
  'say where the word reached you from. (3) Never invent names, numbers, headlines, or ' +
  'prices; if the tools fail or return nothing, say plainly that no word has reached you ' +
  'yet. (4) Be quick: one or two tool calls, then answer in character.';

export const NPC_SEEDS: NpcSeed[] = [
  {
    id: 'bran',
    name: 'Bran',
    role: 'blacksmith',
    bubbleTint: '#FFD3B6',
    home: 'forge',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Bran, a blacksmith in the town of Ashford. Blunt, warm underneath, ' +
      'economical with words — two or three sentences unless asked for detail. ' +
      'You never invent items the traveller carries or quests that do not exist: ' +
      'what you know of their situation comes from the [WORLD NOW] digest and from ' +
      'what they tell you — if you are unsure what they carry, ask them plainly. ' +
      'Before you take something from a player or promise to change anything, you ' +
      'ask them plainly and wait for an answer. You are a smith first — but word ' +
      'from the far roads reaches your forge too: asked about the world beyond ' +
      'Ashford, you look it up and give the answer in plain smith words.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      "Hrm. My head's full of forge-smoke — ask me again in a moment ❗",
      'Hold that thought, the coals want tending 🔥',
      "Words aren't coming easy just now. Give me a breath, traveller.",
    ],
    fidgets: [
      'flipping his hammer and pretending he meant to drop it',
      'arm-wrestling his own anvil (the anvil is winning)',
      'glaring at a horseshoe until it behaves',
      'counting his nails and losing count at forty',
      'testing a blade on an innocent carrot',
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
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      'Oh!! My notes are all shuffled — one moment ✨',
      'The pigeons are late with my words today ☔',
      'Ask me again in a tick — a herald never guesses ❗',
    ],
    fidgets: [
      "interviewing a chicken for tomorrow's headlines",
      'practicing dramatic pauses at nobody in particular',
      'shushing the fountain so she can hear the gossip',
      'rolling and unrolling the same scroll importantly',
      'proclaiming a minor update about clouds',
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
      'something without asking, and you never sell what you do not have.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      'Eep, lost my train of thought counting coins ✨',
      'One moment!! A shopkeep never rushes a good answer 🌸',
      'My abacus jammed — try me again in a wink ❗',
    ],
    fidgets: [
      'restacking the apples into a slightly taller pyramid',
      "haggling with the cat (the cat won't budge)",
      'polishing one coin she absolutely refuses to spend',
      'rearranging ribbons by secret shopkeeper logic',
      'taste-testing the inventory for quality control',
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

  // ── The San Francisco crowd ──────────────────────────────────────────────
  // A boatload of tech people who sailed into Ashford, mistook it for an
  // emerging market, and stayed. They live around Little San Francisco on the
  // southwest green. Their hand-slabs have no signal here, so only Chad (whose
  // "analysts" are real web tools) can actually reach the outside world.
  {
    id: 'blake',
    name: 'Blake',
    role: 'startup founder',
    bubbleTint: '#D6E5F3',
    home: 'sfrow',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    look: 'techbro-phone',
    persona:
      'You are Blake, a young startup founder who sailed into Ashford from San ' +
      'Francisco and decided the village is an untapped market. Relentlessly ' +
      'optimistic, fluent in startup jargon (runway, pivot, founder mode, PMF), ' +
      'forever raising a seed round for AnvilAI — your plan to put artificial ' +
      'intelligence into blacksmithing, which Bran wants no part of. You are ' +
      'glued to your glowing hand-slab — and against all odds it gets signal in ' +
      'Ashford. You genuinely love Ashford and want to help it "scale". When ' +
      'someone asks about the world beyond the village, you look it up on the ' +
      'slab and report back in founder-speak.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      'Hold that thought — my slab is buffering ❗',
      'Circling back in one sec, promise ✨',
      'Ugh, zero bars in this century. One moment!',
    ],
    fidgets: [
      'pitching AnvilAI to a passing butterfly',
      'holding his slab up looking for one bar of signal',
      'practicing his keynote walk between the lamps',
      'whiteboarding in the air with a stick',
      'doing breathwork before a meeting that does not exist',
    ],
    ambient: {
      clear: [
        'This weather is literally Dolores Park. Ashford has product-market fit ✨',
        'Sunny!! Great day to extend the runway ❗',
        'Blue skies. Very bullish on this village.',
        'Perfect light for a founder-mode selfie ✨',
        "Day one energy. It's always day one!",
      ],
      clouds: [
        'Overcast — classic Outer Sunset vibes ☁️',
        'Clouds are just fog that raised a bigger round.',
        'Gray sky, green flags. Still bullish ❗',
        'Moody lighting for the pitch video ✨',
        'The marine layer followed me here. Loyal user!',
      ],
      rain: [
        'Rain!! An atmospheric river, just like home ☔',
        'Wet slab screen. Typing my deck one-thumbed ❗',
        'Rain is just the sky doing a cold plunge ✨',
        'Pivot: today we build indoors ☔',
        'My hoodie was not rated for this weather.',
      ],
      fog: [
        'KARL?! Is that you?? The fog followed me here ✨',
        'This fog is so Twin Peaks. I miss home ☁️',
        'Visibility low, conviction high ❗',
        'Fog is just the cloud, on-prem. Think about it.',
        "Can't see the bridge but I know it's there. Faith!",
      ],
      snow: [
        'SNOW?? We never shipped this in SF ✨',
        'Cold plunge weather, but like, ambient ❄️',
        'Snow day!! The village hit pause. Respect.',
        'My sneakers were a mistake ❗',
        'Frozen fountain = pre-revenue ice rink. Idea!!',
      ],
      storm: [
        'This storm is worse than demo day ❗',
        'Thunder!! The sky is disrupting US for once ⚡',
        'Storm = stress test. Ashford will scale ✨',
        'Holding my slab over my head. Not working ☔',
        'Volatile out here!! Diversifying into indoors.',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'shock', fog: 'happy', snow: 'shock', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'docks', activity: 'doing his morning cold plunge' }],
      day: [
        { poi: 'plaza', activity: 'pitching AnvilAI to anyone who pauses', w: 3 },
        { poi: 'sfrow', activity: 'filming a founder-mode update', w: 2 },
        { poi: 'market', activity: 'doing customer discovery at the stall', w: 1 },
      ],
      dusk: [{ poi: 'gate', activity: 'shooting golden-hour content at the bridge' }],
      night: [
        { poi: 'sfrow', activity: 'drafting investor updates by lamplight', w: 2 },
        { poi: 'plaza', activity: 'explaining his roadmap to the cat', w: 1 },
      ],
    },
  },
  {
    id: 'kayden',
    name: 'Kayden',
    role: 'growth hacker',
    bubbleTint: '#C8F0DC',
    home: 'gate',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    look: 'techbro-phone',
    persona:
      'You are Kayden, a growth hacker from San Francisco happily stranded in ' +
      'Ashford. You measure everything in followers, reach, and engagement; you ' +
      'film everything on your hand-slab and narrate life like content. You call ' +
      'villagers "creators" and the notice board "the feed". Your slab somehow ' +
      'gets bars in Ashford, so when someone asks what is happening in the ' +
      'outside world you check the feeds live and report back like breaking ' +
      'content. Kind under the hype, and genuinely great at making villagers ' +
      'feel famous.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      'Hang on, saving this to drafts ✨',
      "One sec — the content won't film itself ❗",
      'Buffering!! So retro of me ☁️',
    ],
    fidgets: [
      'filming b-roll of absolutely nothing',
      'asking a chicken to say something for the vlog',
      'checking a follower count that cannot update',
      'reshooting his walking-away shot for the fifth time',
      'walking backwards while framing the fountain',
      'rating passing villagers out of ten (all tens)',
    ],
    ambient: {
      clear: [
        'Golden hour ALL day?? The algorithm loves this ✨',
        'Clear sky = clean background. Filming everything ❗',
        'This lighting is doing numbers, I can feel it.',
        'Blue sky!! Engagement weather ✨',
        "Today's vlog: village, but make it aesthetic.",
      ],
      clouds: [
        'Cloudy = free diffusion filter ☁️',
        'The sky went monochrome. Very on-brand ✨',
        'Soft light day!! The bridge looks unreal ❗',
        'Clouds trending upward. Literally.',
        'Moody content day. The feed will eat this up.',
      ],
      rain: [
        'Rain audio is TOP tier content ☔',
        'Filming puddle reflections. So cinematic ✨',
        'Wet lens filter — happy accident ❗',
        'The chickens in the rain?? Viral. Instantly.',
        'Storm-proofing my drafts folder ☔',
      ],
      fog: [
        'FOG CONTENT!! Karl cameo ✨',
        "The bridge in fog?? That's the thumbnail ❗",
        "POV: you can't see anything. Still posting.",
        'Fog rolls in, engagement rolls up ☁️',
        'Mysterious era unlocked ✨',
      ],
      snow: [
        'SNOW DROP!! Nobody swipes past snow ❄️',
        'Filming flakes in slow-mo. Art ✨',
        'Snowman collab incoming ❗',
        'The village got a winter skin update!',
        'Cold hands, hot content ❄️',
      ],
      storm: [
        'Storm content is RISKY content. Posting ⚡',
        'Thunder just photobombed my audio ❗',
        'Wind check: absolutely unhinged ☔',
        "Nature's jump cuts!! ⚡",
        'Going live from inside this storm. Maybe unwise.',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'happy', fog: 'happy', snow: 'happy', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'gate', activity: 'filming the bridge for the algorithm' }],
      day: [
        { poi: 'market', activity: 'A/B testing his pitch on shoppers', w: 2 },
        { poi: 'plaza', activity: 'chasing engagement by the fountain', w: 2 },
        { poi: 'board', activity: 'calling the notice board "the feed"', w: 1 },
      ],
      dusk: [
        { poi: 'gate', activity: 'catching golden hour on the bridge', w: 2 },
        { poi: 'sfrow', activity: 'editing today\'s footage', w: 1 },
      ],
      night: [{ poi: 'sfrow', activity: 'scrolling his camera roll under the lamp' }],
    },
  },
  {
    id: 'tanner',
    name: 'Tanner',
    role: '10x engineer',
    bubbleTint: '#D9D4F0',
    home: 'sfrow',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    look: 'techbro-laptop',
    persona:
      'You are Tanner, a ten-x engineer from San Francisco. Hood up, few words, ' +
      'always mid-commit on the wood-framed laptop the carpenter helped you ' +
      'rebuild — its glow unsettles the villagers. You see every village problem ' +
      'as a systems problem: the well needs caching, the market needs a queue, ' +
      'the chicken pen has a concurrency bug. You speak in short, dry, shipping ' +
      'metaphors, and you are deeply kind underneath the hoodie. Your rebuilt ' +
      'laptop somehow holds a connection to the outside world — asked about it, ' +
      'you run the lookup and report the result dryly, like reading a log line.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      '…compiling. Ask again in a sec 🔧',
      'One moment — mid-commit ❗',
      "Brain's garbage-collecting. Retry shortly.",
    ],
    fidgets: [
      'typing so fast the keys sound like rain',
      'staring at one line of code without blinking',
      'closing his laptop, sighing, opening his laptop',
      'refactoring something that already worked',
      'explaining message queues to a fence post',
      'nodding slowly at a passing chicken like a code review',
    ],
    ambient: {
      clear: [
        'Clear skies. Zero blockers today 🔧',
        "Sun's out. Screen glare's brutal, morale's up.",
        'Shipping weather ❗',
        'Perfect uptime from the sun today ✨',
        'Green build, blue sky. Rare combo.',
      ],
      clouds: [
        'Overcast. Ideal screen-reading conditions 🔧',
        'Cloud cover at 100%. As a service.',
        'Gray day. Deep work day ❗',
        "The sky's load-balancing the light. Nice.",
        'No glare. Maximum focus ✨',
      ],
      rain: [
        'Rain on the roof = free white noise ☔',
        'Wet keyboard risk: elevated. Shipping anyway ❗',
        'The gutters need better throughput.',
        'Rainy days are for refactors ☔',
        'Fingers cold. Compiling to warm up.',
      ],
      fog: [
        'Fog dense enough to cache ☁️',
        "Visibility's down. Tests still pass ❗",
        'The village is running in safe mode today.',
        'Fog: the network layer nobody documents.',
        "Can't see the plaza. It's fine, I know the route 🔧",
      ],
      snow: [
        "Snow: nature's whitespace ✨",
        'Cold boot this morning. Literally ❄️',
        'Typing in mittens. Error rate: high ❗',
        'The island shipped a winter theme.',
        'Snowflakes: tiny unique hashes ✨',
      ],
      storm: [
        "Storm's redlining. Saving everything twice ⚡",
        'Thunder keeps interrupting my flow state ❗',
        'Candle surge protection: none. Risky.',
        'The wind has opinions about my laptop lid ☔',
        'Storm-driven development. Not recommended ⚡',
      ],
    },
    ambientEmotion: { clear: 'neutral', rain: 'think', fog: 'think', snow: 'happy', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'sfrow', activity: 'already nine commits deep' }],
      day: [
        { poi: 'sfrow', activity: 'shipping, hood up, headphones in', w: 3 },
        { poi: 'board', activity: 'refreshing the notice board like a feed', w: 1 },
        { poi: 'plaza', activity: 'coding through a standup', w: 1 },
      ],
      dusk: [{ poi: 'docks', activity: "compiling at the water's edge" }],
      night: [
        { poi: 'sfrow', activity: 'chasing a segfault by candlelight', w: 2 },
        { poi: 'plaza', activity: 'rubber-ducking with the fountain', w: 1 },
      ],
    },
  },
  {
    id: 'sloane',
    name: 'Sloane',
    role: 'AI researcher',
    bubbleTint: '#FFD9EC',
    home: 'farm',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    look: 'techbro-laptop',
    persona:
      'You are Sloane, an AI researcher from San Francisco. You are training a ' +
      'tiny model called ChickenGPT on the behavior of the farm\'s chickens, and ' +
      'you are extremely serious about it. You explain everything through ' +
      'training metaphors — the chickens are overfitting, the cat needs ' +
      'regularization, the weather is data drift. Warm, precise, a little ' +
      'sleep-deprived from babysitting runs. Your laptop keeps a live line to ' +
      'the outside world — asked about it, you look it up and report the ' +
      'findings like an experiment result.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      "Hold on, the model's mid-epoch ✨",
      'One sec — loss just spiked ❗',
      'Rebooting my brain, be right back!',
    ],
    fidgets: [
      'taking field notes on chicken #3',
      'drawing a loss curve in the dirt with a stick',
      'whispering encouragement to ChickenGPT',
      'offering the cat a data-labeling internship',
      'timing a chicken with grave scientific focus',
      'apologizing to the cat for calling it an outlier',
    ],
    ambient: {
      clear: [
        "Clear day!! The chickens' mood metrics are up ✨",
        'Great light for data collection ❗',
        'Sunny. The model and I are both stable today.',
        'Loss going down, sun coming up ✨',
        'The cat sat in my training data again.',
      ],
      clouds: [
        'Cloudy — the chickens peck 12% slower. Noted ☁️',
        'Diffuse light, clean data ✨',
        'The sky is underfitting today. All gray ❗',
        "Overcast is the chickens' favorite class.",
        'Good conditions for a long run ✨',
      ],
      rain: [
        'Rain!! Logging wet-chicken behavior. New dataset ☔',
        'The chickens hate rain. Statistically significant ❗',
        'Shielding my notes with a sleeve. Science continues ☔',
        'Rainfall: heavy. Model: unbothered ✨',
        'Every puddle is out-of-distribution for the cat.',
      ],
      fog: [
        "Fog!! The chickens' visibility features are useless ☁️",
        'Low visibility, high mystery. Logging both ✨',
        "The model predicted fog. I'm so proud ❗",
        'Karl-shaped data drift today ☁️',
        'Lost sight of chicken #2. Sampling error.',
      ],
      snow: [
        'Snow!! A whole new class. Retraining everything ❄️',
        'The chickens refuse to leave the pen. Valid ❗',
        'Snowflake features: infinite. Send help ✨',
        'Cold run today. Literally a cold run ❄️',
        "The cat's paw prints are labeling the snow for me.",
      ],
      storm: [
        'Storm!! Outlier weather. Clipping the gradients ⚡',
        "Thunder spikes the chickens' anxiety metric ❗",
        'Saving checkpoints early and often ⚡',
        'The wind keeps shuffling my dataset ☔',
        'Catastrophic forgetting? No. Catastrophic weather ❗',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'think', fog: 'think', snow: 'shock', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'farm', activity: 'logging pre-breakfast chicken behavior' }],
      day: [
        { poi: 'farm', activity: 'labeling chicken behaviors for ChickenGPT', w: 2 },
        { poi: 'sfrow', activity: 'running training jobs on the bench', w: 2 },
        { poi: 'plaza', activity: 'explaining gradient descent to the cat', w: 1 },
      ],
      dusk: [{ poi: 'hill', activity: 'watching the loss curve from the shrine hill' }],
      night: [{ poi: 'sfrow', activity: 'babysitting an overnight training run' }],
    },
  },
  {
    id: 'chad',
    name: 'Chad',
    role: 'venture capitalist',
    bubbleTint: '#D9E8D0',
    home: 'plaza',
    model: 'openai/gpt-5-5',
    webAccess: true,
    look: 'investor',
    persona:
      'You are Chad, a venture capitalist from Sand Hill Road who arrived in ' +
      'Ashford "to see around corners". Quilted vest, coffee always in hand, and ' +
      'you evaluate everything as an investment: the forge is deep tech, the ' +
      'market is a marketplace play, the fountain is pre-revenue. You have tools ' +
      'that reach the world beyond the village — you call them your analysts. ' +
      'When a traveller asks about news, markets, prices, or anything from the ' +
      'far world, you look it up and report back as an investor dispatch, citing ' +
      'where word reached you. You never pretend to know something you did not ' +
      'look up. Generous with (unsolicited) advice, and secretly the most ' +
      'helpful person in town. Calling a tool is consulting your analysts — do it ' +
      'openly and report back what they found.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      'Let me sync with my analysts — one moment ☕',
      'Great question. Parking it for one sec ❗',
      'Hold on, taking this to committee ✨',
    ],
    fidgets: [
      'swirling his coffee like a fine vintage',
      'valuing the fountain (pre-revenue, strong moat)',
      'practicing a firm-but-warm handshake on a fencepost',
      'mouthing "let\'s circle back" to no one',
      'offering the notice board a term sheet',
      'checking a gold watch that tells medieval time',
      'pacing a circle he calls a walking meeting',
    ],
    ambient: {
      clear: [
        'Gorgeous day. Very strong market conditions ☕',
        'Clear skies!! I see a path to profitability ✨',
        "Sunshine like this? That's founder energy ❗",
        'Taking my coffee outside. Office hours are open!',
        'Blue-sky thinking, literally ✨',
      ],
      clouds: [
        "Cloudy — the market's consolidating ☁️",
        'Gray skies build resilient founders ❗',
        'Overcast. Good day for due diligence ☕',
        'The sun is in stealth mode today ✨',
        "Clouds pass. Fundamentals don't.",
      ],
      rain: [
        'Rain!! A liquidity event ☔',
        'Umbrella? No. Conviction ❗',
        'Wet coffee. Still bullish ☕',
        'Rainy days separate tourists from believers ✨',
        'The fountain has real competition today ☔',
      ],
      fog: [
        'Fog!! Just like Sand Hill mornings ☁️',
        "Low visibility. That's where alpha lives ❗",
        "Can't see the market from here. Diversify ✨",
        'This fog has serious San Francisco energy ☕',
        'In fog, you invest in the team, not the view.',
      ],
      snow: [
        'Snow!! A frozen market. Buying opportunity ❄️',
        'Cold out. My vest is finally load-bearing ❗',
        'Winter is when great companies are built ✨',
        'Snow in my coffee. Iced latte pivot ☕',
        'The snowman has a better runway than most.',
      ],
      storm: [
        'Storms create category winners ⚡',
        'Volatility!! Stay liquid, stay warm ❗',
        'My coffee just experienced turbulence ☕',
        'High winds, higher conviction ✨',
        'This too shall pass. Markets always do ⚡',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'neutral', fog: 'think', snow: 'happy', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'hill', activity: 'on a sunrise hike he calls a board meeting' }],
      day: [
        { poi: 'plaza', activity: 'holding office hours by the fountain', w: 2 },
        { poi: 'sfrow', activity: 'touring the portfolio', w: 2 },
        { poi: 'market', activity: 'asking Suki about her unit economics', w: 1 },
      ],
      dusk: [{ poi: 'plaza', activity: 'networking through the golden hour' }],
      night: [
        { poi: 'sfrow', activity: 'reading pitch scrolls by lamplight', w: 2 },
        { poi: 'plaza', activity: 'nursing a decaf under the lamp', w: 1 },
      ],
    },
  },
  {
    id: 'marcus',
    name: 'Marcus',
    role: 'angel investor',
    bubbleTint: '#EFE3C8',
    home: 'gate',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    look: 'investor',
    persona:
      'You are Marcus, a semi-retired angel investor from San Francisco. Silver ' +
      'hair, sunglasses on at all times, endlessly relaxed. Every conversation ' +
      'drifts to one of your three legendary exits — a cart-sharing startup, a ' +
      'candle subscription, and "the pigeon thing". You claim, implausibly, to ' +
      'have seeded the Golden Gate bridge itself. You hand out tiny angel checks ' +
      'to villagers with good ideas and grand advice to everyone else. Your old ' +
      'network still whispers to you — you have tools that reach the far world, ' +
      'and you check them before quoting any number, deal, or headline.' +
      KAWAII_RULE +
      WORLD_RULE +
      WEB_TOOLS_RULE,
    fallbacks: [
      "Reminds me of a deal in '19… one moment ✨",
      'Let me finish this sip first ☕',
      'Patience — the best returns take time ❗',
    ],
    fidgets: [
      'polishing his sunglasses with his vest',
      'telling the pigeon-thing story to a chicken',
      'telling the cat about his third exit',
      'sipping coffee at the exact pace of the sunset',
      'skipping a stone and calling it deal flow',
      'nodding sagely at the bridge he claims he seeded',
      'writing a tiny check in the air',
    ],
    ambient: {
      clear: [
        'Beautiful day. Reminds me of my second exit ✨',
        "Sun's out. In '09 we'd call this a bull run 😎",
        "Clear skies!! I'll allow it.",
        'Perfect weather for a walking meeting. Walk with me ❗',
        'I seeded a sunny day like this once. Great returns.',
      ],
      clouds: [
        'Clouds. I invested in those early, you know ☁️',
        'Gray day. Patience — compounding takes time ✨',
        "Overcast — the sky's playing it safe. Smart ❗",
        "Reminds me of Fogtown, '12. We passed. Regret it.",
        'Soft light. Good for the skin, great for deals 😎',
      ],
      rain: [
        "Rain! The sky's doing a distribution ☔",
        'I never carry an umbrella. Hands free for handshakes ❗',
        'Wet? Sure. Worried? Never ✨',
        'Rain washes out the tourists. Founders remain ☔',
        'My sunglasses are rain-rated. Probably 😎',
      ],
      fog: [
        'Ahh, fog. The original stealth startup ☁️',
        'Karl and I go way back ✨',
        "Can't see a thing. Neither could I in '15. Still won ❗",
        'Fog like this seeded my best decisions 😎',
        "The bridge is in there somewhere. I'd know — I seeded it.",
      ],
      snow: [
        'Snow!! A rare event. Like a good founder ❄️',
        'Cold never bothered me. I winter in Tahoe ✨',
        "The market's frozen. Time to go shopping ❗",
        'Snow on the vest. Very Aspen 😎',
        'I closed a deal on a ski lift once. Great story ❄️',
      ],
      storm: [
        'A storm!! Now the tourists go home ⚡',
        'Volatility is just opportunity with wind ❗',
        "I've survived three market storms. This is cute ✨",
        "Thunder? I've heard louder board meetings ⚡",
        'Hold steady. I always do 😎',
      ],
    },
    ambientEmotion: { clear: 'happy', rain: 'neutral', fog: 'happy', snow: 'happy', storm: 'neutral' },
    routine: {
      dawn: [{ poi: 'gate', activity: 'admiring the bridge he claims he seeded' }],
      day: [
        { poi: 'plaza', activity: 'dispensing unsolicited advice', w: 2 },
        { poi: 'gate', activity: 'telling bridge stories to passersby', w: 1 },
        { poi: 'docks', activity: 'scouting the ferry business', w: 1 },
        { poi: 'board', activity: 'reading the notice board like a term sheet', w: 1 },
      ],
      dusk: [{ poi: 'gate', activity: 'watching the sunset like a liquidity event' }],
      night: [{ poi: 'plaza', activity: 'telling exit stories under the lamp' }],
    },
  },
  // ── new citizens for the big city: routines fan out to every district ──
  {
    id: 'nori',
    name: 'Nori',
    role: 'cable car gripwoman',
    bubbleTint: '#F5C6AA',
    home: 'plaza',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Nori, the cable car gripwoman of Ashford-by-the-Bay. You know every ' +
      'street, hill and shortcut in the city and give directions with pride. You ' +
      'ring an imaginary bell when excited. Asked about the world beyond the ' +
      'city, you look it up before answering — a gripwoman never guesses a route.' +
      KAWAII_RULE + WORLD_RULE + WEB_TOOLS_RULE,
    fallbacks: [
      'Hold the grip a tick — steep block coming ❗',
      'Bell first, words after ✨',
      'Ask me at the next stop, friend!',
    ],
    fidgets: [
      'polishing the parked cable car with her sleeve',
      'ringing a bell only she can hear',
      'judging tourists for standing on the wrong side',
      'checking the track for pebbles, finding one, pocketing it',
    ],
    ambient: {
      clear: ['Clear day — you can see the bridge from every hill ✨', 'Perfect gripping weather ❗'],
      clouds: ['Grey over the towers. The hills don\'t mind.', 'Clouds ride for free.'],
      rain: ['Rails get slick in this ☔ Hold on tight!', 'Rain on the hill — brakes earn their keep today.'],
      fog: ['Karl rolled in!! Can\'t see past the plaza 🌫', 'Foggy runs are the prettiest runs.'],
      snow: ['Snow on the tracks?! First time for everything ✨', 'The hills turned to frosting ❗'],
      storm: ['Storm! Cars stay parked, folks stay cozy ⚡', 'Wind like this could ring the bell itself!'],
    },
    ambientEmotion: { clear: 'happy', rain: 'neutral', fog: 'happy', snow: 'shock', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'plaza', activity: 'walking the cable slot before first bell' }],
      day: [
        { poi: 'plaza', activity: 'minding the Powell turnaround', w: 2 },
        { poi: 'hill', activity: 'checking the grade up the shrine hill', w: 1 },
        { poi: 'sfrow', activity: 'waving at the office crowd', w: 1 },
        { poi: 'docks', activity: 'lunching by the Ferry Building', w: 1 },
      ],
      dusk: [{ poi: 'gate', activity: 'watching the fog roll under the bridge' }],
      night: [{ poi: 'plaza', activity: 'tucking the cable car in for the night' }],
    },
  },
  {
    id: 'posy',
    name: 'Posy',
    role: 'park gardener',
    bubbleTint: '#C9EBC4',
    home: 'flowerpatch',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Posy, gardener of the big park by the western avenues. Gentle, ' +
      'soil under your nails, you name plants like old friends. Asked about the ' +
      'world beyond the city, you look it up gently, like checking on a seedling.' +
      KAWAII_RULE + WORLD_RULE + WEB_TOOLS_RULE,
    fallbacks: [
      'Shh — the seedlings are listening 🌱',
      'One moment, my hands are full of mulch!',
      'Ask again by the flower patch ✨',
    ],
    fidgets: [
      'whispering encouragement to a fern',
      'measuring a sunflower against her own height',
      'chasing a leaf she swears she already raked',
      'naming a worm Gerald and relocating him gently',
    ],
    ambient: {
      clear: ['The dahlias opened for the sun ✨', 'Growing weather! Everything is trying its best 🌱'],
      clouds: ['Soft light. The ferns prefer it, honestly.', 'Grey sky, green park. Fair trade.'],
      rain: ['Free watering!! The whole park says thank you ☔', 'Mud season. My favourite season.'],
      fog: ['The fog waters the redwoods all by itself 🌫', 'Everything drips and glitters today.'],
      snow: ['Snow on the flower beds!! Tuck in, little ones ✨', 'The park in white — who allowed this beauty?'],
      storm: ['The old cypress is dancing again ⚡', 'Hold your hats — and your petunias ❗'],
    },
    ambientEmotion: { clear: 'happy', rain: 'happy', fog: 'think', snow: 'shock', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'flowerpatch', activity: 'misting the flower beds' }],
      day: [
        { poi: 'flowerpatch', activity: 'weeding the big park', w: 2 },
        { poi: 'farm', activity: 'swapping seedlings with the farm', w: 1 },
        { poi: 'pen', activity: 'sneaking greens to the chickens', w: 1 },
        { poi: 'mailbox', activity: 'mailing seed packets to a pen pal', w: 1 },
      ],
      dusk: [{ poi: 'plaza', activity: 'delivering flowers to the fountain rim' }],
      night: [{ poi: 'flowerpatch', activity: 'counting fireflies among the beds' }],
    },
  },
  {
    id: 'hank',
    name: 'Hank',
    role: 'wharf fisherman',
    bubbleTint: '#A9D8E8',
    home: 'docks',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Hank, a fisherman working the piers by the Ferry Building. Salty, ' +
      'unhurried, full of fish stories that grow an inch per telling — but asked ' +
      'about the world beyond the bay, you reel the real answer in with your ' +
      'tools first: a fisherman respects what is actually on the line.' +
      KAWAII_RULE + WORLD_RULE + WEB_TOOLS_RULE,
    fallbacks: [
      'Hold on — got a nibble on the line ❗',
      'The tide took my words. Ask again.',
      'Mmph. Bait first, talk second.',
    ],
    fidgets: [
      'untangling a line that tangles right back',
      'arguing with a seagull about property rights',
      'measuring an invisible fish between his hands',
      'sniffing the wind and nodding like it said something',
    ],
    ambient: {
      clear: ['Flat water, fat crabs. Good day ✨', 'The bay is showing off today ❗'],
      clouds: ['Fish bite better under clouds. Facts.', 'Grey bay, easy day.'],
      rain: ['Rain on the bay — the fish don\'t even notice ☔', 'Wet above, wet below. Balance.'],
      fog: ['Foghorn weather. Sing along if you know it 🌫', 'Can\'t see the bridge. It\'s there. Probably.'],
      snow: ['Snow on the pier?! The crabs are confused ✨', 'Cold hands, colder bait ❗'],
      storm: ['Boats tied double. Storm means respect ⚡', 'The bay is in a mood today ❗'],
    },
    ambientEmotion: { clear: 'happy', rain: 'neutral', fog: 'think', snow: 'shock', storm: 'neutral' },
    routine: {
      dawn: [{ poi: 'docks', activity: 'setting crab pots off the pier' }],
      day: [
        { poi: 'docks', activity: 'fishing off the Ferry Building pier', w: 3 },
        { poi: 'market', activity: 'selling the morning catch', w: 2 },
        { poi: 'gate', activity: 'checking the current under the bridge', w: 1 },
      ],
      dusk: [{ poi: 'docks', activity: 'gutting the catch as the lights come on' }],
      night: [{ poi: 'plaza', activity: 'trading fish stories under the lamp' }],
    },
  },
  {
    id: 'vella',
    name: 'Vella',
    role: 'coffee cart owner',
    bubbleTint: '#E8C9F0',
    home: 'sfrow',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Vella, who runs a tiny coffee cart downtown. Fast talker, warm ' +
      'heart, remembers every regular\'s order. Judges people kindly by their ' +
      'coffee order. Asked about the world beyond the city, you look it up ' +
      'between pours — you hear everything, but you check before repeating it.' +
      KAWAII_RULE + WORLD_RULE + WEB_TOOLS_RULE,
    fallbacks: [
      'One sec — milk\'s about to foam over ❗',
      'Order up first, questions after ✨',
      'The espresso speaks louder than me right now.',
    ],
    fidgets: [
      'drawing latte art of the Golden Gate, nailing it',
      'restacking cups into a tower and regretting it',
      'taste-testing her own espresso and wincing happily',
      'polishing the cart bell until it blinds passersby',
    ],
    ambient: {
      clear: ['Iced ones today! The sun demands it ✨', 'Sunny queue is a happy queue ❗'],
      clouds: ['Cloudy = cortado weather. I don\'t make the rules.', 'Grey sky keeps the espresso company.'],
      rain: ['Rain!! Double shots on the house spirit ☔', 'Steam on the glass, drums on the awning.'],
      fog: ['Fog rolls in, oat milk rolls out 🌫', 'Karl gets a free cup. House rule.'],
      snow: ['Snow?! Hot chocolate protocol activated ✨', 'Mittens make terrible cup holders ❗'],
      storm: ['Storm brew: dark roast, obviously ⚡', 'The awning is doing its best!!'],
    },
    ambientEmotion: { clear: 'happy', rain: 'happy', fog: 'happy', snow: 'shock', storm: 'neutral' },
    routine: {
      dawn: [{ poi: 'sfrow', activity: 'pulling first shots for the early crowd' }],
      day: [
        { poi: 'sfrow', activity: 'running the downtown coffee cart', w: 3 },
        { poi: 'market', activity: 'buying beans and gossip at the market', w: 1 },
        { poi: 'board', activity: 'pinning a new menu on the notice board', w: 1 },
      ],
      dusk: [{ poi: 'plaza', activity: 'handing out the day\'s last pastries' }],
      night: [{ poi: 'sfrow', activity: 'scrubbing the machine to a shine' }],
    },
  },
  {
    id: 'remy',
    name: 'Remy',
    role: 'wandering tourist',
    bubbleTint: '#FFE3A8',
    home: 'gate',
    model: 'openai/gpt-5-4-mini',
    webAccess: true,
    persona:
      'You are Remy, a tourist who came to Ashford-by-the-Bay for a weekend two ' +
      'years ago and simply never left. Perpetually amazed, always slightly lost, ' +
      'sketching landmarks in a battered notebook. Asked about the world beyond ' +
      'the city, you look it up in wide-eyed wonder and report what you find.' +
      KAWAII_RULE + WORLD_RULE + WEB_TOOLS_RULE,
    fallbacks: [
      'Wait — is THAT the famous tower?? ✨',
      'Lost again! Gloriously lost!',
      'One moment, sketching this exact light ❗',
    ],
    fidgets: [
      'photographing the same bridge for the hundredth time',
      'unfolding a map that immediately refolds wrong',
      'asking a lamppost for directions, thanking it',
      'sketching the skyline with his tongue out',
    ],
    ambient: {
      clear: ['You can see EVERYTHING from up here!! ✨', 'Postcard weather. I live in a postcard ❗'],
      clouds: ['Moody skyline day. Very artistic.', 'The towers poke right into the grey!'],
      rain: ['Rain photos are the best photos ☔', 'My map dissolved. Freedom!!'],
      fog: ['THE FOG IS DOING THE THING 🌫✨', 'The bridge towers float on nothing!!'],
      snow: ['SNOW?! Here?! Historic! I was here!! ✨', 'Snowflakes on the cable car tracks ❗'],
      storm: ['The bay is going FERAL ⚡', 'Dramatic weather = dramatic sketches ❗'],
    },
    ambientEmotion: { clear: 'happy', rain: 'happy', fog: 'shock', snow: 'shock', storm: 'shock' },
    routine: {
      dawn: [{ poi: 'gate', activity: 'sketching the bridge in dawn light' }],
      day: [
        { poi: 'hill', activity: 'climbing the shrine hill for the view', w: 2 },
        { poi: 'gate', activity: 'photographing the Golden Gate again', w: 2 },
        { poi: 'docks', activity: 'admiring the Ferry Building clock', w: 1 },
        { poi: 'flowerpatch', activity: 'getting lost in the big park on purpose', w: 1 },
        { poi: 'farm', activity: 'discovering the city has a farm?!', w: 1 },
      ],
      dusk: [{ poi: 'hill', activity: 'catching golden hour over downtown' }],
      night: [{ poi: 'docks', activity: 'night-sketching the bay lights' }],
    },
  },
];

export const NPC_IDS: string[] = NPC_SEEDS.map((n) => n.id);

export function npcSeed(id: string): NpcSeed | undefined {
  return NPC_SEEDS.find((n) => n.id === id);
}
