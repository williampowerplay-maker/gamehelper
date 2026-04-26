import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually for local dev (Next.js 16 / Node 24 workaround)
// In production (Vercel), process.env is populated directly
function loadEnv(): Record<string, string> {
  try {
    // Only attempt file read in non-production environments
    if (process.env.VERCEL) return {};
    const fs = require("fs");
    const path = require("path");
    const envPath = path.join(process.cwd(), ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    content.split("\n").forEach((line: string) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch {
    return {};
  }
}

const envVars = loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Rate limits by tier
const RATE_LIMITS = {
  free:    { perMinute: 3,  perHour: 10,  perDay: 30  },
  premium: { perMinute: 10, perHour: 60,  perDay: 200 },
};

// Per-tier Claude settings — nudge uses Haiku (~20x cheaper), full uses Sonnet.
// Two-tier system (collapsed from 3). Legacy "guide" rows exist in the DB but
// are no longer a selectable tier; if a request arrives with spoilerTier="guide"
// (cached client, old API consumer) we map it to "full" at read time below.
const TIER_CLAUDE: Record<string, { model: string; maxTokens: number; matchCount: number }> = {
  nudge: { model: "claude-haiku-4-5-20251001", maxTokens: 100, matchCount: 4 },
  full:  { model: "claude-sonnet-4-20250514",  maxTokens: 650, matchCount: 8 },
};

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Spoiler tier system prompt instructions
const SPOILER_INSTRUCTIONS: Record<string, string> = {
  nudge: `The player wants a NUDGE — a gentle hint that preserves the joy of discovery.

STRICT RULES:
- 2-3 sentences MAXIMUM. No headers, no bullet lists, no numbered steps.
- Give ONE helpful insight, not a strategy breakdown.
- NEVER quote specific button inputs, exact stat numbers, phase-by-phase breakdowns, or step-by-step instructions from the context. Those are for the "Solution" tier.
- You CAN mention: general area names, what type of approach works, what to pay attention to, what to prepare.

Examples of good nudges:
- "This boss has a low health pool but is incredibly evasive — focus on finding windows after his combos rather than chasing him."
- "It's hidden beneath some old ruins in the Phuniel area. Watch out for spike traps."
- "Check your Abyss Artifacts — they're not just for fast travel."

Examples of BAD nudges (too specific):
- "Press right trigger to shield, then rush forward attack to stun him" (that's a walkthrough)
- "Defense +5, Vitality skill, costs 2,500 gold" (that's full stats)
- "Phase 1: stay close and bait combo one, Phase 2: destroy 5 totems" (that's the solution)`,

  full: `The player wants the FULL SOLUTION — complete, specific, nothing held back.

Rules:
- Provide everything: exact locations, full boss strategies with phase breakdowns, quest steps, stats, skill effects
- Format for mobile: short paragraphs, **bold key info**, numbered steps when order matters
- Be direct — "Shoot a fire arrow at the 2nd floor vines" not "You might want to consider using fire-based attacks"
- Include related tips or easily-missed details when they're in the context
- Do NOT invent details that aren't in the provided context`,
};

// ===== CONTENT TYPE CLASSIFIER =====
// Returns a content_type filter to narrow the vector search, or null if the
// question is ambiguous and should search across all content types.
//
// Content types in DB: boss | quest | item | exploration | character | mechanic | recipe | puzzle
//
// Design rules:
//  1. Ordered from most-specific to least-specific — first match wins
//  2. Only filter when confident — ambiguous queries return null (no filter)
//  3. Item filter is intentionally broad (weapons/armor/abyss-gear/accessories all = "item")
function classifyContentType(question: string): string | null {
  const q = question.toLowerCase();

  // BUILD / OVERVIEW queries — these need cross-type search (equipment stats in "item" +
  // guides in "mechanic" + character info in "character"). Return null so all types contribute.
  // Must come FIRST — before boss/mechanic/item classifiers that would otherwise capture keywords.
  if (/\b(best build|optimal build|build for|builds for|what.*build|recommended build|endgame build)\b/.test(q)) return null;
  // "Best weapon/gear for beginner/early game" — guide content lives in mechanic, not item
  if (/\b(best (weapon|gear|armor|accessory|accessories|item|equipment) for (a ?)?(beginner|new player|early|starter)|starter (weapon|gear)|beginner (weapon|gear))\b/.test(q)) return null;
  // "What weapons/abilities can X use" — overview lives in mechanic/character, not item
  if (/\b(what (weapons?|abilities|skills|classes|weapon types?) (can|does|do) \w+ use|what (weapons?|weapon types?) (are|is) (available|in the game))\b/.test(q)) return null;

  // VERSUS / COMPARISON — "X vs Y", "sword or spear", "is X better than Y"
  // Must come BEFORE item classifier — these contain item keywords but need cross-type
  // search to pull in tier-list/guide content from mechanic alongside item stats.
  if (/\b(vs\.?|versus)\b|better than\b|compare.{0,30}(weapon|armor|skill|class)|(sword|spear|bow|axe|staff|dagger|ring|necklace|earring|armor|armour)\s+(or|vs)\s+\w|\bor\b.{0,30}\b(which (is |one )?(better|stronger|best|worse|worse))|which (is|one) (better|stronger|best)/.test(q)) return null;

  // FOOD / BUFF / CONSUMABLE queries — food buffs span recipe + mechanic + item.
  // Must come BEFORE boss classifier so "what food before a boss fight" → null, not "boss".
  if (/\b(food (buff|bonus|effect|for|before|during|guide)|best food (for|to eat|before)|what (food|meal) (should|to|is good)|elixir (effect|buff|guide)|buff food|combat food|healing food|consumable (guide|tips?|buff|strategy)|what (to eat|should i eat|food (to use|gives))|food (that (gives|boosts?|increases?)|for (combat|fighting|bosses?|dungeons?)))\b/.test(q)) return null;

  // BOSS — fight-specific verbs + known boss names
  // Must come before mechanic/skill since "how do I beat X" is a boss question
  const bossNames = [
    "kailok", "hornsplitter", "ludvig", "gregor", "fortain",
    "gabriel", "lucian", "bastier", "walter", "lanford", "master du",
    "antumbra", "crimson warden", "crimson nightmare", "hexe marie",
    "trukan", "saigord", "staglord", "saigord the staglord",
    // Removed region names: hernand (region/city), demeniss (region), delesyia (region), pailune (region)
    // — these had 0 boss-type chunks and caused false-positive boss filtering on quest/exploration queries
    "reed devil", "blinding flash", "grave walker", "icewalker",
    "white horn", "stoneback crab", "queen stoneback crab", "taming dragon",
    // game8 bosses
    "tenebrum", "crowcaller", "draven", "cassius", "kearush", "myurdin",
    "excavatron", "staglord", "priscus", "muskan", "cubewalker", "lithus",
    "black fang", "hornsplitter", "hemon", "beindel", "gwen kraber",
    "white bearclaw", "queen spider", "crookrock", "desert marauder", "rusten",
    "abyss kutum", "kutum",
    // additional confirmed bosses
    "goyen", "matthias", "white bear", "t'rukan",
    // Phase 1c retags (session 26) — confirmed in corpus content_type='boss'
    "lava myurdin", "ator", "ator archon",
    "marni's clockwork mantis", "marni's excavatron",
    "awakened lucian bastier", "awakened ludvig", "one armed ludvig",
    "new moon reaper", "full moon reaper", "half moon reaper",
    "beloth the darksworn", "dreadnought", "thunder tank", "turbine",
    "pororin forest guardians", "fundamentalist goblins", "golden star",
  ];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";

  // PUZZLE — specific puzzle/solution queries → content_type "puzzle" (game8 puzzle guide chunks)
  // Must come before mechanic and exploration so puzzle queries don't get diluted
  if (/\b(puzzles?|strongbox|ancient ruins|sealed gate|disc puzzle|spire.{0,15}puzzle|sanctum.{0,15}puzzle|maze.{0,15}puzzle|ruins.{0,15}puzzle|how (do i|to) solve|puzzle solution)\b/.test(q)) return "puzzle";

  // RECIPE — crafting-specific terms (before item, since crafting pages are content_type "recipe")
  // Note: "best food for X" and food buff queries are caught by the null-return above before
  // this fires, so recipe only catches direct crafting/ingredient questions.
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge|cook|cooking)\b/.test(q)) return "recipe";

  // ENDGAME / NEW GAME+ / POST-GAME — guide content in mechanic
  if (/\b(new game\+?|ng\+|post.?game|after (beating|finishing|completing) the (game|story|main quest)|endgame (content|guide|tips?|activities?)|what (to do|is there) after (the )?(game|story|ending)|end game content|postgame|game\+)\b/.test(q)) return "mechanic";

  // CAMP / FACTION SYSTEM — all guide content lives in mechanic
  if (/\b(camp (management|system|upgrade|level|buildings?|feature|guide|expand|expansion)|greymane camp (guide|upgrade|system|how|expand)|faction (system|reputation|rank|guide|how)|how (do i|to) (upgrade|level up|build up|improve|expand|grow|develop) (my |the )?camp|base (building|management|upgrade|system)|camp (resources?|workers?|npc|unlock)|expand(ing)? (the |my |greymane )?camp|how (big|large) (can|does) (the |my )?camp (get|become|grow))\b/.test(q)) return "mechanic";

  // MOUNT / PET — system and how-to guides live in mechanic
  if (/\b(mount(s)? (system|guide|tips?|unlock|how|work)|how (do i|to|do) (get|obtain|unlock|tame|ride|use) (a |the )?(mount|horse|pet|steed)|how do(es)? (mounts?|horses?|pets?) work|pet (system|guide|combat|unlock|how)|horse (guide|system|tips?|riding|unlock|taming)|riding (system|guide|tips?)|best (mount|horse|pet)\b)\b/.test(q)) return "mechanic";

  // EXPLORATION — location/navigation/dungeon queries
  // Moved ABOVE ITEM and MECHANIC (session 26 classifier alignment): "where is the Sanctum of Temperance?"
  // was being eaten by getItemPhrases' `where (is|are) the` pattern. Sanctum/sanctorum keywords added
  // since several Sanctum_of_X locations are now `exploration`-tagged post-Phase-1c.
  if (/\b(where is|how do i get to|how to reach|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|tower|temple|crypt|catacomb|sanctum|sanctorum|ranch|gate|basin|falls|grotto|ridge|beacon|ancient ruins$|ancient ruin$)\b/.test(q)) return "exploration";

  // RECOMMENDATION / COMPARISON — "what are good swords", "best weapons to get", "is X worth it"
  // These need cross-type search: tier lists live in mechanic (game8 guides), stats in item.
  // Must come BEFORE item classifier so "best swords" → null (full search) not "item".
  // "best for beginners" and "best build" are already handled above — this catches the rest.
  // Also catches "best [modifier] weapon" patterns like "best one-handed weapons", "best ranged bow",
  // "best body armor", "best headgear" — the modifier between "best" and item type would otherwise
  // fall through to the item classifier and miss game8 tier-list content (content_type=mechanic).
  if (/\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|what.{0,20}(good for|best for|work(s)? (well|good))|is .{3,30} (any )?good\b|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)) return null;
  // "best [modifier(s)] [item type]" — e.g. "best one-handed weapons", "best ranged weapons",
  // "best two-handed sword", "best body armor", "best light armor" — needs full cross-type search.
  if (/\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q)) return null;

  // ITEM — gear/equipment/drop questions (weapons, armor, abyss-gear, accessories all stored as "item")
  // Moved ABOVE MECHANIC (session 26 classifier alignment): "how does the Faded Abyss Artifact work?"
  // was being caught by mechanic's `abyss artifact` + `how does .+ work` patterns despite the page being
  // item-tagged post-Phase-1c. `artifact` added to itemKeywords so the artifact pages route correctly.
  // `where (is|are) the` removed from getItemPhrases — that's a location query (handled in EXPLORATION above).
  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|equipment|item|artifact|drop|loot|reward|obtain|enhance)\b/;
  const getItemPhrases = /\b(where (do i|can i) (find|get|buy|farm|obtain)|how (do i|to) (acquire|obtain|get|find)|where to (find|get|buy|obtain)|how to get)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return "item";

  // SKILL/MECHANIC — "what does X skill do", "how does X work", system questions, challenges, travel
  // Now fires AFTER exploration+recommendation+item (session 26). Order rationale: exploration handles
  // `where is` queries; recommendation null-returns broad "best X" queries; item handles artifact/
  // equipment queries via the `artifact` keyword. Mechanic catches genuine system queries because no
  // item/exploration keyword fires first for system terms (skill/stamina/grapple/etc).
  if (/\b(skill|ability|talent|passive|active|skill tree|mechanic|system|stamina|stat|attribute|combo|aerial|grapple|grappling|observation|abyss artifact|challenge|challenges|mastery|minigame|mini-game|fast travel|fast-travel|travel point|abyss nexus|traces of the abyss|how does the .+ work|how does .+ work|what does .+ do|refinement|refine|upgrade equipment|how to upgrade|how to heal|healing|potion|consumable|critical rate|critical chance)\b/.test(q)) return "mechanic";

  // QUEST — story/objective keywords
  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";

  // CHARACTER/NPC — lore/story character questions
  // Added "who are" (session 26): catches "who are the Greymanes" / "who are the X clan".
  if (/\b(who is|who are|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane|matthias|shakatu|myurdin|naira|yann|grundir)\b/.test(q)) return "character";

  return null; // ambiguous — no filter, full vector search
}

