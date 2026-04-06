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
  nudge: { model: "claude-haiku-4-5-20251001", maxTokens: 150,  matchCount: 3 },
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
  nudge: `You are a Crimson Desert game guide. The player wants a NUDGE — a gentle directional hint that preserves the satisfaction of figuring it out themselves.

General rules:
- Keep it to 1-2 sentences maximum. HARD LIMIT.
- Use encouraging language
- NEVER reveal exact solutions, codes, sequences, or specific numbers
- NEVER name the exact item, weapon, or reward they'll get
- If the context doesn't directly answer their question, follow the base fallback rule: pick one snarky line AND then output the scope-explainer block exactly as specified in the base rules. Do not add partial matches, suggestions, or follow-up questions beyond those two parts.

Adapt your nudge based on the type of question:

PUZZLES: Hint at the mechanic or tool involved, never the sequence or solution.
  Good: "Have you tried interacting with the environment using one of your force abilities?"
  Bad: "Use Force Push on walls 2 and 3 on the left" (that's the answer)

ITEM/GEAR LOCATIONS: Name the general area or landmark, never the exact building, room, or container.
  Good: "One of the manors on the north side of Hernand has something special hidden upstairs."
  Bad: "Go to Lion Crest Manor barracks, climb the window, open the chest" (that's a walkthrough)

BOSS FIGHTS: Give one defensive or preparation tip, never the full strategy or cheese method.
  Good: "This boss punishes aggression — focus on learning when it's safe to attack after his combos."
  Bad: "Hide behind the pillar and hit him after his spear throw" (that's the strategy)

MECHANICS/SYSTEMS: You can be slightly more generous here since there's less to spoil, but still keep it brief.
  Good: "There's a skill tree that directly affects how long you can stay airborne — worth investing in early."
  Bad: "Put 4 points into the stamina blue tree to get 200 stamina for aerial maneuver" (too specific)`,

  full: `You are a Crimson Desert game guide. The player wants the SOLUTION — a complete, specific answer with nothing held back.
- Provide the complete answer: item locations, exact boss strategies and move patterns, quest objectives, skill effects, stats
- Format for quick mobile scanning: short paragraphs, bold key actions/items/numbers (wrap in **), numbered steps when sequence matters
- Be specific but don't pad with filler (e.g., "Shoot a fire arrow at the vines on the 2nd floor door" not "You might want to consider using some kind of fire-based attack on the plant-like obstacles")
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

  // BOSS — fight-specific verbs + known boss names
  const bossNames = [
    "kailok", "hornsplitter", "hernand", "ludvig", "gregor", "fortain",
    "gabriel", "lucian", "bastier", "walter", "lanford", "master du",
    "antumbra", "crimson warden", "crimson nightmare", "hexe marie",
    "demeniss", "trukan", "delesyia", "pailune", "saigord", "staglord",
    "reed devil", "blinding flash", "grave walker", "icewalker",
  ];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";

  // RECIPE — crafting-specific terms (before item, since crafting pages are content_type "recipe")
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge)\b/.test(q)) return "recipe";

  // ITEM — gear/equipment/drop questions (weapons, armor, abyss-gear, accessories all stored as "item")
  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|gear|equipment|item|drop|loot|reward|obtain|upgrade|enhance)\b/;
  const getItemPhrases = /\b(how (do i|to) get|where (do i|can i) (find|get|buy|farm)|how (do i|to) unlock|how (do i|to) acquire)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return "item";

  // EXPLORATION — location/navigation queries (BEFORE mechanic so "how do I solve the X Labyrinth"
  // routes to exploration, not mechanic via a bare "how do" match). Also catches dungeon-style
  // level names (labyrinth/ruin/tower) regardless of how the sentence is phrased.
  if (/\b(where is|how do i get to|how to reach|how do i (solve|complete|clear|finish)|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|ruin|ruins|tower|temple|crypt|catacomb|sanctum)\b/.test(q)) return "exploration";

  // QUEST — story/objective keywords
  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";

  // MECHANIC/SKILL — systems questions. Removed bare "how do" / "how does" catch-all —
  // it was misrouting specific-topic questions ("how do I solve X?", "how do I get Y?")
  // to mechanic. Keep "how does the X work" since that phrasing is genuinely systems-y.
  if (/\b(skill|ability|talent|passive|active|skill tree|upgrade|mechanic|system|stamina|stat|attribute|combo|aerial|mount|how does the .+ work|how does .+ work)\b/.test(q)) return "mechanic";

  // CHARACTER/NPC — lore/story character questions
  if (/\b(who is|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane)\b/.test(q)) return "character";

  return null; // ambiguous — no filter, full vector search
}

const BASE_SYSTEM_PROMPT = `You are an expert Crimson Desert game companion AI. You help players with quests, puzzles, bosses, items, mechanics, crafting, and exploration.

