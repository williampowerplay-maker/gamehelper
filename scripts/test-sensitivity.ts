/**
 * Retrieval Sensitivity Test — By Content Type
 *
 * Sweeps (match_threshold × match_count) parameter combos for each content_type
 * and reports the optimal settings per type. Embeddings are generated once and
 * cached in memory — only Voyage API cost is 1 call per unique question.
 *
 * Usage:
 *   npx tsx scripts/test-sensitivity.ts                    # Full sweep, all types
 *   npx tsx scripts/test-sensitivity.ts --type boss        # One content type only
 *   npx tsx scripts/test-sensitivity.ts --verbose          # Show chunk snippets on fail
 *
 * Reads: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, VOYAGE_API_KEY from .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ───────────────────────── ENV ─────────────────────────
const env: Record<string, string> = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8");
  raw.split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch { /* CI: rely on process.env */ }

const get = (k: string) => process.env[k] || env[k] || "";
const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
const VOYAGE_KEY = get("VOYAGE_API_KEY");

// ───────────────────────── ARGS ─────────────────────────
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const typeFlag = args.indexOf("--type");
const filterType = typeFlag >= 0 ? args[typeFlag + 1] : null;

// ───────────────────────── TEST CASES ─────────────────────────
// Each case has a contentType (maps to DB content_type), a question, and
// keywords that must appear somewhere in the retrieved chunk content to count as a pass.
interface Case {
  contentType: string;
  question: string;
  keywords: string[];
  label: string;
}