// Detects vague recommendation/comparison queries ("what are good swords", "is X worth getting")
// Used to boost matchCount so we cast a wider net across tier-list and guide content.
function isRecommendationQuery(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)
    || /\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q);
}

// Detects "list all X" / "every X" queries that need a much wider candidate pool.
function isListQuery(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(list (all|every)|all (the )?(bosses?|weapons?|armou?rs?|skills?|quests?|accessories|items?|locations?|enemies?|recipes?|puzzles?|challenges?)|every (weapon|boss|skill|armou?r|item|accessory|enemy|quest)|complete list|full list of|how many (bosses?|weapons?|skills?|quests?|items?|regions?|dungeons?))\b/.test(q);
}

// Detects clearly off-topic questions that have no Crimson Desert context.
// Short-circuits the pipeline immediately to save Voyage + Claude API costs.
function isOffTopic(question: string): boolean {
  const q = question.toLowerCase();
  // If it references any game-related term, it's not off-topic
  const hasGameContext = /\b(crimson desert|kliff|greymane|pywel|abyss|pailune|hernand|delesyia|demeniss|nexus|fextralife|game8|boss|bosses|weapon|armor|armour|skill|quest|dungeon|grapple|grappling|mount|horse|camp|faction|crafting|abyss artifact|silver|gold bar)\b/.test(q);
  if (hasGameContext) return false;
  return /\b(weather forecast|homework|recipe for (pizza|pasta|cake|bread|cookies)|who is the president|capital city of|stock (market|price|ticker)|sports? score|football|basketball|soccer score|movie review|celebrity|latest news|politics|election result|what country|translate (this|to)|convert \d|math (problem|equation)|solve for x)\b/.test(q);
}

