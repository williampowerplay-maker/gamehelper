/**
 * RAG Pipeline Quality Test — By Content Category
 *
 * Tests retrieval quality segmented by wiki category (bosses, items, quests, etc.)
 * Reports pass/fail rates per category to identify weak areas.
 *
 * Usage:
 *   npx tsx scripts/test-rag-quality.ts
 *   npx tsx scripts/test-rag-quality.ts --category items    # Run one category only
 *   npx tsx scripts/test-rag-quality.ts --verbose           # Show chunk content on failure
 *
 * Requires env vars (from .env.local): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, VOYAGE_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ===== ENV SETUP =====
const env: Record<string, string> = {};
try {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });
} catch {
  // No .env.local — running in CI, rely on process.env
}

function getEnv(key: string): string {
  return process.env[key] || env[key] || "";
}

const supabase = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
);
const VOYAGE_KEY = getEnv("VOYAGE_API_KEY");

// ===== TEST CASES — ORGANIZED BY CATEGORY =====
interface TestCase {
  question: string;
  expectedKeywords: string[];
  description: string;
  category: string;   // matches ingestion category names
  contentType: string; // matches DB content_type
}

const TEST_CASES: TestCase[] = [
  // ==================== BOSSES ====================
  {
    category: "bosses", contentType: "boss",
    question: "How do I beat Kailok?",
    expectedKeywords: ["kailok"],
    description: "Kailok boss fight",
  },
  {
    category: "bosses", contentType: "boss",
    question: "What are the phases of the Hornsplitter boss fight?",
    expectedKeywords: ["hornsplitter"],
    description: "Hornsplitter boss phases",
  },
  {
    category: "bosses", contentType: "boss",
    question: "How do I defeat the Crimson Warden?",
    expectedKeywords: ["crimson warden", "warden"],
    description: "Crimson Warden strategy",
  },

  // ==================== ENEMIES ====================
  {
    category: "enemies", contentType: "boss",
    question: "How do I beat the Stoneback Crab?",
    expectedKeywords: ["stoneback crab", "crab"],
    description: "Stoneback Crab combat tips",
  },
  {
    category: "enemies", contentType: "boss",
    question: "What enemies are in the Frozen Soul area?",
    expectedKeywords: ["frozen soul"],
    description: "Frozen Soul area enemies",
  },
  {
    category: "enemies", contentType: "boss",
    question: "What is the Reed Devil weak to?",
    expectedKeywords: ["reed devil"],
    description: "Reed Devil weaknesses",
  },

  // ==================== QUESTS ====================
  {
    category: "quests", contentType: "quest",
    question: "How do I complete the Trial After Trial quest?",
    expectedKeywords: ["trial after trial"],
    description: "Trial After Trial quest steps",
  },
  {
    category: "quests", contentType: "quest",
    question: "What is the reward for the Greymane Initiation quest?",
    expectedKeywords: ["greymane", "initiation"],
    description: "Greymane Initiation quest reward",
  },
  {
    category: "quests", contentType: "quest",
    question: "How do I start the main storyline quest?",
    expectedKeywords: ["quest", "main", "story"],
    description: "Main storyline quest start",
  },

  // ==================== WALKTHROUGH ====================
  {
    category: "walkthrough", contentType: "quest",
    question: "What is the game progress route for Crimson Desert?",
    expectedKeywords: ["progress", "route", "walkthrough"],
    description: "Game progress route overview",
  },
  {
    category: "walkthrough", contentType: "quest",
    question: "How do I unlock New Game Plus?",
    expectedKeywords: ["new game plus", "new game+", "ng+", "new game"],
    description: "NG+ requirements",
  },
  {
    category: "walkthrough", contentType: "quest",
    question: "What is the recommended order to complete main quests?",
    expectedKeywords: ["main quest", "walkthrough", "order", "progress"],
    description: "Main quest order",
  },

  // ==================== WEAPONS ====================
  {
    category: "weapons", contentType: "item",
    question: "What weapons can Oongka use?",
    expectedKeywords: ["oongka"],
    description: "Oongka weapon types",
  },
  {
    category: "weapons", contentType: "item",
    question: "What is the best sword in Crimson Desert?",
    expectedKeywords: ["sword"],
    description: "Best sword info",
  },
  {
    category: "weapons", contentType: "item",
    question: "Where do I find the Medium Twilight Messengers Banner Pike?",
    expectedKeywords: ["twilight messengers", "banner pike"],
    description: "Twilight Messengers Banner Pike location",
  },

  // ==================== ARMOR ====================
  {
    category: "armor", contentType: "item",
    question: "Where do I find the Skyblazer Cloth Helm?",
    expectedKeywords: ["three brothers wyvern nest", "three brothers", "wyvern nest"],
    description: "Skyblazer Cloth Helm location",
  },
  {
    category: "armor", contentType: "item",
    question: "What stats does the Beltran Plate Helm have?",
    expectedKeywords: ["beltran plate helm", "beltran plate", "defense"],
    description: "Beltran Plate Helm defense stats",
  },
  {
    category: "armor", contentType: "item",
    question: "Where can I find the Alpha Wolf Helm?",
    expectedKeywords: ["alpha wolf helm", "alpha wolf"],
    description: "Alpha Wolf Helm location",
  },

  // ==================== ABYSS GEAR ====================
  {
    category: "abyss-gear", contentType: "item",
    question: "What are Abyss Artifacts?",
    expectedKeywords: ["abyss artifact", "abyss"],
    description: "Abyss Artifacts info",
  },
  {
    category: "abyss-gear", contentType: "item",
    question: "How do I get Abyss Gear in Crimson Desert?",
    expectedKeywords: ["abyss gear", "abyss"],
    description: "Abyss Gear acquisition",
  },

  // ==================== ACCESSORIES ====================
  {
    category: "accessories", contentType: "item",
    question: "Where do I get the Ancient Ring?",
    expectedKeywords: ["ancient ring"],
    description: "Ancient Ring location",
  },
  {
    category: "accessories", contentType: "item",
    question: "What does the Witch's Earring do?",
    expectedKeywords: ["witch's earring", "witch"],
    description: "Witch's Earring stats",
  },

  // ==================== ITEMS ====================
  {
    category: "items", contentType: "item",
    question: "What recovery items are available?",
    expectedKeywords: ["recovery", "potion", "heal"],
    description: "Recovery items list",
  },
  {
    category: "items", contentType: "item",
    question: "What crafting materials do I need for upgrades?",
    expectedKeywords: ["material", "craft"],
    description: "Crafting materials info",
  },

  // ==================== COLLECTIBLES ====================
  {
    category: "collectibles", contentType: "item",
    question: "Where are all the Bell locations?",
    expectedKeywords: ["bell"],
    description: "Bell collectible locations",
  },

  // ==================== KEY ITEMS ====================
  {
    category: "key-items", contentType: "item",
    question: "What does the Key to the Spire of the Stars do?",
    expectedKeywords: ["spire of the stars", "spire"],
    description: "Key to Spire of Stars",
  },
  {
    category: "key-items", contentType: "item",
    question: "Where do I find Memory Fragments?",
    expectedKeywords: ["memory fragment", "memory"],
    description: "Memory Fragment locations",
  },

  // ==================== LOCATIONS ====================
  {
    category: "locations", contentType: "exploration",
    question: "Where is Pailune located?",
    expectedKeywords: ["pailune"],
    description: "Pailune location info",
  },
  {
    category: "locations", contentType: "exploration",
    question: "How do I get to Greymane Camp?",
    expectedKeywords: ["greymane camp", "greymane"],
    description: "Greymane Camp directions",
  },
  {
    category: "locations", contentType: "exploration",
    question: "What can I find in the Abyss Nexus?",
    expectedKeywords: ["abyss nexus", "nexus"],
    description: "Abyss Nexus exploration",
  },

  // ==================== CHARACTERS ====================
  {
    category: "characters", contentType: "character",
    question: "Who is Kliff?",
    expectedKeywords: ["kliff"],
    description: "Kliff character info",
  },
  {
    category: "characters", contentType: "character",
    question: "Who is Damiane?",
    expectedKeywords: ["damiane"],
    description: "Damiane character info",
  },

  // ==================== NPCs ====================
  {
    category: "npcs", contentType: "character",
    question: "Where can I find vendors in Crimson Desert?",
    expectedKeywords: ["vendor", "merchant", "shop"],
    description: "Vendor/merchant locations",
  },

  // ==================== SKILLS ====================
  {
    category: "skills", contentType: "mechanic",
    question: "What does the Focused Shot skill do?",
    expectedKeywords: ["focused shot"],
    description: "Focused Shot skill description",
  },
  {
    category: "skills", contentType: "mechanic",
    question: "What does the Force Current skill do?",
    expectedKeywords: ["force current"],
    description: "Force Current skill description",
  },
  {
    category: "skills", contentType: "mechanic",
    question: "What skills does Kliff have?",
    expectedKeywords: ["kliff", "skill"],
    description: "Kliff skill list",
  },

  // ==================== CRAFTING ====================
  {
    category: "crafting", contentType: "recipe",
    question: "How does crafting work in Crimson Desert?",
    expectedKeywords: ["craft", "crafting"],
    description: "Crafting mechanics",
  },
  {
    category: "crafting", contentType: "recipe",
    question: "Where do I find crafting recipes?",
    expectedKeywords: ["recipe", "craft", "manual"],
    description: "Crafting recipe locations",
  },

  // ==================== GUIDES ====================
  {
    category: "guides", contentType: "mechanic",
    question: "What are the best tips for new players?",
    expectedKeywords: ["new player", "beginner", "tip", "guide"],
    description: "New player guide tips",
  },
  {
    category: "guides", contentType: "mechanic",
    question: "How does the housing system work?",
    expectedKeywords: ["housing", "house"],
    description: "Housing guide mechanics",
  },
  {
    category: "guides", contentType: "mechanic",
    question: "What are the best combat tips for beginners?",
    expectedKeywords: ["combat", "tip", "dodge", "parry", "attack"],
    description: "Combat tips for beginners",
  },

  // ===========================================================
  // REAL PLAYER QUESTIONS — sourced from Reddit / Steam / Google
  // ===========================================================

  // --- Death & Penalties ---
  {
    category: "guides", contentType: "mechanic",
    question: "What happens when I die in Crimson Desert?",
    expectedKeywords: ["death", "die", "penalty", "silver", "durability"],
    description: "[REAL] Death penalty mechanics",
  },

  // --- Save System ---
  {
    category: "guides", contentType: "mechanic",
    question: "How do I save my game in Crimson Desert?",
    expectedKeywords: ["save", "auto-save", "mercenary camp", "camp"],
    description: "[REAL] Save system mechanics",
  },

  // --- Weather / Hidden Mechanics ---
  {
    category: "guides", contentType: "mechanic",
    question: "Does weather affect combat in Crimson Desert?",
    expectedKeywords: ["weather", "wet", "lightning", "rain"],
    description: "[REAL] Weather combat effects",
  },

  // --- Observe Mechanic ---
  {
    category: "skills", contentType: "mechanic",
    question: "How do I unlock new skills by observing?",
    expectedKeywords: ["observe", "unlock", "skill"],
    description: "[REAL] Observe mechanic for skills",
  },

  // --- Boss Strategy: Reed Devil ---
  {
    category: "bosses", contentType: "boss",
    question: "How do I beat the Reed Devil boss?",
    expectedKeywords: ["reed devil"],
    description: "[REAL] Reed Devil boss strategy",
  },

  // --- Healing / Grilled Meat ---
  {
    category: "items", contentType: "item",
    question: "Where do I get grilled meat for healing?",
    expectedKeywords: ["grilled meat", "meat", "heal"],
    description: "[REAL] Grilled meat / healing items",
  },

  // --- Grapple Mechanic ---
  {
    category: "guides", contentType: "mechanic",
    question: "How does grappling work in boss fights?",
    expectedKeywords: ["grapple", "grappling", "stagger"],
    description: "[REAL] Grapple mechanic in combat",
  },

  // --- Palmer Pills ---
  {
    category: "items", contentType: "item",
    question: "What do Palmer Pills do?",
    expectedKeywords: ["palmer pill", "resurrection", "revive"],
    description: "[REAL] Palmer Pills resurrection item",
  },

  // --- Stamina in Combat ---
  {
    category: "guides", contentType: "mechanic",
    question: "Is stamina important in boss fights?",
    expectedKeywords: ["stamina", "block", "dodge"],
    description: "[REAL] Stamina importance in combat",
  },

  // --- Best Weapons ---
  {
    category: "weapons", contentType: "item",
    question: "What is the best weapon type in Crimson Desert?",
    expectedKeywords: ["sword", "spear", "greatsword", "weapon"],
    description: "[REAL] Best weapon type recommendation",
  },

  // --- Hwando Sword Location ---
  {
    category: "weapons", contentType: "item",
    question: "Where do I find the Hwando Sword?",
    expectedKeywords: ["hwando", "lioncrest", "lyon"],
    description: "[REAL] Hwando Sword early game location",
  },

  // --- Weapon Upgrading ---
  {
    category: "guides", contentType: "mechanic",
    question: "How do I upgrade weapons in Crimson Desert?",
    expectedKeywords: ["upgrade", "refine", "refining", "weapon"],
    description: "[REAL] Weapon upgrade/refining system",
  },

  // --- Abyss Gear Slotting ---
  {
    category: "abyss-gear", contentType: "item",
    question: "How do I slot Abyss Gear into weapons?",
    expectedKeywords: ["abyss gear", "slot", "elowen", "witch"],
    description: "[REAL] Abyss Gear slotting via Elowen",
  },

  // --- Contradiction Quest ---
  {
    category: "quests", contentType: "quest",
    question: "What are the answers for the Contradiction quest?",
    expectedKeywords: ["contradiction", "weight of knowledge"],
    description: "[REAL] Contradiction quest answers",
  },

  // --- Close Threat Quest ---
  {
    category: "quests", contentType: "quest",
    question: "What are the Close Threat quest answers?",
    expectedKeywords: ["close threat"],
    description: "[REAL] Close Threat quest answers",
  },

  // --- Five-Finger Mountain ---
  {
    category: "locations", contentType: "exploration",
    question: "How do I get to Five-Finger Mountain?",
    expectedKeywords: ["five-finger", "five finger", "mountain"],
    description: "[REAL] Five-Finger Mountain location",
  },

  // --- Hernand Town ---
  {
    category: "locations", contentType: "exploration",
    question: "Where is Hernand and what can I do there?",
    expectedKeywords: ["hernand"],
    description: "[REAL] Hernand town info",
  },

  // --- Nature's Grasp Skill ---
  {
    category: "skills", contentType: "mechanic",
    question: "What does Nature's Grasp do in combat?",
    expectedKeywords: ["nature's grasp", "natures grasp", "grasp"],
    description: "[REAL] Nature's Grasp skill usage",
  },
];

// ===== EMBEDDING =====
async function getQueryEmbedding(text: string): Promise<number[] | null> {
  if (!VOYAGE_KEY) return null;
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VOYAGE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3.5-lite",
        input: [text],
        input_type: "query",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data[0].embedding;
  } catch {
    return null;
  }
}

// ===== CHUNK RETRIEVAL (mirrors chat route hybrid search) =====
interface ChunkResult {
  id?: string;
  content: string;
  source_url: string;
  similarity: number;
}

let rpcWarningShown = false;

async function queryChunks(embedding: number[], question: string): Promise<ChunkResult[]> {
  // 1. Vector search via RPC
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embedding,
    match_threshold: 0.25,
    match_count: 12,
  });

  if (error && !rpcWarningShown) {
    console.log(`  [RPC warning: ${error.message}]`);
    rpcWarningShown = true;
  }

  let vectorResults: ChunkResult[] = (data || []).map((row: any) => ({
    id: row.id,
    content: row.content,
    source_url: row.source_url,
    similarity: row.similarity,
  }));

  // 2. Keyword boost — prioritize chunks FROM the page about the topic (URL match)
  const properNouns = extractProperNouns(question);
  if (properNouns.length > 0) {
    // Only multi-word terms for URL matching — single words like "Crimson" match the domain
    const urlTerms = properNouns
      .filter((t) => t.includes(" "))
      .map((t) => t.replace(/\s+/g, "+"));

    // Priority 1: chunks from pages whose URL matches the proper noun
    let keywordChunks: any[] = [];
    const { data: urlMatches } = urlTerms.length > 0
      ? await supabase
          .from("knowledge_chunks")
          .select("id, content, source_url")
          .or(urlTerms.map((t) => `source_url.ilike.%${t}%`).join(","))
          .limit(10)
      : { data: null };

    if (urlMatches && urlMatches.length > 0) {
      keywordChunks = urlMatches;
    }

    // Priority 2: if <4 URL matches, also grab content mentions
    if (keywordChunks.length < 4) {
      const { data: contentMatches } = await supabase
        .from("knowledge_chunks")
        .select("id, content, source_url")
        .or(properNouns.map((t) => `content.ilike.%${t}%`).join(","))
        .limit(8);
      if (contentMatches) {
        const existingKwIds = new Set(keywordChunks.map((c: any) => c.id));
        for (const c of contentMatches) {
          if (!existingKwIds.has(c.id)) keywordChunks.push(c);
        }
      }
    }

    const existingIds = new Set(vectorResults.map((c) => c.id));
    for (const row of keywordChunks as any[]) {
      if (!existingIds.has(row.id)) {
        const isUrlMatch = urlTerms.some((t) =>
          String(row.source_url || "").toLowerCase().includes(t.toLowerCase()));
        vectorResults.push({
          id: row.id,
          content: row.content,
          source_url: row.source_url,
          similarity: isUrlMatch ? 0.55 : 0.40,
        });
      }
    }
  }

  // 3. Re-rank — boost for term matches + bigger boost for URL matches
  const terms = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const urlTermsForRerank = properNouns.map((t) => t.replace(/\s+/g, "+").toLowerCase());
  vectorResults = vectorResults.map((c) => {
    const contentLower = c.content.toLowerCase();
    const sourceUrl = c.source_url.toLowerCase();
    let boost = 0;
    for (const t of terms) {
      if (contentLower.includes(t)) boost += 0.02;
    }
    // Big boost if chunk is FROM the topic's page
    if (urlTermsForRerank.some((t) => sourceUrl.includes(t))) {
      boost += 0.15;
    }
    // Medium boost for proper noun in content
    for (const pn of properNouns) {
      if (contentLower.includes(pn.toLowerCase())) boost += 0.05;
    }
    return { ...c, similarity: c.similarity + boost };
  });
  vectorResults.sort((a, b) => b.similarity - a.similarity);
  return vectorResults.slice(0, 10);
}

function extractProperNouns(question: string): string[] {
  const stripped = question.replace(/[?!.,]/g, "");
  const stopWords = new Set([
    "where", "what", "how", "who", "when", "why", "which", "does", "do", "did",
    "is", "are", "was", "were", "can", "could", "the", "a", "an", "i", "my",
    "to", "in", "on", "at", "for", "of", "with", "from", "by", "about", "into",
    "it", "its", "this", "that", "have", "has", "had", "get", "find", "use",
    "work", "beat", "complete", "unlock", "drop", "located", "enemies",
  ]);
  const words = stripped.split(/\s+/);
  let run: string[] = [];
  const nouns: string[] = [];

  for (const w of words) {
    if (w.length > 0 && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) {
      if (!stopWords.has(w.toLowerCase())) run.push(w);
      // Allow "the/of/and" in the middle of proper noun runs (e.g., "Crimson the Warden")
      else if (run.length > 0 && ["the", "of", "and", "in", "at"].includes(w.toLowerCase())) { /* skip but don't break */ }
      else { if (run.length > 0) { nouns.push(run.join(" ")); run = []; } }
    } else {
      if (run.length > 0) { nouns.push(run.join(" ")); run = []; }
    }
  }
  if (run.length > 0) nouns.push(run.join(" "));

  const result: string[] = [];
  for (const n of nouns) {
    result.push(n);
    const parts = n.split(" ");
    if (parts.length > 1) {
      for (const p of parts) {
        if (p.length > 2 && !stopWords.has(p.toLowerCase())) result.push(p);
      }
    }
  }
  return [...new Set(result)];
}

