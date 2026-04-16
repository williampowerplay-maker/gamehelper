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
  free:    { perMinute: 5,  perHour: 20 },
  premium: { perMinute: 10, perHour: 60 },
};

// Per-tier Claude settings — nudge uses Haiku (~20x cheaper), full uses Sonnet.
// Two-tier system (collapsed from 3). Legacy "guide" rows exist in the DB but
// are no longer a selectable tier; if a request arrives with spoilerTier="guide"
// (cached client, old API consumer) we map it to "full" at read time below.
const TIER_CLAUDE: Record<string, { model: string; maxTokens: number; matchCount: number }> = {
  nudge: { model: "claude-haiku-4-5-20251001", maxTokens: 100,  matchCount: 6 },
  full:  { model: "claude-sonnet-4-20250514",  maxTokens: 1024, matchCount: 8 },
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
// Content types in DB: boss | quest | item | exploration | character | mechanic | recipe
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

  // BOSS — fight-specific verbs + known boss names
  // Must come before mechanic/skill since "how do I beat X" is a boss question
  const bossNames = [
    "kailok", "hornsplitter", "hernand", "ludvig", "gregor", "fortain",
    "gabriel", "lucian", "bastier", "walter", "lanford", "master du",
    "antumbra", "crimson warden", "crimson nightmare", "hexe marie",
    "demeniss", "trukan", "delesyia", "pailune", "saigord", "staglord",
    "reed devil", "blinding flash", "grave walker", "icewalker",
    "white horn", "stoneback crab", "taming dragon",
    // game8 bosses
    "tenebrum", "crowcaller", "draven", "cassius", "kearush", "myurdin",
    "excavatron", "staglord", "priscus", "muskan", "cubewalker", "lithus",
    "black fang", "hornsplitter", "hemon", "beindel", "gwen kraber",
    "white bearclaw", "queen spider", "crookrock", "desert marauder", "rusten",
    "abyss kutum", "kutum",
    // additional confirmed bosses
    "goyen", "matthias", "white bear", "t'rukan",
  ];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";

  // PUZZLE — specific puzzle/solution queries → content_type "puzzle" (game8 puzzle guide chunks)
  // Must come before mechanic and exploration so puzzle queries don't get diluted
  if (/\b(puzzles?|strongbox|ancient ruins|sealed gate|disc puzzle|spire.{0,15}puzzle|sanctum.{0,15}puzzle|maze.{0,15}puzzle|ruins.{0,15}puzzle|how (do i|to) solve|puzzle solution)\b/.test(q)) return "puzzle";

  // RECIPE — crafting-specific terms (before item, since crafting pages are content_type "recipe")
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge)\b/.test(q)) return "recipe";

  // SKILL/MECHANIC — "what does X skill do", "how does X work", system questions, challenges, travel
  // Must come BEFORE item so "Focused Shot skill" → mechanic, not item via "shot"
  // Also catches puzzle/upgrade/healing queries whose guide content is content_type "mechanic"
  if (/\b(skill|ability|talent|passive|active|skill tree|mechanic|system|stamina|stat|attribute|combo|aerial|grapple|grappling|observation|abyss artifact|challenge|challenges|mastery|minigame|mini-game|fast travel|fast-travel|travel point|abyss nexus|traces of the abyss|how does the .+ work|how does .+ work|what does .+ do|refinement|refine|upgrade equipment|how to upgrade|how to heal|healing|potion|consumable|critical rate|critical chance)\b/.test(q)) return "mechanic";

  // ITEM — gear/equipment/drop questions (weapons, armor, abyss-gear, accessories all stored as "item")
  // NOTE: currency (gold bars, silver) and "best X" queries are intentionally NOT filtered here
  // because that info often lives in beginner-guides (mechanic content_type). Full vector search
  // across all content types finds it better than a filtered item-only search.
  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|equipment|item|drop|loot|reward|obtain|enhance)\b/;
  const getItemPhrases = /\b(where (do i|can i) (find|get|buy|farm|obtain)|how (do i|to) (acquire|obtain|get|find)|where to (find|get|buy|obtain)|where (is|are) the|how to get)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return "item";

  // EXPLORATION — location/navigation/dungeon queries
  // Catches "how do I get to X", dungeon names, and navigation questions
  // Note: "ruins" alone removed — too broad, catches puzzle queries. Use more specific patterns.
  if (/\b(where is|how do i get to|how to reach|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|tower|temple|crypt|catacomb|camp|ranch|gate|basin|falls|grotto|ridge|beacon|ancient ruins$|ancient ruin$)\b/.test(q)) return "exploration";

  // QUEST — story/objective keywords
  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";

  // CHARACTER/NPC — lore/story character questions
  if (/\b(who is|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane|matthias|shakatu|myurdin|naira|yann|grundir)\b/.test(q)) return "character";

  return null; // ambiguous — no filter, full vector search
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
    // Limits: free = 5/min, 20/hr | premium = 10/min, 60/hr
    // Also wire userTier to the authenticated user's DB record instead of hardcoding "free".
    //
    // const clientIp = getClientIp(req);
    // const userTier: keyof typeof RATE_LIMITS = "free";
    // const limits = RATE_LIMITS[userTier];
    // const now = new Date();
    // const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
    // const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    // const [minuteCheck, hourCheck] = await Promise.all([
    //   supabase.from("queries").select("id", { count: "exact", head: true }).eq("client_ip", clientIp).gte("created_at", oneMinuteAgo),
    //   supabase.from("queries").select("id", { count: "exact", head: true }).eq("client_ip", clientIp).gte("created_at", oneHourAgo),
    // ]);
    // if ((minuteCheck.count ?? 0) >= limits.perMinute) {
    //   return NextResponse.json({ error: "Slow down! You can ask another question in a minute.", rateLimited: true }, { status: 429 });
    // }
    // if ((hourCheck.count ?? 0) >= limits.perHour) {
    //   const resetMinutes = Math.ceil((60 * 60 * 1000 - (now.getTime() - new Date(oneHourAgo).getTime())) / 60000);
    //   return NextResponse.json({ error: `You've hit the hourly limit (${limits.perHour} questions/hour). Try again in ~${resetMinutes} minutes.`, rateLimited: true }, { status: 429 });
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
      return NextResponse.json({ answer: cachedQuery.response, sources: [], cached: true });
    }

    // ===== FULL RAG PIPELINE =====
    let chunks: Record<string, unknown>[] | null = null;
    let searchError: Error | null = null;

    // Classify question to narrow vector search to a specific content type
    const contentTypeFilter = classifyContentType(question);
    console.log("Content type filter:", contentTypeFilter ?? "none (full search)");

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

        console.log("Query embedding generated:", !!queryEmbedding, "dim:", queryEmbedding?.length);
        if (queryEmbedding) {
          // === HYBRID SEARCH: Vector + Keyword Boost ===
          // Step A: Vector search with lower threshold to cast a wider net
          const rpcParams: Record<string, unknown> = {
            query_embedding: queryEmbedding,
            match_threshold: 0.25,
            match_count: tierConfig.matchCount + 10, // fetch extra, we'll re-rank
          };
          if (contentTypeFilter) rpcParams.content_type_filter = contentTypeFilter;

          const { data, error } = await supabase.rpc("match_knowledge_chunks", rpcParams);
          console.log("Vector search (filtered):", data?.length || 0, "results, error:", error?.message || "none");

          // Fallback: if filtered search returns nothing, retry without the filter
          if ((!data || data.length === 0) && contentTypeFilter) {
            console.log("Filtered search empty — retrying without content_type_filter");
            const { data: unfilteredData, error: unfilteredError } = await supabase.rpc(
              "match_knowledge_chunks",
              {
                query_embedding: queryEmbedding,
                match_threshold: 0.25,
                match_count: tierConfig.matchCount + 4,
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
            chunks = chunks.slice(0, tierConfig.matchCount);
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
    const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${SPOILER_INSTRUCTIONS[spoilerTier] || SPOILER_INSTRUCTIONS.full}`;

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
    if (shouldCache) {
      supabase
        .from("queries")
        .insert({
          question: cacheKey,
          response: answer,
          spoiler_tier: spoilerTier,
          chunk_ids_used: chunks?.map((c) => String(c.id)) || [],
          tokens_used: claudeData.usage?.output_tokens || 0,
          client_ip: clientIp,
        })
        .then(() => {});
    } else {
      // Still log the query for analytics (but without response so it won't be served from cache)
      supabase
        .from("queries")
        .insert({
          question: cacheKey,
          response: null,
          spoiler_tier: spoilerTier,
          chunk_ids_used: chunks?.map((c) => String(c.id)) || [],
          tokens_used: claudeData.usage?.output_tokens || 0,
          client_ip: clientIp,
        })
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