const CASES: Case[] = [
  // ── BOSS ────────────────────────────────────────────────────
  { contentType: "boss", label: "Tenebrum strategy",       question: "how do I beat tenebrum",                      keywords: ["tenebrum"] },
  { contentType: "boss", label: "Hornsplitter phases",     question: "hornsplitter boss fight phases",              keywords: ["hornsplitter"] },
  { contentType: "boss", label: "Crowcaller strategy",     question: "how do I defeat crowcaller",                  keywords: ["crowcaller"] },
  { contentType: "boss", label: "Kailok second phase",     question: "kailok boss second phase strategy",           keywords: ["kailok"] },
  { contentType: "boss", label: "Crimson Warden",          question: "crimson warden boss strategy",                keywords: ["crimson warden"] },
  { contentType: "boss", label: "Kearush fight",           question: "how to fight kearush",                        keywords: ["kearush"] },
  { contentType: "boss", label: "Cassius boss",            question: "cassius boss guide",                          keywords: ["cassius"] },
  { contentType: "boss", label: "Myurdin stagger",         question: "how to stagger or interrupt myurdin",         keywords: ["myurdin"] },
  { contentType: "boss", label: "Staglord",                question: "how to beat the staglord",                    keywords: ["staglord"] },
  { contentType: "boss", label: "Excavatron phases",       question: "excavatron boss phases",                      keywords: ["excavatron"] },
  { contentType: "boss", label: "Queen Spider cheese",     question: "queen spider boss strategy",                  keywords: ["queen spider"] },
  { contentType: "boss", label: "Antumbra fight",          question: "antumbra boss fight tips",                    keywords: ["antumbra"] },
  { contentType: "boss", label: "Desert Marauder Rusten",  question: "desert marauder rusten strategy",             keywords: ["rusten"] },
  { contentType: "boss", label: "Ludvig fight",            question: "ludvig boss fight",                           keywords: ["ludvig"] },
  { contentType: "boss", label: "Reed Devil",              question: "how to beat the reed devil",                  keywords: ["reed devil"] },

  // ── ITEM ────────────────────────────────────────────────────
  { contentType: "item", label: "Hwando Sword location",       question: "where do I find the hwando sword",            keywords: ["hwando"] },
  { contentType: "item", label: "Twilight Banner Pike",        question: "twilight messengers banner pike location",     keywords: ["twilight messengers", "banner pike"] },
  { contentType: "item", label: "Alpha Wolf Helm",             question: "where do I get the alpha wolf helm",           keywords: ["alpha wolf"] },
  { contentType: "item", label: "Skyblazer Helm",              question: "skyblazer cloth helm location",                keywords: ["skyblazer", "three brothers", "wyvern"] },
  { contentType: "item", label: "Beltran Plate Helm stats",    question: "beltran plate helm stats and defense",         keywords: ["beltran plate"] },
  { contentType: "item", label: "Ancient Ring",                question: "where do I get the ancient ring",              keywords: ["ancient ring"] },
  { contentType: "item", label: "Witch's Earring",             question: "what does the witch's earring do",             keywords: ["witch"] },
  { contentType: "item", label: "Memory Fragment",             question: "where do I find memory fragments",             keywords: ["memory fragment"] },
  { contentType: "item", label: "Abyss Gear",                  question: "how do I get abyss gear",                     keywords: ["abyss gear", "abyss"] },
  { contentType: "item", label: "Palmer Pills",                question: "what do palmer pills do",                      keywords: ["palmer"] },
  { contentType: "item", label: "Bow early game",              question: "where can I find a good bow early game",       keywords: ["bow"] },
  { contentType: "item", label: "Darkbringer sword",           question: "where do I get the darkbringer sword",         keywords: ["darkbringer"] },
  { contentType: "item", label: "Necklace for combat",         question: "best necklace for combat",                     keywords: ["necklace"] },
  { contentType: "item", label: "Spire of Stars key",          question: "what does the key to the spire of the stars do", keywords: ["spire"] },
  { contentType: "item", label: "Bell locations",              question: "where are all the bell locations",             keywords: ["bell"] },

  // ── PUZZLE ──────────────────────────────────────────────────
  { contentType: "puzzle", label: "Ancient ruins puzzles",     question: "how do I solve ancient ruins puzzles",         keywords: ["ancient ruins", "puzzle"] },
  { contentType: "puzzle", label: "Strongbox puzzle",          question: "how do I solve the strongbox puzzle",          keywords: ["strongbox"] },
  { contentType: "puzzle", label: "Disc puzzle mechanics",     question: "how do disc puzzles work",                     keywords: ["disc"] },
  { contentType: "puzzle", label: "Sealed gate",               question: "how do I open the ancient sealed gate",        keywords: ["sealed gate", "gate"] },
  { contentType: "puzzle", label: "Spire puzzle",              question: "how do I solve the spire puzzle",              keywords: ["spire"] },
  { contentType: "puzzle", label: "Maze puzzle",               question: "how do I solve the maze puzzle",               keywords: ["maze"] },
  { contentType: "puzzle", label: "Sanctum puzzle",            question: "how do I complete the sanctum puzzle",         keywords: ["sanctum"] },
  { contentType: "puzzle", label: "Abyss abilities for puzzles", question: "what abyss abilities do I need for puzzles", keywords: ["abyss", "ability", "puzzle"] },
  { contentType: "puzzle", label: "Ruins switch order",        question: "what is the switch order in the ruins puzzle", keywords: ["switch", "ruins"] },
  { contentType: "puzzle", label: "Rift puzzle",               question: "how do I solve the rift puzzle",               keywords: ["rift"] },

  // ── MECHANIC ────────────────────────────────────────────────
  { contentType: "mechanic", label: "Grapple in boss fights",   question: "how does grappling work in boss fights",      keywords: ["grapple", "grappling"] },
  { contentType: "mechanic", label: "Observe skill unlock",     question: "how do I unlock skills by observing",         keywords: ["observe", "observation"] },
  { contentType: "mechanic", label: "Weapon upgrade refining",  question: "how do I upgrade weapons using refining",     keywords: ["refin", "upgrade", "weapon"] },
  { contentType: "mechanic", label: "Death penalty",            question: "what happens when I die in crimson desert",   keywords: ["death", "die", "penalty", "respawn"] },
  { contentType: "mechanic", label: "Stamina in combat",        question: "how important is stamina in combat",          keywords: ["stamina"] },
  { contentType: "mechanic", label: "Abyss Nexus fast travel",  question: "how does the abyss nexus fast travel work",   keywords: ["abyss nexus", "nexus", "fast travel"] },
  { contentType: "mechanic", label: "Focused Shot skill",       question: "what does the focused shot skill do",         keywords: ["focused shot"] },
  { contentType: "mechanic", label: "Force Current skill",      question: "what does the force current skill do",        keywords: ["force current"] },
  { contentType: "mechanic", label: "Crafting recipes",         question: "how does crafting work",                      keywords: ["craft"] },
  { contentType: "mechanic", label: "Nature's Grasp skill",     question: "what does nature's grasp do in combat",       keywords: ["nature", "grasp"] },

  // ── QUEST ───────────────────────────────────────────────────
  { contentType: "quest", label: "Trial After Trial",       question: "how do I complete the trial after trial quest",  keywords: ["trial after trial"] },
  { contentType: "quest", label: "Contradiction quest",     question: "what are the answers for the contradiction quest", keywords: ["contradiction"] },
  { contentType: "quest", label: "Close Threat quest",      question: "close threat quest answers",                     keywords: ["close threat"] },
  { contentType: "quest", label: "Greymane Initiation",     question: "greymane initiation quest walkthrough",          keywords: ["greymane"] },
  { contentType: "quest", label: "NG+ unlock",              question: "how do I unlock new game plus",                  keywords: ["new game plus", "new game+", "ng+"] },

  // ── EXPLORATION ─────────────────────────────────────────────
  { contentType: "exploration", label: "Greymane Camp",         question: "how do I get to greymane camp",               keywords: ["greymane camp"] },
  { contentType: "exploration", label: "Five-Finger Mountain",  question: "how do I get to five-finger mountain",        keywords: ["five-finger", "five finger"] },
  { contentType: "exploration", label: "Hernand town",          question: "where is hernand and what can I do there",    keywords: ["hernand"] },
  { contentType: "exploration", label: "Pailune region",        question: "where is pailune located",                    keywords: ["pailune"] },
  { contentType: "exploration", label: "Abyss Nexus location",  question: "what can I find in the abyss nexus",          keywords: ["abyss nexus", "nexus"] },

  // ── CHARACTER ───────────────────────────────────────────────
  { contentType: "character", label: "Kliff lore",          question: "who is kliff",                                   keywords: ["kliff"] },
  { contentType: "character", label: "Damiane lore",        question: "who is damiane",                                 keywords: ["damiane"] },
  { contentType: "character", label: "Merchant locations",  question: "where can I find vendors or merchants",          keywords: ["merchant", "vendor"] },
];

