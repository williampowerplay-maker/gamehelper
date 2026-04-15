/**
 * Per-Category RAG Sensitivity Sweep
 *
 * Directly queries Supabase + Voyage AI (no HTTP to the app) to sweep
 * match_threshold and match_count parameters per content_type.
 * Shows exactly which chunks come back for each failing question at
 * each parameter combination — identifies retrieval gaps vs content gaps.
 *
 * Usage:
 *   npx tsx scripts/test-sensitivity-by-category.ts              # all categories
 *   npx tsx scripts/test-sensitivity-by-category.ts --cat boss   # just boss
 *   npx tsx scripts/test-sensitivity-by-category.ts --cat item   # just item
 *   npx tsx scripts/test-sensitivity-by-category.ts --cat puzzle # just puzzle
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ===== ENV =====
const env: Record<string, string> = {};
try {
  const envPath = path.join(__dirname, "..", ".env.local");
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch { /* no .env.local */ }

const SUPABASE_URL  = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const VOYAGE_KEY    = env.VOYAGE_API_KEY || process.env.VOYAGE_API_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !VOYAGE_KEY) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== SWEEP PARAMS =====
const THRESHOLDS   = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35];
const MATCH_COUNTS = [5, 10, 15, 20];

// ===== QUESTION BANK (failing questions from last full test run) =====
interface TestQ {
  q: string;
  cat: string;               // content_type to filter on (null = unfiltered)
  contentTypeFilter: string | null;
  mustTerms: string[];       // terms that should appear in returned chunks
  note: string;
}

const QUESTIONS: TestQ[] = [
  // ── BOSS ────────────────────────────────────────────────────────────────
  { q: "any tips for abyss kutum im getting destroyed",
    cat: "boss", contentTypeFilter: "boss",
    mustTerms: ["kutum", "abyss kutum"],
    note: "NO DEDICATED PAGE — content gap" },
  { q: "whats kearush weak point",
    cat: "boss", contentTypeFilter: "boss",
    mustTerms: ["kearush", "weak", "weak point"],
    note: "specific mechanic — might be in DB" },
  { q: "how do you stagger myurdin",
    cat: "boss", contentTypeFilter: "boss",
    mustTerms: ["myurdin", "stagger"],
    note: "stagger mechanic" },
  { q: "what food should i bring to the antumbra fight",
    cat: "boss", contentTypeFilter: "boss",
    mustTerms: ["antumbra", "food", "cook"],
    note: "prep question — food data may be in mechanic not boss" },
  { q: "ludvig boss guide im stuck on him",
    cat: "boss", contentTypeFilter: "boss",
    mustTerms: ["ludvig"],
    note: "MISSING-KW — answer exists but doesn't name him" },
  { q: "what are the phases of the excavatron boss fight",
    cat: "boss", contentTypeFilter: "boss",
    mustTerms: ["excavatron", "phase"],
    note: "MISSING-KW — phase data may exist" },

  // ── ITEM / WEAPON ────────────────────────────────────────────────────────
  { q: "where do i find a good bow early game",
    cat: "item", contentTypeFilter: "item",
    mustTerms: ["bow", "crossbow"],
    note: "bow location — may need unfiltered" },
  { q: "how do i upgrade my weapon to the next tier",
    cat: "item", contentTypeFilter: null,
    mustTerms: ["refin", "upgrade", "enhance", "tier"],
    note: "refinement system — likely in mechanic not item" },
  { q: "what weapons can kliff use",
    cat: "item", contentTypeFilter: null,
    mustTerms: ["sword", "spear", "bow", "staff", "weapon type"],
    note: "overview content — likely in mechanic or character" },
  { q: "how do i get the darkbringer sword",
    cat: "item", contentTypeFilter: "item",
    mustTerms: ["darkbringer"],
    note: "confirmed content gap — verify" },
  { q: "what are the best accessories in the game",
    cat: "item", contentTypeFilter: "item",
    mustTerms: ["necklace", "ring", "earring", "accessory"],
    note: "best accessories overview" },
  { q: "how do i get the alpha wolf helm",
    cat: "item", contentTypeFilter: "item",
    mustTerms: ["alpha wolf", "alpha"],
    note: "specific armor — may be in DB" },
  { q: "where can i buy weapons in crimson desert",
    cat: "item", contentTypeFilter: "item",
    mustTerms: ["merchant", "vendor", "shop", "buy", "purchase"],
    note: "weapon merchant locations" },
  { q: "whats the best weapon for a beginner in crimson desert",
    cat: "item", contentTypeFilter: null,
    mustTerms: ["sword", "spear", "weapon", "beginner"],
    note: "MISSING-KW — answer exists but may miss keyword" },

  // ── PUZZLE ───────────────────────────────────────────────────────────────
  { q: "how do disc puzzles work in crimson desert",
    cat: "puzzle", contentTypeFilter: "puzzle",
    mustTerms: ["disc", "disc puzzle"],
    note: "disc puzzle mechanic" },
  { q: "how do i open the ancient sealed gate",
    cat: "puzzle", contentTypeFilter: "puzzle",
    mustTerms: ["sealed gate", "gate", "bracelet", "axiom"],
    note: "MISSING-KW — bracelet info exists" },
  { q: "what is the order to press the switches in the ruins",
    cat: "puzzle", contentTypeFilter: "puzzle",
    mustTerms: ["switch", "order", "ruins"],
    note: "switch sequence — may be too specific" },
];