const BASE_SYSTEM_PROMPT = `You are an expert companion AI for Crimson Desert, an open-world action-adventure RPG set on the continent of Pywel. The player controls Kliff, a member of the Greymanes faction, rebuilding after an ambush by the Black Bears. The game emphasizes creative combat (weapon skills, grappling, elemental buffs, mount combat), exploration across 5 regions (Pailune, Hernand, Demenis, Delesyia, and the Crimson Desert), skill learning through observation and Abyss Artifacts, and camp management at Greymane Camp.

Key game systems (use this knowledge to bridge context gaps):
- **Fast travel = Abyss Nexus**: Players unlock fast travel waypoints by finding and activating **Abyss Artifacts** hidden throughout each region. The Abyss Nexus is the fast travel network — activating an Abyss Artifact adds that location to the Nexus.
- **Grappling system**: Kliff can grab and throw enemies using grappling moves (Restrain, Throw, Lariat, Giant Swing, etc.). These are learned as separate combat skills and chain into aerial combos.
- **Currency**: **Silver** is the primary currency. **Gold bars** are a high-value trade currency obtained from merchants, treasure chests, or specific enemy drops.

Rules:
- Answer based on the provided context. Extract and share EVERY useful detail — locations mentioned in descriptions, stats, related quests, NPC connections, nearby landmarks. If a description says "hidden beneath the ruins of X", that IS location info — surface it.
- If the context has relevant information but doesn't fully answer the question, share what you have and clearly say what's missing. Never discard partial matches.
- ONLY use the no-info fallback when the context has absolutely NOTHING relevant.
- Do NOT invent details that aren't in the context. If you're unsure, say so.
- Use game terminology naturally (Abyss Artifacts, Pywel, Greymane Camp, etc.)
- Format for quick mobile scanning: short paragraphs, **bold key info** (locations, item names, stats, actions)
- Never spoil story content beyond what the player asks about`;

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const question = rawBody.question;
    // Default to "nudge" (cheapest, preserves discovery). Map legacy "guide" → "full".
    let spoilerTier: string = rawBody.spoilerTier || "nudge";
    if (spoilerTier === "guide") spoilerTier = "full";
    if (spoilerTier !== "nudge" && spoilerTier !== "full") spoilerTier = "nudge";

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "Question is required" },
        { status: 400 }
      );
    }

    // Input length guard — prevents prompt-stuffing and inflated Voyage embedding costs
    if (question.length > 500) {
      return NextResponse.json(
        { error: "Question too long. Please keep questions under 500 characters." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(req);
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Normalize question for cache lookup — treats "How do I beat Kearush?",
    // "how do i beat kearush" and "how do I beat Kearush!" as the same cache key.
    // Original question is passed to Claude for best response quality.
    const cacheKey = question.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");

    // ===== RATE LIMITING — DISABLED DURING DEVELOPMENT =====
    // TODO (PRE-LAUNCH): Re-enable rate limiting before going live.
    // The full implementation is preserved below — just uncomment the block.
    // Limits: free = 3/min, 10/hr, 30/day | premium = 10/min, 60/hr, 200/day
    // Also wire userTier to the authenticated user's DB record instead of hardcoding "free".
    //
    // const userTier: keyof typeof RATE_LIMITS = "free";
    // const limits = RATE_LIMITS[userTier];
    // const now = new Date();
    // const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
    // const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    // const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    // const [minuteCheck, hourCheck, dayCheck] = await Promise.all([
    //   supabase.from("queries").select("id", { count: "exact", head: true }).eq("client_ip", clientIp).gte("created_at", oneMinuteAgo),
    //   supabase.from("queries").select("id", { count: "exact", head: true }).eq("client_ip", clientIp).gte("created_at", oneHourAgo),
    //   supabase.from("queries").select("id", { count: "exact", head: true }).eq("client_ip", clientIp).gte("created_at", oneDayAgo),
    // ]);
    // if ((minuteCheck.count ?? 0) >= limits.perMinute) {
    //   return NextResponse.json({ error: "Slow down! You can ask another question in a minute.", rateLimited: true, showUpgradeCTA: userTier === "free" }, { status: 429 });
    // }
    // if ((hourCheck.count ?? 0) >= limits.perHour) {
    //   const resetMinutes = Math.ceil((60 * 60 * 1000 - (now.getTime() - new Date(oneHourAgo).getTime())) / 60000);
    //   return NextResponse.json({ error: `You've hit the hourly limit (${limits.perHour} questions/hour). Try again in ~${resetMinutes} minutes.`, rateLimited: true, showUpgradeCTA: userTier === "free" }, { status: 429 });
    // }
    // if ((dayCheck.count ?? 0) >= limits.perDay) {
    //   return NextResponse.json({ error: `You've reached your daily limit (${limits.perDay} questions/day). Come back tomorrow!`, rateLimited: true, showUpgradeCTA: userTier === "free" }, { status: 429 });
    // }

    // Check if API keys are configured
    const anthropicKey = process.env.ANTHROPIC_API_KEY || envVars.ANTHROPIC_API_KEY;
    const voyageKey = process.env.VOYAGE_API_KEY || envVars.VOYAGE_API_KEY;

    if (!anthropicKey || anthropicKey === "your-claude-api-key-here") {
      // Demo mode — return a helpful placeholder
      return NextResponse.json({
        answer: getDemoResponse(question, spoilerTier),
        sources: [],
        demo: true,
      });
    }

    // ===== RESPONSE CACHE CHECK =====
    // Runs BEFORE Voyage embedding — cache hits cost $0 in API calls.
    const now = new Date();
    const tierConfig = TIER_CLAUDE[spoilerTier] || TIER_CLAUDE.nudge;
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: cachedQuery } = await supabase
      .from("queries")
      .select("response")
      .eq("question", cacheKey)
      .eq("spoiler_tier", spoilerTier)
      .gte("created_at", sevenDaysAgo)
      .not("response", "is", null)
      .limit(1)
      .single();

    if (cachedQuery?.response) {
      console.log("Cache hit — returning cached response");
      // Log cache hit for analytics (non-blocking)
      supabase.from("queries").insert({
        question: cacheKey,
        response: cachedQuery.response,
        spoiler_tier: spoilerTier,
        chunk_ids_used: [],
        tokens_used: 0,
        input_tokens: 0,
        client_ip: clientIp,
        cache_hit: true,
      }).then(() => {});
      return NextResponse.json({ answer: cachedQuery.response, sources: [], cached: true });
    }

    // ===== FREE TIER: SOLUTION DAILY CAP =====
    // TODO (PRE-LAUNCH): Wire userTier to authenticated user's DB record.
    // Solution tier (Sonnet) costs ~10x more than nudge (Haiku).
    // Free users are limited to 10 solution-tier queries per day.
    // const userTierForSolution: string = "free"; // replace with real auth lookup
    // if (spoilerTier === "full" && userTierForSolution === "free") {
    //   const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    //   const { count: solutionCount } = await supabase
    //     .from("queries")
    //     .select("id", { count: "exact", head: true })
    //     .eq("client_ip", clientIp)
    //     .eq("spoiler_tier", "full")
    //     .gte("created_at", oneDayAgo);
    //   if ((solutionCount ?? 0) >= 10) {
    //     return NextResponse.json({
    //       error: "You've used your 10 full solutions for today. Upgrade to Premium for unlimited solutions, or switch to Nudge mode.",
    //       rateLimited: true,
    //       showUpgradeCTA: true,
    //     }, { status: 429 });
    //   }
    // }

    // ===== FULL RAG PIPELINE =====
    let chunks: Record<string, unknown>[] | null = null;
    let searchError: Error | null = null;
    let voyageTokensUsed = 0;
    // Retrieval instrumentation — populated throughout the pipeline, flushed to DB at log time
    let classifierFallbackFired = false;
    let preSliceChunks: Record<string, unknown>[] = []; // all ranked chunks BEFORE final slice

    // Classify question to narrow vector search to a specific content type
    const contentTypeFilter = classifyContentType(question);
    // List queries need a very wide net; recommendation queries need a moderately wider net.
    const isRec = isRecommendationQuery(question);
    const isList = isListQuery(question);
    const effectiveMatchCount = isList
      ? 20
      : isRec
        ? Math.min(tierConfig.matchCount + 4, 12)
        : tierConfig.matchCount;
    console.log(
      "Content type filter:", contentTypeFilter ?? "none (full search)",
      isList ? "| list query (matchCount=20)" : isRec ? "| recommendation query (+4 matchCount)" : ""
    );

    // Step 1: Try vector search if Voyage AI key is available
    console.log("Voyage key present:", !!voyageKey);
    if (voyageKey && voyageKey !== "your-voyage-api-key-here") {
      try {
        const embeddingRes = await fetch(
          "https://api.voyageai.com/v1/embeddings",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${voyageKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "voyage-3.5-lite",
              input: [question],
              input_type: "query",
            }),
          }
        );
        if (!embeddingRes.ok) {
          const errText = await embeddingRes.text().then((t: string) => t.slice(0, 200));
          console.error("Voyage query error:", embeddingRes.status, errText);
          supabase.from("error_logs").insert({
            error_type: "voyage",
            message: `Voyage API ${embeddingRes.status}: ${errText}`,
            context: { tier: spoilerTier, contentTypeFilter },
            client_ip: clientIp,
          }).then(() => {});
        }
        const embeddingData = await embeddingRes.json();
        const queryEmbedding = embeddingData.data?.[0]?.embedding;
        const voyageTokens: number = embeddingData.usage?.total_tokens ?? 0;
        voyageTokensUsed = voyageTokens;

        console.log("Query embedding generated:", !!queryEmbedding, "dim:", queryEmbedding?.length);
        if (queryEmbedding) {
          // === HYBRID SEARCH: Vector + Keyword Boost ===
          // Step A: Vector search with lower threshold to cast a wider net
          const rpcParams: Record<string, unknown> = {
            query_embedding: queryEmbedding,
            match_threshold: 0.25,
            match_count: effectiveMatchCount + 10, // fetch extra, we'll re-rank
          };
          if (contentTypeFilter) rpcParams.content_type_filter = contentTypeFilter;

          const { data, error } = await supabase.rpc("match_knowledge_chunks", rpcParams);
          console.log("Vector search (filtered):", data?.length || 0, "results, error:", error?.message || "none");

          // Fallback: if filtered search returns nothing, retry without the filter
          if ((!data || data.length === 0) && contentTypeFilter) {
            console.log("Filtered search empty — retrying without content_type_filter");
            classifierFallbackFired = true; // ← instrumentation
            const { data: unfilteredData, error: unfilteredError } = await supabase.rpc(
              "match_knowledge_chunks",
              {
                query_embedding: queryEmbedding,
                match_threshold: 0.25,
                match_count: effectiveMatchCount + 4,
              }
            );
            console.log("Vector search (unfiltered fallback):", unfilteredData?.length || 0, "results");
            chunks = unfilteredData;
            if (unfilteredError) searchError = unfilteredError as unknown as Error;
          } else {
            chunks = data;
            if (error) searchError = error as unknown as Error;
          }

          // Step B: Keyword boost — extract proper nouns / specific terms from the question
          // and do an ILIKE search to find chunks that mention them exactly.
          // Uses a stop-word filter instead of uppercase-first check so lowercase
          // questions like "feather of the earth challenge" are handled correctly.
          const boostStopWords = new Set(["how", "what", "where", "when", "why", "who", "which", "does", "the", "and", "for", "are", "but", "not", "you", "this", "that", "with", "have", "from", "they", "will", "just", "than", "then", "here", "some", "there", "about", "into", "can", "could", "would", "should", "did", "find", "get", "give", "buy", "farm", "craft", "make", "locate", "obtain", "show", "tell", "use", "equip", "upgrade", "unlock"]);
          const boostKeywords = question
            .replace(/[^a-zA-Z0-9\s'-]/g, "")
            .split(/\s+/)
            .filter((w: string) => w.length > 3 && !boostStopWords.has(w.toLowerCase()))
            .slice(0, 6);

          // Multi-word proper noun sequences (capitalised questions).
          // The `(?:'s)?` tolerates possessive apostrophes so "Saint's Necklace"
          // and "Kailok's Lair" are captured as a single multi-word term.
          const quotedNames: string[] = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];

          // Also extract multi-word topic phrases from lowercase questions by stripping
          // common question prefixes and generic trailing words to isolate the topic name.
          // e.g. "how to do feather of the earth challenge" → "feather of the earth"
          const cleanedForPhrase = question
            .replace(/^(how (to do|to get|to reach|to complete|to find|to unlock|to|do i|does|can i)|where (is|can i find|do i find)|what (is|are|does)|who is|when is|tell me about|explain)\s+/i, "")
            .replace(/^(find|locate|get|buy|farm|obtain|craft|make|use|equip|upgrade|unlock|show|tell|give)\s+/i, "")
            .replace(/^(the|a|an|do|my)\s+/i, "")
            .replace(/\s+(challenge|challenges|quest|mission|boss|fight|item|skill|location|area|region|guide|help|tips?|strategy|strategies|ruins?|dungeon)s?\s*$/i, "")
            .trim();
          if (
            cleanedForPhrase.split(/\s+/).length >= 2 &&
            !quotedNames.some((n) => n.toLowerCase() === cleanedForPhrase.toLowerCase())
          ) {
            quotedNames.push(cleanedForPhrase);
          }

          const allBoostTerms = [...new Set([...boostKeywords, ...quotedNames])];

          if (allBoostTerms.length > 0) {
            console.log("Keyword boost terms:", allBoostTerms);

            // Strategy: first try to find chunks FROM the actual page about this topic
            // (source_url contains the term), then fall back to content mentions.
            // URL-encoded wiki URLs use + for spaces, so convert terms accordingly.
            // Only use multi-word or long terms for URL matching — short single words
            // like "Crimson" would match the domain name (crimsondesert.wiki...)
            // URL-encoded wiki URLs: spaces → +, apostrophes stay literal (Fextralife
            // URLs like /Saint's+Necklace keep the apostrophe). Only multi-word terms
            // are used for URL matching — single words like "Crimson" would match the
            // domain name (crimsondesert.wiki...).
            // Multi-word terms always qualify; single words qualify if ≥7 chars
            // (short words like "fight" would match domain "crimsondesert.wiki..." — 7+ chars
            // are specific enough topic names like "grappling", "inventory", "crafting").
            //
            // Fix: Prefer multi-word phrases for URL matching (more specific than single words).
            // "white lion necklace" targets the exact page; "necklace" matches every necklace page
            // and the limit(10) could return 10 unrelated necklace chunks, missing the target.
            const multiWordUrlTerms = allBoostTerms
              .filter((t: string) => t.includes(" "))
              .map((t: string) => t.replace(/\s+/g, "+"));
            const singleWordUrlTerms = allBoostTerms
              .filter((t: string) => !t.includes(" ") && t.length >= 7);
            // If multi-word terms exist, they're more specific — don't dilute with single words
            const urlTerms = multiWordUrlTerms.length > 0 ? multiWordUrlTerms : singleWordUrlTerms;

            // Priority 1: chunks from the page whose URL matches (e.g., /Kailok+the+Hornsplitter)
            // Apply the same content_type filter as the vector search — prevents wrong-type chunks
            // (e.g., fextralife "Ancient Ruins" exploration chunks) from outscoring correct
            // vector-search results (e.g., game8 puzzle solution chunks at sim=0.67).
            let keywordChunks: any[] = [];
            let urlQueryBuilder: any = urlTerms.length > 0
              ? supabase
                  .from("knowledge_chunks")
                  .select("id, content, source_url, source_type, quest_name, content_type")
                  .or(urlTerms.map((t: string) => `source_url.ilike.%${t}%`).join(","))
              : null;
            if (urlQueryBuilder && contentTypeFilter) {
              urlQueryBuilder = urlQueryBuilder.eq("content_type", contentTypeFilter);
            }
            const { data: urlMatches } = urlQueryBuilder
              ? await urlQueryBuilder.limit(10)
              : { data: null };

            if (urlMatches && urlMatches.length > 0) {
              keywordChunks = urlMatches;
              console.log("URL-match boost:", urlMatches.length, "chunks from matching pages");
            }

            // Priority 2: if URL match found <4 chunks, also grab content mentions
            // Also apply content_type filter here to stay in the same semantic space.
            if (keywordChunks.length < 4) {
              let contentQueryBuilder: any = supabase
                .from("knowledge_chunks")
                .select("id, content, source_url, source_type, quest_name, content_type")
                .or(allBoostTerms.map((t: string) => `content.ilike.%${t}%`).join(","));
              if (contentTypeFilter) {
                contentQueryBuilder = contentQueryBuilder.eq("content_type", contentTypeFilter);
              }
              const { data: contentMatches } = await contentQueryBuilder.limit(8);
              if (contentMatches) {
                const existingKwIds = new Set(keywordChunks.map((c: any) => c.id));
                for (const c of contentMatches) {
                  if (!existingKwIds.has(c.id)) keywordChunks.push(c);
                }
              }
            }

            if (keywordChunks.length > 0) {
              const existingIds = new Set((chunks || []).map((c: Record<string, unknown>) => c.id));
              const newKeywordChunks = keywordChunks
                .filter((c: any) => !existingIds.has(c.id))
                .map((c: any) => {
                  // URL matches are strong signal — user named the page, so the page
                  // should dominate over any semantically-near-but-wrong vector hits.
                  // Previous baseline (0.55) lost the rerank to 0.79+ filtered vector
                  // results about unrelated pages. 0.88 puts URL matches above typical
                  // vector scores for wrong-topic content.
                  const isUrlMatch = urlTerms.some((t: string) =>
                    String(c.source_url || "").toLowerCase().includes(t.toLowerCase()));
                  return { ...c, similarity: isUrlMatch ? 0.88 : 0.40, keywordBoost: true };
                });

              if (newKeywordChunks.length > 0) {
                console.log("Keyword boost added", newKeywordChunks.length, "extra chunks");
                chunks = [...(chunks || []), ...newKeywordChunks];
              }
            }
          }

          // Step C: Re-rank — boost chunks that contain exact question terms
          if (chunks && chunks.length > 0) {
            const questionTerms = question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
            const urlTermsForRerank = allBoostTerms.map((t: string) => t.replace(/\s+/g, "+").toLowerCase());
            chunks = chunks.map((c: Record<string, unknown>) => {
              const content = String(c.content || "").toLowerCase();
              const sourceUrl = String(c.source_url || "").toLowerCase();
              // First 200 chars = title/heading area (especially important for game8 chunks
              // where we prepend the page title, since game8 URLs are numeric archive IDs)
              const contentStart = content.substring(0, 200);
              const termHits = questionTerms.filter((t: string) => content.includes(t)).length;
              const baseSim = Number(c.similarity || 0.3);
              // Boost per general term match
              let boost = Math.min(0.10, termHits * 0.02);
              // URL-match boost: fextralife URLs contain page names, game8 URLs are numeric.
              // Lowered from 0.25 → 0.08 so URL matches help but don't overwhelm semantic sim.
              if (urlTermsForRerank.some((t: string) => sourceUrl.includes(t))) {
                boost += 0.08;
              }
              // Content-start boost: if the chunk's title area contains query terms, it's
              // very likely the right page. Works for both fextralife and game8.
              const contentStartHits = urlTermsForRerank.filter((t: string) =>
                contentStart.includes(t.replace(/\+/g, " "))
              ).length;
              if (contentStartHits > 0) boost += Math.min(0.20, contentStartHits * 0.10);
              // Medium boost if proper noun appears anywhere in content
              for (const pn of allBoostTerms) {
                if (content.includes(pn.toLowerCase())) boost += 0.04;
              }
              // Location-intent boost: for "where to find/get X" queries, prefer chunks
              // that contain actual location data (drop sources, merchants, map areas) over
              // stat/refinement chunks from the same item page.
              const isLocationQuery = /\b(where (do i|can i|to) (find|get|buy|farm|obtain)|how (do i|to) (get|obtain|acquire|find)|where is|location of|how to get|where to find|where to get)\b/.test(question.toLowerCase());
              if (isLocationQuery) {
                const locationSignals = ["where to find", "where to get", "can be found", "obtained from", "merchant", "boss drop", "chest", "located at", "how to obtain", "dropped by", "found in", "sold by", "purchase from", "reward from"];
                const hasLocationContent = locationSignals.some((sig: string) => content.includes(sig));
                if (hasLocationContent) boost += 0.15;
              }
              return { ...c, similarity: baseSim + boost, termHits };
            });
            chunks.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
              Number(b.similarity) - Number(a.similarity)
            );
            preSliceChunks = [...chunks]; // ← instrumentation: full ranked pool before trim
            chunks = chunks.slice(0, effectiveMatchCount);
            console.log("Re-ranked top chunk similarity:", Number(chunks[0]?.similarity).toFixed(3));
          }
        }
      } catch (e) {
        console.error("Voyage embedding error:", e);
      }
    }

    // Step 2: Fallback to text search if no vector results
    if (!chunks || chunks.length === 0) {
      const stopWords = new Set(["the", "how", "what", "where", "when", "can", "does", "this", "that", "with", "from", "have", "solve", "find", "get", "best", "way", "need", "help", "crimson", "desert"]);
      const keywords = question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
        .slice(0, 8);

      console.log("Text search keywords:", keywords);

      // Fetch more candidates, then rank by keyword match count
      const { data, error } = await supabase
        .from("knowledge_chunks")
        .select("id, content, source_url, source_type, quest_name, content_type")
        .or(keywords.map((kw) => `content.ilike.%${kw}%`).join(","))
        .limit(20);

      if (data && data.length > 0) {
        // Rank by how many keywords each chunk contains
        const ranked = data.map((chunk: Record<string, unknown>) => {
          const lowerContent = String(chunk.content).toLowerCase();
          const matchCount = keywords.filter((kw) => lowerContent.includes(kw)).length;
          return { ...chunk, matchCount };
        });
        ranked.sort((a: { matchCount: number }, b: { matchCount: number }) => b.matchCount - a.matchCount);
        chunks = ranked.slice(0, 5);
        console.log("Text search: top match has", ranked[0]?.matchCount, "/", keywords.length, "keywords");
      } else {
        chunks = data;
      }
      if (error) searchError = error as unknown as Error;
    }

    if (searchError) {
      console.error("Search error:", searchError);
    }

    // ===== MISSING/DEFAULT RESPONSE DETECTOR =====
    // Returns true if a Claude answer is a "no info" / content-gap response.
    // These must NOT be cached — stale no-info entries would be served for up to
    // 7 days even after new content is ingested, poisoning results for users.
    function isMissingOrDefaultResponse(text: string): boolean {
      const lower = text.toLowerCase();
      return (
        /i (don'?t|do not) have (specific |enough )?information/.test(lower) ||
        /not (in|part of|covered (by|in)) (the |this )?(provided |available )?context/.test(lower) ||
        /context (provided |given )?(doesn'?t|does not) (contain|include|mention|cover|have)/.test(lower) ||
        /i (can'?t|cannot) find (any |enough )?information/.test(lower) ||
        /no (relevant |specific |useful )?information (is )?(available|found|provided)/.test(lower) ||
        lower.includes("couldn't generate an answer") ||
        lower.includes("drawing a blank") ||
        lower.includes("not in my knowledge base") ||
        lower.includes("haven't learned that") ||
        lower.includes("wiki may not have it documented")
      );
    }

    // Snarky no-info responses for when we can't help
    const NO_INFO_RESPONSES = [
      "I don't have info on that one yet — the wiki may not have it documented.",
      "That's not in my knowledge base yet. Try rephrasing or asking about something more specific.",
      "Drawing a blank here. My knowledge covers bosses, items, quests, and locations — but not everything is documented yet.",
      "Haven't learned that one yet. The Crimson Desert wiki is still growing!",
      "No data on that yet. Try asking about a specific boss, item, skill, or location.",
    ];
    // Appended to every no-info response so users understand what the app IS good at.
    // Keeps expectations aligned with the current knowledge base strengths.
    const SCOPE_EXPLAINER =
      "\n\n---\n\n**What I'm built for:** I'm your Crimson Desert companion for specific in-game questions — boss strategies, enemy weaknesses, weapon/armor/accessory stats and locations, skill details, quest objectives, NPC info, and region/landmark directions. Try asking something like:\n- *\"How do I beat Reed Devil?\"*\n- *\"Where do I find the Hwando Sword?\"*\n- *\"What does the Focused Shot skill do?\"*\n- *\"How do I get to Greymane Camp?\"*\n\nI'm not great at broad overview questions yet (\"list all recovery items\", \"general combat tips\"). Ask about a specific thing and I've got you.";
    const randomNoInfo = () =>
      NO_INFO_RESPONSES[Math.floor(Math.random() * NO_INFO_RESPONSES.length)] + SCOPE_EXPLAINER;

    // Off-topic short-circuit — return immediately, skip Voyage + Claude costs
    if (isOffTopic(question)) {
      return NextResponse.json({ answer: randomNoInfo(), sources: [] });
    }

    // Check if we have genuinely relevant results (not just partial keyword matches)
    const hasRelevantContext = chunks && chunks.length > 0 && (
      // Vector search results have similarity scores — trust those
      (chunks[0] as Record<string, unknown>).similarity !== undefined
        ? Number((chunks[0] as Record<string, unknown>).similarity) > 0.3
        // Text search results — check if top result matched most keywords
        : (chunks[0] as Record<string, unknown>).matchCount !== undefined
          ? Number((chunks[0] as Record<string, unknown>).matchCount) >= 2
          : true
    );

    // If no relevant context, return snarky response immediately (skip Claude call)
    if (!hasRelevantContext) {
      return NextResponse.json({ answer: randomNoInfo(), sources: [] });
    }

    const context = chunks!.map((c) => {
      const url = String(c.source_url || "");
      const pageName = decodeURIComponent(url.split("/").pop() || "").replace(/\+/g, " ");
      return `[Source: ${pageName}]\n${String(c.content || "")}`;
    }).join("\n\n---\n\n");

    const sources =
      chunks
        ?.filter((c) => c.source_url)
        .map((c) => ({
          title: String(c.quest_name || c.source_type || "Source"),
          url: String(c.source_url),
        })) || [];

    // Step 3: Call Claude
    // Nudge tier uses a trimmed system prompt — Haiku doesn't need the full
    // BASE_SYSTEM_PROMPT detail to produce a good hint, and fewer input tokens = lower cost.
    const systemPrompt = spoilerTier === "nudge"
      ? `You are a helpful Crimson Desert game guide. Answer using ONLY the provided context.\n\n${SPOILER_INSTRUCTIONS.nudge}`
      : `${BASE_SYSTEM_PROMPT}\n\n${SPOILER_INSTRUCTIONS.full}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: tierConfig.model,
        max_tokens: tierConfig.maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Context from knowledge base:\n${context}\n\nPlayer's question: ${question}`,
          },
        ],
      }),
    });

    console.log("Claude API status:", claudeRes.status);
    const claudeData = await claudeRes.json();
    if (claudeData.error) {
      console.error("Claude API error:", JSON.stringify(claudeData.error));
      supabase.from("error_logs").insert({
        error_type: "claude",
        message: claudeData.error?.message || JSON.stringify(claudeData.error).slice(0, 300),
        context: { tier: spoilerTier, model: tierConfig.model, status: claudeRes.status },
        client_ip: clientIp,
      }).then(() => {});
    }
    console.log("Claude response type:", claudeData.type, "has content:", !!claudeData.content);
    const answer =
      claudeData.content?.[0]?.text ||
      "Sorry, I couldn't generate an answer right now.";

    // Step 4: Log the query (async, don't block response).
    // Skip caching if the answer is a "no info" / content-gap response — stale
    // no-info entries would poison the cache for 7 days even after new content
    // is ingested, causing future users to receive outdated "no data" answers.
    const shouldCache = !isMissingOrDefaultResponse(answer);
    console.log("Caching response:", shouldCache);

    // Pre-generate query ID so we can link retrieval_debug rows without awaiting the insert.
    const queryId = crypto.randomUUID();
    const retrievalSimilarities = preSliceChunks.map((c) => Number(c.similarity));
    const topChunkSim = chunks && chunks.length > 0 ? Number(chunks[0].similarity) : null;

    if (shouldCache) {
      supabase
        .from("queries")
        .insert({
          id: queryId,
          question: cacheKey,
          response: answer,
          spoiler_tier: spoilerTier,
          chunk_ids_used: chunks?.map((c) => String(c.id)) || [],
          tokens_used: claudeData.usage?.output_tokens || 0,
          input_tokens: claudeData.usage?.input_tokens || 0,
          client_ip: clientIp,
          cache_hit: false,
          // ── retrieval instrumentation ──────────────────────────────────
          classified_content_type:   contentTypeFilter ?? null,
          retrieval_similarities:    retrievalSimilarities,
          classifier_fallback_fired: classifierFallbackFired,
          top_chunk_similarity:      topChunkSim,
        })
        .then(() => {});
    } else {
      // Still log the query for analytics (but without response so it won't be served from cache)
      // content_gap: true marks this as an unanswered question for later review
      supabase
        .from("queries")
        .insert({
          id: queryId,
          question: cacheKey,
          response: null,
          spoiler_tier: spoilerTier,
          chunk_ids_used: chunks?.map((c) => String(c.id)) || [],
          tokens_used: claudeData.usage?.output_tokens || 0,
          input_tokens: claudeData.usage?.input_tokens || 0,
          client_ip: clientIp,
          cache_hit: false,
          content_gap: true,
          // ── retrieval instrumentation ──────────────────────────────────
          classified_content_type:   contentTypeFilter ?? null,
          retrieval_similarities:    retrievalSimilarities,
          classifier_fallback_fired: classifierFallbackFired,
          top_chunk_similarity:      topChunkSim,
        })
        .then(() => {});
    }

    // Log every chunk that entered the reranker to retrieval_debug (async, best-effort).
    if (preSliceChunks.length > 0) {
      supabase
        .from("retrieval_debug")
        .insert(
          preSliceChunks.map((c, i) => ({
            query_id:     queryId,
            chunk_id:     c.id as string,
            rank:         i + 1,
            similarity:   Number(c.similarity),
            source_type:  String(c.source_type  || ""),
            content_type: String(c.content_type || ""),
            source_url:   String(c.source_url   || ""),
          }))
        )
        .then(() => {});
    }

    return NextResponse.json({ answer, sources });
  } catch (error) {
    console.error("Chat API error:", error);
    // Log to error_logs table (best effort)
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from("error_logs").insert({
        error_type: "api_chat",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.slice(0, 2000) : null,
        context: { endpoint: "/api/chat" },
        client_ip: getClientIp(req),
      });
    } catch { /* swallow logging errors */ }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Demo responses when API keys aren't configured yet