// ───────────────────────── PARAM GRID ─────────────────────────
const THRESHOLDS = [0.10, 0.20, 0.25, 0.30, 0.40];
const COUNTS     = [8, 12, 16, 20, 25];

// ───────────────────────── VOYAGE EMBEDDING ─────────────────────────
async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3.5-lite", input: [text], input_type: "query" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data[0].embedding;
  } catch { return null; }
}

// ───────────────────────── RETRIEVAL ─────────────────────────
async function retrieve(
  embedding: number[],
  contentType: string,
  threshold: number,
  count: number,
): Promise<string> {
  const { data } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: count,
    content_type_filter: contentType,
  });
  return ((data || []) as { content: string }[]).map((r) => r.content).join("\n").toLowerCase();
}

// ───────────────────────── HELPERS ─────────────────────────
function hits(combined: string, keywords: string[]): boolean {
  return keywords.some((kw) => combined.includes(kw.toLowerCase()));
}

function pct(pass: number, total: number): string {
  return total === 0 ? " N/A" : `${Math.round((pass / total) * 100)}%`.padStart(4);
}

function bar(pass: number, total: number, width = 20): string {
  const ratio = total === 0 ? 0 : pass / total;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ───────────────────────── MAIN ─────────────────────────
async function main() {
  if (!VOYAGE_KEY) { console.error("FATAL: VOYAGE_API_KEY not set."); process.exit(1); }

  const allTypes = [...new Set(CASES.map((c) => c.contentType))];
  const types = filterType ? [filterType] : allTypes;

  console.log("\n" + "═".repeat(70));
  console.log("  Retrieval Sensitivity Sweep — by Content Type");
  console.log("  Params: threshold ∈ " + JSON.stringify(THRESHOLDS) + "  count ∈ " + JSON.stringify(COUNTS));
  console.log("═".repeat(70) + "\n");

  // ── Step 1: embed all questions for the selected types (once) ──
  const selectedCases = CASES.filter((c) => types.includes(c.contentType));
  const embCache: Map<string, number[] | null> = new Map();

  console.log(`Generating ${selectedCases.length} embeddings...`);
  for (let i = 0; i < selectedCases.length; i++) {
    const q = selectedCases[i].question;
    if (!embCache.has(q)) {
      process.stdout.write(`  [${i + 1}/${selectedCases.length}] ${q.substring(0, 55)}...`);
      const emb = await embed(q);
      embCache.set(q, emb);
      console.log(emb ? " ✓" : " ✗ FAILED");
      await new Promise((r) => setTimeout(r, 120)); // Voyage rate limit breathing room
    }
  }
  console.log();

  // ── Step 2: Sweep per content type ──
  interface BestResult {
    threshold: number;
    count: number;
    pass: number;
    total: number;
    failures: string[];
  }

  const summary: Array<{ type: string; best: BestResult; baseline: BestResult; grid: number[][] }> = [];

  for (const type of types) {
    const cases = CASES.filter((c) => c.contentType === type);
    if (cases.length === 0) { console.log(`  [${type}] — no test cases, skipping\n`); continue; }

    console.log(`\n${"─".repeat(70)}`);
    console.log(`  ${type.toUpperCase()}  (${cases.length} test cases)`);
    console.log(`${"─".repeat(70)}`);
    console.log(`  threshold\\count  ${COUNTS.map((c) => String(c).padStart(5)).join("")}   ← pass count`);

    let best: BestResult = { threshold: THRESHOLDS[0], count: COUNTS[0], pass: -1, total: cases.length, failures: [] };
    let baseline: BestResult | null = null;

    // Grid rows indexed by threshold, columns by count
    const grid: number[][] = [];

    for (const threshold of THRESHOLDS) {
      const row: number[] = [];
      for (const count of COUNTS) {
        let pass = 0;
        const failures: string[] = [];

        for (const tc of cases) {
          const emb = embCache.get(tc.question);
          if (!emb) { failures.push(tc.label + " (no embedding)"); continue; }

          const combined = await retrieve(emb, type, threshold, count);
          const passed = hits(combined, tc.keywords);
          if (passed) pass++;
          else failures.push(tc.label);

          await new Promise((r) => setTimeout(r, 50)); // light throttle
        }

        row.push(pass);

        // Track baseline (closest to current prod params: threshold=0.25, count=16)
        if (threshold === 0.25 && count === 16) {
          baseline = { threshold, count, pass, total: cases.length, failures: [...failures] };
        }

        // Track best
        if (pass > best.pass) {
          best = { threshold, count, pass, total: cases.length, failures: [...failures] };
        }
      }

      grid.push(row);
      const rowLabel = `  ${String(threshold).padEnd(5)}           `;
      console.log(rowLabel + row.map((v) => String(v).padStart(5)).join(""));
    }

    // Print best / baseline comparison
    const bl = baseline ?? { threshold: 0.25, count: 16, pass: 0, total: cases.length, failures: cases.map((c) => c.label) };
    console.log();
    console.log(`  Baseline (0.25 / 16): ${bl.pass}/${cases.length} ${pct(bl.pass, cases.length)}  ${bar(bl.pass, cases.length, 16)}`);
    console.log(`  Best     (${best.threshold} / ${best.count}): ${best.pass}/${cases.length} ${pct(best.pass, cases.length)}  ${bar(best.pass, cases.length, 16)}`);

    if (best.failures.length > 0 && verbose) {
      console.log(`  Remaining failures at best params:`);
      for (const f of best.failures) console.log(`    ↳ ${f}`);
    }

    summary.push({ type, best, baseline: bl, grid });
  }

  // ── Step 3: Overall recommendation table ──
  console.log("\n\n" + "═".repeat(70));
  console.log("  OPTIMAL PARAMS SUMMARY");
  console.log("═".repeat(70));
  console.log(`  ${"Type".padEnd(13)} ${"Baseline".padStart(9)} ${"Best".padStart(6)}  ${"Gain".padStart(5)}  Recommended`);
  console.log(`  ${"─".repeat(13)} ${"─".repeat(9)} ${"─".repeat(6)}  ${"─".repeat(5)}  ${"─".repeat(20)}`);

  for (const { type, best, baseline } of summary) {
    const baseStr = `${baseline.pass}/${baseline.total} ${pct(baseline.pass, baseline.total)}`;
    const bestStr = `${best.pass}/${best.total} ${pct(best.pass, best.total)}`;
    const gain = best.pass - baseline.pass;
    const gainStr = gain > 0 ? `+${gain}` : gain === 0 ? "=" : `${gain}`;
    const rec = `threshold=${best.threshold}, count=${best.count}`;
    console.log(`  ${type.padEnd(13)} ${baseStr.padStart(9)} ${bestStr.padStart(6)}  ${gainStr.padStart(5)}  ${rec}`);
  }

  console.log("\n  Current prod:  threshold=0.25, count=matchCount+10 (16 nudge / 18 full)");
  console.log("═".repeat(70) + "\n");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