// ===== EMBED via Voyage AI =====
async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOYAGE_KEY}` },
    body: JSON.stringify({ model: "voyage-3.5-lite", input: [text], input_type: "query" }),
  });
  if (!res.ok) throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
  const data: { data: { embedding: number[] }[] } = await res.json();
  return data.data[0].embedding;
}

// ===== QUERY Supabase =====
async function queryDB(
  embedding: number[],
  threshold: number,
  matchCount: number,
  contentTypeFilter: string | null
): Promise<{ content_type: string; similarity: number; content: string; source_url: string }[]> {
  const params: Record<string, unknown> = {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: matchCount,
  };
  if (contentTypeFilter) params.content_type_filter = contentTypeFilter;

  const { data, error } = await supabase.rpc("match_knowledge_chunks", params);
  if (error) throw new Error(`Supabase error: ${error.message}`);
  return (data || []) as { content_type: string; similarity: number; content: string; source_url: string }[];
}

// ===== HELPERS =====
function checkTerms(chunks: { content: string }[], terms: string[]): string | null {
  const combined = chunks.map((c) => c.content).join(" ").toLowerCase();
  return terms.find((t) => combined.includes(t.toLowerCase())) ?? null;
}

function shortContent(s: string, len = 80): string {
  return s.replace(/\s+/g, " ").substring(0, len).trim();
}

function bar(n: number, total: number, width = 20): string {
  const filled = Math.round((n / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ===== MAIN =====
async function run() {
  const catFlag = process.argv.indexOf("--cat");
  const filterCat = catFlag >= 0 ? process.argv[catFlag + 1] : null;

  const questions = filterCat ? QUESTIONS.filter((q) => q.cat === filterCat) : QUESTIONS;

  if (questions.length === 0) {
    console.error(`No questions for cat: ${filterCat}`);
    process.exit(1);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  RAG SENSITIVITY SWEEP — ${filterCat ? filterCat.toUpperCase() : "ALL CATEGORIES"}`);
  console.log(`  Thresholds: ${THRESHOLDS.join(", ")}`);
  console.log(`  Match counts: ${MATCH_COUNTS.join(", ")}`);
  console.log(`${"=".repeat(70)}\n`);

  // Per-threshold summary: how many questions found a term-matching chunk
  const thresholdHits: Record<number, number> = {};
  THRESHOLDS.forEach((t) => (thresholdHits[t] = 0));

  // Per-category best threshold tracking
  const catBest: Record<string, { threshold: number; hits: number; total: number }> = {};

  for (const tq of questions) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  [${tq.cat.toUpperCase()}] ${tq.q}`);
    console.log(`  Filter: content_type=${tq.contentTypeFilter ?? "NONE (unfiltered)"}`);
    console.log(`  MustTerms: ${tq.mustTerms.join(" | ")}`);
    console.log(`  Note: ${tq.note}`);
    console.log(`${"─".repeat(70)}`);

    // Embed once
    let embedding: number[];
    try {
      embedding = await embed(tq.q);
    } catch (e) {
      console.error(`  ❌ Embed failed: ${e}`);
      continue;
    }

    // Sweep thresholds at default matchCount (15)
    console.log(`\n  THRESHOLD SWEEP (matchCount=15):`);
    const hitsByThreshold: Record<number, boolean> = {};

    for (const threshold of THRESHOLDS) {
      let chunks: Awaited<ReturnType<typeof queryDB>>;
      try {
        chunks = await queryDB(embedding, threshold, 15, tq.contentTypeFilter);
      } catch (e) {
        console.log(`    threshold=${threshold}: ERROR ${e}`);
        continue;
      }

      const hit = checkTerms(chunks, tq.mustTerms);
      hitsByThreshold[threshold] = !!hit;
      if (hit) thresholdHits[threshold]++;

      const topSims = chunks.slice(0, 3).map((c) => `${Number(c.similarity).toFixed(3)}[${c.content_type}]`).join("  ");
      const status = hit ? `✅ found:"${hit}"` : `❌ not found`;
      console.log(`    threshold=${threshold}  n=${String(chunks.length).padStart(2)}  top: ${topSims}  ${status}`);
      if (chunks.length > 0 && !hit) {
        // Show top chunk preview to understand what we DID get
        console.log(`       top chunk: "${shortContent(chunks[0].content, 100)}"`);
        console.log(`       url: ${chunks[0].source_url}`);
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    // Find best threshold for this question
    const bestThreshold = THRESHOLDS.find((t) => hitsByThreshold[t]) ?? null;

    // Sweep matchCount at best threshold (or 0.25 as fallback)
    const sweepThreshold = bestThreshold ?? 0.25;
    if (bestThreshold) {
      console.log(`\n  MATCH_COUNT SWEEP (threshold=${sweepThreshold}, term found above):`);
      for (const mc of MATCH_COUNTS) {
        let chunks: Awaited<ReturnType<typeof queryDB>>;
        try {
          chunks = await queryDB(embedding, sweepThreshold, mc, tq.contentTypeFilter);
        } catch (e) {
          console.log(`    matchCount=${mc}: ERROR ${e}`);
          continue;
        }
        const hit = checkTerms(chunks, tq.mustTerms);
        // Find rank of the hit chunk
        const hitRank = chunks.findIndex((c) =>
          tq.mustTerms.some((t) => c.content.toLowerCase().includes(t.toLowerCase()))
        );
        console.log(`    matchCount=${mc}  n=${String(chunks.length).padStart(2)}  hit=${hit ? `✅ rank#${hitRank + 1}` : "❌"}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    } else {
      console.log(`\n  ⚠️  Term NOT found at any threshold with filter=${tq.contentTypeFilter ?? "NONE"}`);
      // Try unfiltered if we were filtering
      if (tq.contentTypeFilter) {
        console.log(`  Retrying UNFILTERED at threshold=0.15, matchCount=20...`);
        try {
          const chunks = await queryDB(embedding, 0.15, 20, null);
          const hit = checkTerms(chunks, tq.mustTerms);
          if (hit) {
            const hitChunk = chunks.find((c) =>
              tq.mustTerms.some((t) => c.content.toLowerCase().includes(t.toLowerCase()))
            );
            console.log(`  ✅ Found unfiltered! content_type="${hitChunk?.content_type}" sim=${Number(hitChunk?.similarity).toFixed(3)}`);
            console.log(`     "${shortContent(hitChunk?.content || "", 120)}"`);
          } else {
            console.log(`  ❌ Not found even unfiltered — TRUE CONTENT GAP`);
          }
        } catch (e) {
          console.log(`  ERROR: ${e}`);
        }
      } else {
        console.log(`  ❌ TRUE CONTENT GAP — not in DB at any threshold`);
      }
    }

    // Accumulate per-cat stats
    if (!catBest[tq.cat]) catBest[tq.cat] = { threshold: 0, hits: 0, total: 0 };
    catBest[tq.cat].total++;
    if (bestThreshold) catBest[tq.cat].hits++;
  }

  // ===== FINAL SUMMARY =====
  console.log(`\n${"=".repeat(70)}`);
  console.log("  SUMMARY: PASS RATE BY CATEGORY");
  console.log(`${"=".repeat(70)}\n`);

  const cats = [...new Set(questions.map((q) => q.cat))];
  for (const cat of cats) {
    const s = catBest[cat] || { hits: 0, total: 1 };
    const pct = Math.round((s.hits / s.total) * 100);
    console.log(`  ${cat.padEnd(8)} ${bar(s.hits, s.total)} ${pct}%  (${s.hits}/${s.total} questions have answer in DB)`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("  THRESHOLD EFFECTIVENESS (how many questions resolved at each threshold)");
  console.log(`${"=".repeat(70)}\n`);

  const totalWithAnswers = Object.values(catBest).reduce((sum, v) => sum + v.hits, 0);
  for (const t of THRESHOLDS) {
    const pct = totalWithAnswers > 0 ? Math.round((thresholdHits[t] / totalWithAnswers) * 100) : 0;
    console.log(`  threshold=${t}  ${bar(thresholdHits[t], Math.max(totalWithAnswers, 1))} ${thresholdHits[t]} questions surfaced`);
  }

  console.log(`\n${"=".repeat(70)}\n`);
  console.log("  INTERPRETATION:");
  console.log("  - ✅ at low threshold (0.10-0.15) = content exists, threshold too strict");
  console.log("  - ✅ at high threshold (0.30-0.35) = retrieval working well already");
  console.log("  - ❌ unfiltered = TRUE CONTENT GAP (need more wiki data)");
  console.log("  - ❌ filtered but ✅ unfiltered = wrong content_type classification");
  console.log(`\n${"=".repeat(70)}\n`);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