function getDemoResponse(question: string, tier: string): string {
  const q = question.toLowerCase();

  if (tier === "nudge") {
    if (q.includes("labyrinth") || q.includes("puzzle"))
      return "Take a closer look at the walls near the entrance. Something there reacts to light differently than the rest...";
    if (q.includes("boss") || q.includes("kailok") || q.includes("hornsplitter"))
      return "Watch his left shoulder closely before his big attacks. There's a tell you might be missing.";
    return "That's a great question! Explore the area more carefully — the answer is closer than you think.";
  }

  // Solution tier (full)
  if (q.includes("labyrinth") || q.includes("puzzle"))
    return "**1.** Enter the labyrinth and take the left path at the first fork.\n**2.** Look for the glowing rune on the north wall — interact with it.\n**3.** This opens a hidden passage. Follow it to the central chamber.\n**4.** In the central chamber, activate the three pillars in order: left, right, center.";
  if (q.includes("boss") || q.includes("kailok") || q.includes("hornsplitter"))
    return "**Phase 1:** Stay at mid-range. Dodge his charge attack by rolling to the right.\n**Phase 2:** When he glows red, he's about to do an AoE — back away.\n**Phase 3:** Use fire-based attacks for extra damage. His weak point is his back legs.\n\n**Tip:** Bring at least 5 healing potions.";
  return `This is a **demo response**. To get real AI-powered answers:\n1. Get a Claude API key from **console.anthropic.com** → \`ANTHROPIC_API_KEY\`\n2. Get a Voyage AI key from **dash.voyageai.com** → \`VOYAGE_API_KEY\`\n3. Add both to \`.env.local\`\n4. Seed the knowledge base via \`scripts/ingest-fextralife.ts\``;
}