// ===== MAIN =====
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const categoryFlag = args.indexOf("--category");
  const targetCategory = categoryFlag >= 0 ? args[categoryFlag + 1] : null;

  console.log("==============================================");
  console.log("  RAG Pipeline Quality Test — By Category");
  console.log("==============================================\n");

  if (!VOYAGE_KEY) {
    console.error("FATAL: VOYAGE_API_KEY is not set.");
    process.exit(1);
  }

  const testCases = targetCategory
    ? TEST_CASES.filter((tc) => tc.category === targetCategory)
    : TEST_CASES;

  if (testCases.length === 0) {
    console.error(`No tests for category: ${targetCategory}`);
    const cats = [...new Set(TEST_CASES.map((tc) => tc.category))];
    console.log("Available:", cats.join(", "));
    process.exit(1);
  }

  console.log(`Running ${testCases.length} tests${targetCategory ? ` (category: ${targetCategory})` : " across all categories"}\n`);

  // Track results per category
  interface TestResult {
    test: TestCase;
    pass: boolean;
    topSimilarity: number;
    matchedKeyword: string | null;
    chunks: number;
  }
  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    process.stdout.write(`[${i + 1}/${testCases.length}] [${tc.category}] ${tc.description}... `);

    const embedding = await getQueryEmbedding(tc.question);
    if (!embedding) {
      console.log("SKIP (embedding failed)");
      results.push({ test: tc, pass: false, topSimilarity: 0, matchedKeyword: null, chunks: 0 });
      continue;
    }

    const chunks = await queryChunks(embedding, tc.question);

    if (chunks.length === 0) {
      console.log("FAIL (no chunks)");
      results.push({ test: tc, pass: false, topSimilarity: 0, matchedKeyword: null, chunks: 0 });
      continue;
    }

    const allContent = chunks.map((c) => c.content.toLowerCase()).join("\n");
    const matchedKeyword = tc.expectedKeywords.find((kw) => allContent.includes(kw.toLowerCase()));
    const topSim = chunks[0].similarity;

    if (matchedKeyword) {
      console.log(`PASS (sim: ${topSim.toFixed(3)}, kw: "${matchedKeyword}")`);
      results.push({ test: tc, pass: true, topSimilarity: topSim, matchedKeyword, chunks: chunks.length });
    } else {
      console.log(`FAIL (sim: ${topSim.toFixed(3)})`);
      if (verbose) {
        console.log(`    Expected: ${tc.expectedKeywords.join(" | ")}`);
        console.log(`    Top chunk: "${chunks[0].content.slice(0, 120)}..."`);
        console.log(`    Source: ${chunks[0].source_url}`);
      }
      results.push({ test: tc, pass: false, topSimilarity: topSim, matchedKeyword: null, chunks: chunks.length });
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  // ===== CATEGORY REPORT =====
  const categories = [...new Set(testCases.map((tc) => tc.category))];
  const catStats: {
    category: string;
    total: number;
    passed: number;
    failed: number;
    rate: string;
    avgSim: string;
    failedTests: string[];
  }[] = [];

  for (const cat of categories) {
    const catResults = results.filter((r) => r.test.category === cat);
    const catPassed = catResults.filter((r) => r.pass).length;
    const catFailed = catResults.filter((r) => !r.pass).length;
    const catTotal = catResults.length;
    const sims = catResults.filter((r) => r.topSimilarity > 0).map((r) => r.topSimilarity);
    const avgSim = sims.length > 0 ? (sims.reduce((a, b) => a + b, 0) / sims.length) : 0;
    const failedTests = catResults.filter((r) => !r.pass).map((r) => r.test.description);

    catStats.push({
      category: cat,
      total: catTotal,
      passed: catPassed,
      failed: catFailed,
      rate: catTotal > 0 ? `${((catPassed / catTotal) * 100).toFixed(0)}%` : "N/A",
      avgSim: avgSim.toFixed(3),
      failedTests,
    });
  }

  // Sort by failure rate (worst first)
  catStats.sort((a, b) => {
    const rateA = a.total > 0 ? a.passed / a.total : 1;
    const rateB = b.total > 0 ? b.passed / b.total : 1;
    return rateA - rateB;
  });

  console.log("\n==============================================");
  console.log("  RESULTS BY CATEGORY (worst → best)");
  console.log("==============================================\n");

  // Table header
  console.log("  Category        | Pass | Fail | Rate  | Avg Sim");
  console.log("  ----------------+------+------+-------+--------");

  for (const cs of catStats) {
    const cat = cs.category.padEnd(16);
    const pass = String(cs.passed).padStart(4);
    const fail = String(cs.failed).padStart(4);
    const rate = cs.rate.padStart(5);
    console.log(`  ${cat}|${pass} |${fail} | ${rate} | ${cs.avgSim}`);
    if (cs.failedTests.length > 0) {
      for (const ft of cs.failedTests) {
        console.log(`    ↳ FAIL: ${ft}`);
      }
    }
  }

  // ===== OVERALL SUMMARY =====
  const totalPassed = results.filter((r) => r.pass).length;
  const totalFailed = results.filter((r) => !r.pass).length;
  const totalTests = results.length;
  const overallRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : "0";

  const allSims = results.filter((r) => r.topSimilarity > 0).map((r) => r.topSimilarity);
  const avgSim = allSims.length > 0 ? (allSims.reduce((a, b) => a + b, 0) / allSims.length).toFixed(3) : "N/A";

  console.log("\n==============================================");
  console.log("  OVERALL SUMMARY");
  console.log("==============================================\n");
  console.log(`  Total:  ${totalPassed}/${totalTests} passed (${overallRate}%)`);
  console.log(`  Avg similarity: ${avgSim}`);

  // Identify weakest categories
  const weakCats = catStats.filter((cs) => cs.failed > 0);
  if (weakCats.length > 0) {
    console.log("\n  Categories needing attention:");
    for (const wc of weakCats) {
      console.log(`    • ${wc.category}: ${wc.rate} pass rate (${wc.failed} failures)`);
    }
  }

  console.log("\n==============================================");
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