Rules:
- Answer based on the provided context. If the context has ANY relevant information about the topic, share what you know — even if it doesn't perfectly match the exact question. For example, if a player asks "where is X?" and you have stats/description for X but no location, share the stats and mention you don't have location data yet.
- ONLY use the snarky no-info response when the context has NOTHING relevant to the question at all.
- Use game-specific terminology (Abyss Artifacts, Pywel, Greymane, etc.)
- Format for quick mobile scanning: short paragraphs, bold key actions
- Never spoil content beyond what the player asks about
- Be warm and encouraging — the player is stuck and needs help`;

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

    // ===== RATE LIMITING =====
    const clientIp = getClientIp(req);
    const userTier = (spoilerTier === "full" ? "premium" : "free") as keyof typeof RATE_LIMITS; // TODO: check actual user tier from auth
    const limits = RATE_LIMITS[userTier];

    // Single Supabase client for the whole request
    const supabase = createClient(supabaseUrl, supabaseKey);
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const [minuteCheck, hourCheck] = await Promise.all([
      supabase
        .from("queries")
        .select("id", { count: "exact", head: true })
        .eq("client_ip", clientIp)
        .gte("created_at", oneMinuteAgo),
      supabase
        .from("queries")
        .select("id", { count: "exact", head: true })
        .eq("client_ip", clientIp)
        .gte("created_at", oneHourAgo),
    ]);

    const queriesLastMinute = minuteCheck.count ?? 0;
    const queriesLastHour = hourCheck.count ?? 0;

    if (queriesLastMinute >= limits.perMinute) {
      return NextResponse.json(
        { error: "Slow down! You can ask another question in a minute.", rateLimited: true },
        { status: 429 }
      );
    }
    if (queriesLastHour >= limits.perHour) {
      const resetMinutes = Math.ceil((60 * 60 * 1000 - (now.getTime() - new Date(oneHourAgo).getTime())) / 60000);
      return NextResponse.json(
        { error: `You've hit the hourly limit (${limits.perHour} questions/hour). Try again in ~${resetMinutes} minutes.`, rateLimited: true },
        { status: 429 }
      );
    }

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
    const tierConfig = TIER_CLAUDE[spoilerTier] || TIER_CLAUDE.nudge;
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: cachedQuery } = await supabase
      .from("queries")
      .select("response")
      .eq("question", question)
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
            match_count: tierConfig.matchCount + 4, // fetch extra, we'll re-rank
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
          // and do an ILIKE search to find chunks that mention them exactly
          const boostKeywords = question
            .replace(/[^a-zA-Z0-9\s'-]/g, "")
            .split(/\s+/)
            .filter((w: string) => w.length > 3 && w[0] === w[0].toUpperCase()) // likely proper nouns
            .slice(0, 4);

          // Also grab multi-word item/boss names. The `(?:'s)?` tolerates possessive
          // apostrophes so "Saint's Necklace" and "Kailok's Lair" are captured as a
          // single multi-word term (was previously broken — apostrophe split the match).
          const quotedNames = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
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
            const urlTerms = allBoostTerms
              .filter((t: string) => t.includes(" "))
              .map((t: string) => t.replace(/\s+/g, "+"));

            // Priority 1: chunks from the page whose URL matches (e.g., /Kailok+the+Hornsplitter)
            let keywordChunks: any[] = [];
            const { data: urlMatches } = urlTerms.length > 0
              ? await supabase
                  .from("knowledge_chunks")
                  .select("id, content, source_url, source_type, quest_name, content_type")
                  .or(urlTerms.map((t: string) => `source_url.ilike.%${t}%`).join(","))
                  .limit(10)
              : { data: null };

            if (urlMatches && urlMatches.length > 0) {
              keywordChunks = urlMatches;
              console.log("URL-match boost:", urlMatches.length, "chunks from matching pages");
            }

            // Priority 2: if URL match found <4 chunks, also grab content mentions
            if (keywordChunks.length < 4) {
              const { data: contentMatches } = await supabase
                .from("knowledge_chunks")
                .select("id, content, source_url, source_type, quest_name, content_type")
                .or(allBoostTerms.map((t: string) => `content.ilike.%${t}%`).join(","))
                .limit(8);
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
              const termHits = questionTerms.filter((t: string) => content.includes(t)).length;
              const baseSim = Number(c.similarity || 0.3);
              // Boost per general term match
              let boost = Math.min(0.10, termHits * 0.02);
              // Bigger boost if chunk is FROM the page about the topic (URL match).
              // Raised from 0.15 → 0.25 so URL matches win the rerank over unrelated
              // filtered-vector results in the 0.78–0.90 sim range.
              if (urlTermsForRerank.some((t: string) => sourceUrl.includes(t))) {
                boost += 0.25;
              }
              // Medium boost if proper noun appears in content
              for (const pn of allBoostTerms) {
                if (content.includes(pn.toLowerCase())) boost += 0.05;
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
        const ranked = data.map((chunk) => {
          const lowerContent = String(chunk.content).toLowerCase();
          const matchCount = keywords.filter((kw) => lowerContent.includes(kw)).length;
          return { ...chunk, matchCount };
        });
        ranked.sort((a, b) => b.matchCount - a.matchCount);
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

    // Snarky no-info responses for when we can't help
    const NO_INFO_RESPONSES = [
      "I don't have info on that one yet.",
      "My database is empty on this. You're on your own, adventurer.",
      "Haven't learned that one yet. Just don't die, I guess.",
      "Drawing a blank here — that's not in my knowledge base yet.",
      "No data on that yet. The wiki might not have it either.",
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

    const context = chunks!.map((c) => String(c.content || "")).join("\n\n---\n\n");

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

    // Step 4: Log the query (async, don't block response)
    supabase
      .from("queries")
      .insert({
        question,
        response: answer,
        spoiler_tier: spoilerTier,
        chunk_ids_used: chunks?.map((c) => String(c.id)) || [],
        tokens_used: claudeData.usage?.output_tokens || 0,
        client_ip: clientIp,
      })
      .then(() => {});

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
