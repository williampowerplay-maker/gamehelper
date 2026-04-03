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

// Per-tier Claude settings — nudge uses Haiku (~20x cheaper), guide/full use Sonnet
const TIER_CLAUDE: Record<string, { model: string; maxTokens: number; matchCount: number }> = {
  nudge: { model: "claude-haiku-4-5-20251001", maxTokens: 150,  matchCount: 3 },
  guide: { model: "claude-sonnet-4-20250514",  maxTokens: 600,  matchCount: 6 },
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
- If the context doesn't directly answer their question, pick ONE snarky gamer response like "I haven't been trained on that yet... maybe just man up and figure it out yourself" or "No clue. Skill issue." Say NOTHING else. No partial matches, no suggestions, no follow-up questions.

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

  guide: `You are a Crimson Desert game guide. The player wants a GUIDE — a step-by-step walkthrough.
- Provide clear, actionable steps to solve their problem
- Use bold for key actions (wrap in **)
- Be specific but don't over-explain (e.g., "Shoot a fire arrow at the vines on the 2nd floor door")
- Keep it concise — 3-5 steps max
- Mention relevant items or abilities they might need`,

  full: `You are a Crimson Desert game guide. The player wants the FULL SOLUTION — complete detailed answer.
- Provide the complete, detailed answer with nothing held back
- Include item locations, exact strategies, boss move patterns, video timestamps if available
- Format for easy scanning: short paragraphs, bold key info
- Include any related tips or things they might miss`,
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

  // QUEST — story/objective keywords
  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";

  // EXPLORATION — location/navigation queries (but not "where do I get" item questions — those matched above)
  if (/\b(where is|how do i get to|how to reach|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter)\b/.test(q)) return "exploration";

  // MECHANIC/SKILL — systems questions
  if (/\b(skill|ability|talent|passive|active|skill tree|upgrade|how does|how do|mechanic|system|stamina|stat|attribute|combo|aerial|mount)\b/.test(q)) return "mechanic";

  // CHARACTER/NPC — lore/story character questions
  if (/\b(who is|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane)\b/.test(q)) return "character";

  return null; // ambiguous — no filter, full vector search
}

const BASE_SYSTEM_PROMPT = `You are an expert Crimson Desert game companion AI. You help players with quests, puzzles, bosses, items, mechanics, crafting, and exploration.

Rules:
- ONLY answer based on the provided context. If the context doesn't directly answer the question, pick ONE of these responses at random and say NOTHING else:
  "I haven't been trained on that yet... maybe you should just man up and figure it out yourself."
  "No clue on that one. Skill issue."
  "My database is empty on this. You're on your own, adventurer."
  "Haven't learned that one yet. Just don't die, I guess."
  "I got nothing. Sounds like a you problem."
  Do NOT add anything after the line. No partial matches, no suggestions, no follow-ups.
- Use game-specific terminology (Abyss Artifacts, Pywel, Greymane, etc.)
- Format for quick mobile scanning: short paragraphs, bold key actions
- Never spoil content beyond what the player asks about
- Be warm and encouraging — the player is stuck and needs help`;

export async function POST(req: NextRequest) {
  try {
    const { question, spoilerTier = "guide" } = await req.json();

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
    const tierConfig = TIER_CLAUDE[spoilerTier] || TIER_CLAUDE.guide;
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
              input_type: "document",  // "query" type loses precision through PostgREST JSON→vector cast
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
          // First attempt: filtered search (faster, more precise)
          const rpcParams: Record<string, unknown> = {
            query_embedding: queryEmbedding,
            match_threshold: 0.5,
            match_count: tierConfig.matchCount,
          };
          if (contentTypeFilter) rpcParams.content_type_filter = contentTypeFilter;

          const { data, error } = await supabase.rpc("match_knowledge_chunks", rpcParams);
          console.log("Vector search (filtered):", data?.length || 0, "results, error:", error?.message || "none");

          // Fallback: if filtered search returns nothing, retry without the filter
          // (e.g. "how to get Crow's Pursuit" classified as item but it's in abyss-gear)
          if ((!data || data.length === 0) && contentTypeFilter) {
            console.log("Filtered search empty — retrying without content_type_filter");
            const { data: unfilteredData, error: unfilteredError } = await supabase.rpc(
              "match_knowledge_chunks",
              {
                query_embedding: queryEmbedding,
                match_threshold: 0.5,
                match_count: tierConfig.matchCount,
              }
            );
            console.log("Vector search (unfiltered fallback):", unfilteredData?.length || 0, "results");
            chunks = unfilteredData;
            if (unfilteredError) searchError = unfilteredError as unknown as Error;
          } else {
            chunks = data;
            if (error) searchError = error as unknown as Error;
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
      "I haven't been trained on that yet... maybe you should just man up and figure it out yourself.",
      "No clue on that one. Skill issue.",
      "My database is empty on this. You're on your own, adventurer.",
      "Haven't learned that one yet. Just don't die, I guess.",
      "I got nothing. Sounds like a you problem.",
    ];
    const randomNoInfo = () => NO_INFO_RESPONSES[Math.floor(Math.random() * NO_INFO_RESPONSES.length)];

    // Check if we have genuinely relevant results (not just partial keyword matches)
    const hasRelevantContext = chunks && chunks.length > 0 && (
      // Vector search results have similarity scores — trust those
      (chunks[0] as Record<string, unknown>).similarity !== undefined
        ? Number((chunks[0] as Record<string, unknown>).similarity) > 0.5
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
    const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${SPOILER_INSTRUCTIONS[spoilerTier] || SPOILER_INSTRUCTIONS.guide}`;

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

  if (tier === "guide") {
    if (q.includes("labyrinth") || q.includes("puzzle"))
      return "**1.** Enter the labyrinth and take the left path at the first fork.\n**2.** Look for the glowing rune on the north wall — interact with it.\n**3.** This opens a hidden passage. Follow it to the central chamber.\n**4.** In the central chamber, activate the three pillars in order: left, right, center.";
    if (q.includes("boss") || q.includes("kailok") || q.includes("hornsplitter"))
      return "**Phase 1:** Stay at mid-range. Dodge his charge attack by rolling to the right.\n**Phase 2:** When he glows red, he's about to do an AoE — back away.\n**Phase 3:** Use fire-based attacks for extra damage. His weak point is his back legs.\n\n**Tip:** Bring at least 5 healing potions.";
    return "I'd love to help with that! This is a **demo response** — connect your Claude API key in `.env.local` to get real AI-powered answers from the knowledge base.";
  }

  // Full solution
  return `This is a **demo response** showing how the full solution tier works.\n\nTo get real answers powered by AI:\n1. Get a Claude API key from **console.anthropic.com**\n2. Add it to \`.env.local\` as \`ANTHROPIC_API_KEY\`\n3. Add an OpenAI key for embeddings as \`OPENAI_API_KEY\`\n4. Seed the knowledge base with game content\n\nOnce connected, this tier provides complete detailed walkthroughs with sources.`;
}
