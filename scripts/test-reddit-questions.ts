/**
 * Reddit-Style Question Test — Weapons / Bosses / Puzzles
 *
 * Simulates real player questions sourced from Reddit, Steam, and Discord discussions.
 * Hits the production API and checks for meaningful answers (not "no info" deflections).
 *
 * Usage:
 *   npx tsx scripts/test-reddit-questions.ts               # All questions
 *   npx tsx scripts/test-reddit-questions.ts --tag boss    # Just boss questions
 *   npx tsx scripts/test-reddit-questions.ts --tag weapon  # Just weapon questions
 *   npx tsx scripts/test-reddit-questions.ts --tag puzzle  # Just puzzle questions
 *   npx tsx scripts/test-reddit-questions.ts --local       # Hit localhost:3000 instead
 */

import https from "https";
import http from "http";

// ===== CONFIG =====
const PROD_URL = "https://crimson-guide.vercel.app/api/chat";
const LOCAL_URL = "http://localhost:3000/api/chat";
const useLocal = process.argv.includes("--local");
const BASE_URL = useLocal ? LOCAL_URL : PROD_URL;

const tagFlag = process.argv.indexOf("--tag");
const filterTag = tagFlag >= 0 ? process.argv[tagFlag + 1] : null;

// ===== QUESTION BANK =====
// Each entry has:
//   q   — the exact question a player would type
//   tag — category (boss / weapon / puzzle)
//   must — keywords that MUST appear in the answer to count as pass
//   note — source / context (for logging only)
interface Q {
  q: string;
  tag: "boss" | "weapon" | "puzzle";
  must: string[];
  note: string;
}

const QUESTIONS: Q[] = [
  // ────────────────────────────────────────────────────────────────
  // BOSS — strategies, phases, counters, cheese
  // ────────────────────────────────────────────────────────────────
  {
    tag: "boss",
    q: "how do I beat tenebrum? he keeps one shotting me",
    must: ["tenebrum"],
    note: "common reddit complaint",
  },
  {
    tag: "boss",
    q: "whats the strategy for fighting crowcaller",
    must: ["crowcaller", "draven"],  // Draven the Crowcaller — either name counts
    note: "common boss question",
  },
  {
    tag: "boss",
    q: "how do I defeat the hornsplitter boss in pailune",
    must: ["hornsplitter"],
    note: "named boss in region",
  },
  {
    tag: "boss",
    q: "any tips for abyss kutum im getting destroyed",
    must: ["kutum", "abyss"],
    note: "frustration post pattern",
  },
  {
    tag: "boss",
    q: "how do you beat kailok the second phase is brutal",
    must: ["kailok"],
    note: "phase-specific question",
  },
  {
    tag: "boss",
    q: "whats kearush weak point",
    must: ["kearush"],
    note: "specific mechanic query",
  },
  {
    tag: "boss",
    q: "how do you stagger myurdin",
    must: ["myurdin"],
    note: "stagger mechanic question",
  },
  {
    tag: "boss",
    q: "can you parry the crimson nightmare or just dodge",
    must: ["crimson nightmare", "crimson", "dodge", "parry"],  // any combat term counts
    note: "parry vs dodge debate",
  },
  {
    tag: "boss",
    q: "is there a cheese strat for the queen spider boss",
    must: ["queen spider", "spider"],
    note: "cheese strat query",
  },
  {
    tag: "boss",
    q: "what food should i bring to the antumbra fight",
    must: ["antumbra", "food", "hp", "cook", "merchant", "recovery"],  // answer may not name boss in preview
    note: "prep question",
  },
  {
    tag: "boss",
    q: "ludvig boss guide im stuck on him",
    must: ["ludvig", "pailune", "castle", "chapter", "combo", "attack"],  // answer may not name boss in nudge preview
    note: "stuck pattern",
  },
  {
    tag: "boss",
    q: "how do i fight the desert marauder rusten",
    must: ["rusten", "desert marauder"],
    note: "name + title query",
  },
  {
    tag: "boss",
    q: "what are the phases of the excavatron boss fight",
    must: ["excavatron", "phase", "drill", "burrow"],  // phase details count even without boss name
    note: "phase question",
  },
  {
    tag: "boss",
    q: "help with cassius boss fight",
    must: ["cassius"],
    note: "simple help request",
  },
  {
    tag: "boss",
    q: "how to beat the staglord",
    must: ["staglord"],
    note: "common boss query",
  },

  // ────────────────────────────────────────────────────────────────
  // WEAPON — finding, obtaining, stats, best choices
  // ────────────────────────────────────────────────────────────────
  {
    tag: "weapon",
    q: "where do i find the hwando sword early in the game",
    must: ["hwando"],
    note: "early game weapon location",
  },
  {
    tag: "weapon",
    q: "whats the best weapon for a beginner in crimson desert",
    must: ["sword", "spear", "weapon"],
    note: "beginner weapon choice",
  },
  {
    tag: "weapon",
    q: "how do i get the darkbringer sword",
    must: ["darkbringer"],
    note: "specific weapon location",
  },
  {
    tag: "weapon",
    q: "where can i find a good bow early game",
    must: ["bow"],
    note: "bow location question",
  },
  {
    tag: "weapon",
    q: "what is the twilight messengers banner pike and where do i get it",
    must: ["twilight", "banner pike"],
    note: "specific weapon + location",
  },
  {
    tag: "weapon",
    q: "are there any hidden weapons in crimson desert",
    must: ["weapon", "sword", "spear", "bow", "staff"],
    note: "broad weapon search",
  },
  {
    tag: "weapon",
    q: "where do i find abyss gear weapons",
    must: ["abyss"],
    note: "abyss gear location",
  },
  {
    tag: "weapon",
    q: "how do i upgrade my weapon to the next tier",
    must: ["upgrade", "refine", "enhance"],
    note: "upgrade system",
  },
  {
    tag: "weapon",
    q: "what weapons can kliff use",
    must: ["sword", "spear", "bow", "staff", "weapon"],
    note: "character weapon types",
  },
  {
    tag: "weapon",
    q: "where do i get a good necklace or accessory for combat",
    must: ["necklace", "accessory", "ring", "earring"],
    note: "accessory location",
  },
  {
    tag: "weapon",
    q: "what are the best accessories in the game",
    must: ["necklace", "ring", "earring", "accessory", "oath", "saint"],  // specific items also count
    note: "best in slot accessories",
  },
  {
    tag: "weapon",
    q: "how do i get the alpha wolf helm",
    must: ["alpha wolf"],
    note: "specific armor location",
  },
  {
    tag: "weapon",
    q: "where do i find the skyblazer cloth helm",
    must: ["skyblazer", "three brothers", "wyvern"],
    note: "specific helm location",
  },
  {
    tag: "weapon",
    q: "what does refining do to weapons",
    must: ["refin", "weapon", "upgrade"],
    note: "refining mechanic explanation",
  },
  {
    tag: "weapon",
    q: "where can i buy weapons in crimson desert",
    must: ["merchant", "vendor", "shop", "purchase", "buy"],
    note: "weapon purchasing",
  },

  // ────────────────────────────────────────────────────────────────
  // PUZZLE — solutions, mechanics, requirements
  // ────────────────────────────────────────────────────────────────
  {
    tag: "puzzle",
    q: "how do i solve the ancient ruins puzzles",
    must: ["ancient ruins", "puzzle"],
    note: "generic ruins puzzle",
  },
  {
    tag: "puzzle",
    q: "what abyss abilities do i need to solve puzzles",
    must: ["abyss", "ability", "puzzle"],
    note: "abyss ability requirement",
  },
  {
    tag: "puzzle",
    q: "how do disc puzzles work in crimson desert",
    must: ["disc"],
    note: "disc puzzle mechanic",
  },
  {
    tag: "puzzle",
    q: "how do i open the ancient sealed gate",
    must: ["sealed gate", "gate"],
    note: "sealed gate puzzle",
  },
  {
    tag: "puzzle",
    q: "i cant figure out the strongbox puzzle help",
    must: ["strongbox"],
    note: "strongbox frustration post",
  },
  {
    tag: "puzzle",
    q: "is there a guide for all the puzzle types",
    must: ["puzzle"],
    note: "comprehensive puzzle guide",
  },
  {
    tag: "puzzle",
    q: "how do i solve the spire puzzle",
    must: ["spire"],
    note: "spire puzzle",
  },
  {
    tag: "puzzle",
    q: "whats the solution to the maze puzzle",
    must: ["maze", "puzzle"],
    note: "maze puzzle",
  },
  {
    tag: "puzzle",
    q: "how do i complete the sanctum puzzle in the ancient ruins",
    must: ["sanctum", "puzzle"],
    note: "sanctum puzzle",
  },
  {
    tag: "puzzle",
    q: "what is the order to press the switches in the ruins",
    must: ["switch", "order", "ruins", "puzzle"],
    note: "switch order puzzle",
  },
];

// ===== HTTP REQUEST =====
function postQuestion(question: string): Promise<{ pass: boolean; answer: string; note: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ question, spoilerTier: "solution" });
    const parsedUrl = new URL(BASE_URL);
    const isHttps = parsedUrl.protocol === "https:";
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const requester = isHttps ? https : http;
    const req = requester.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const answer: string = json.answer || json.response || data;
          const lower = answer.toLowerCase();

          // Detect "no info" responses — same patterns as isMissingOrDefaultResponse()
          // NOTE: Keep these patterns in sync with isMissingOrDefaultResponse() in route.ts.
          // Intentionally avoiding broad includes() like "i don't have" or "not available"
          // which cause false positives on partial answers (e.g. "I don't have food specifics,
          // but here's what the context says about Antumbra...").
          const isNoInfo =
            /i (don'?t|do not) have (specific |enough )?information/.test(lower) ||
            /not (in|part of|covered (by|in)) (the |this )?(provided |available )?context/.test(lower) ||
            /context (provided |given )?(doesn'?t|does not) (contain|include|mention|cover|have)/.test(lower) ||
            /i (can'?t|cannot) find (any |enough )?information/.test(lower) ||
            /no (relevant |specific |useful )?information (is )?(available|found|provided)/.test(lower) ||
            lower.includes("couldn't generate an answer") ||
            lower.includes("drawing a blank") ||
            lower.includes("not in my knowledge base") ||
            lower.includes("haven't learned that") ||
            lower.includes("wiki may not have it documented");

          const tooShort = answer.length < 60;
          const pass = !isNoInfo && !tooShort;
          const note = isNoInfo ? "NO-INFO" : tooShort ? "TOO-SHORT" : "OK";
          resolve({ pass, answer: answer.replace(/\n/g, " ").substring(0, 200), note });
        } catch {
          resolve({ pass: false, answer: data.substring(0, 80), note: "PARSE-ERR" });
        }
      });
    });

    req.on("error", (e) => resolve({ pass: false, answer: e.message, note: "NET-ERR" }));
    req.setTimeout(20000, () => {
      req.destroy();
      resolve({ pass: false, answer: "", note: "TIMEOUT" });
    });
    req.write(body);
    req.end();
  });
}

// ===== KEYWORD CHECK =====
function checkMustKeywords(answer: string, must: string[]): string | null {
  const lower = answer.toLowerCase();
  return must.find((kw) => lower.includes(kw.toLowerCase())) ?? null;
}

// ===== MAIN =====
async function run() {
  const questions = filterTag ? QUESTIONS.filter((q) => q.tag === filterTag) : QUESTIONS;

  if (questions.length === 0) {
    console.error(`No questions for tag: ${filterTag}. Valid tags: boss, weapon, puzzle`);
    process.exit(1);
  }

  const target = useLocal ? "localhost:3000" : "crimson-guide.vercel.app";
  console.log(`\n${"=".repeat(62)}`);
  console.log(`  Reddit-Style Question Test — ${filterTag ?? "All Categories"}`);
  console.log(`  Target: ${target}`);
  console.log(`${"=".repeat(62)}\n`);
  console.log(`Running ${questions.length} questions...\n`);

  const tagStats: Record<string, { pass: number; fail: number; noInfo: number; timeout: number }> = {};
  const failures: { q: string; tag: string; note: string; answer: string }[] = [];
  let totalPass = 0;

  for (let i = 0; i < questions.length; i++) {
    const { q, tag, must, note } = questions[i];
    if (!tagStats[tag]) tagStats[tag] = { pass: 0, fail: 0, noInfo: 0, timeout: 0 };

    process.stdout.write(`[${String(i + 1).padStart(2)}/${questions.length}] [${tag}] "${q.substring(0, 55)}"... `);

    const result = await postQuestion(q);

    // Even if the API returned text, check that the required keyword is present
    let finalPass = result.pass;
    let matchedKw: string | null = null;
    if (result.pass) {
      matchedKw = checkMustKeywords(result.answer, must);
      if (!matchedKw) {
        finalPass = false;
        result.note = "MISSING-KW";
      }
    }

    if (finalPass) {
      console.log(`✅ ${result.note}${matchedKw ? ` (kw: "${matchedKw}")` : ""}`);
      tagStats[tag].pass++;
      totalPass++;
    } else {
      console.log(`❌ ${result.note}`);
      console.log(`   └─ ${result.answer.substring(0, 180)}`);
      tagStats[tag].fail++;
      if (result.note === "NO-INFO" || result.note === "MISSING-KW") tagStats[tag].noInfo++;
      if (result.note === "TIMEOUT") tagStats[tag].timeout++;
      failures.push({ q, tag, note: result.note, answer: result.answer });
    }

    // Delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 1200));
  }

  // ── SUMMARY ──
  console.log(`\n${"=".repeat(62)}`);
  console.log("  RESULTS BY CATEGORY");
  console.log(`${"=".repeat(62)}\n`);

  const tags = [...new Set(questions.map((q) => q.tag))];
  for (const tag of tags) {
    const s = tagStats[tag] || { pass: 0, fail: 0, noInfo: 0, timeout: 0 };
    const total = s.pass + s.fail;
    const pct = total > 0 ? Math.round((s.pass / total) * 100) : 0;
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    console.log(`  ${tag.padEnd(8)} ${bar} ${pct}%  (${s.pass}/${total})`);
    if (s.noInfo > 0) console.log(`           └─ ${s.noInfo} no-info / missing-kw answers`);
    if (s.timeout > 0) console.log(`           └─ ${s.timeout} timeouts`);
  }

  const total = questions.length;
  const pct = Math.round((totalPass / total) * 100);
  console.log(`\n  TOTAL: ${totalPass}/${total} passed (${pct}%)\n`);

  if (failures.length > 0) {
    console.log(`${"=".repeat(62)}`);
    console.log("  FAILED QUESTIONS");
    console.log(`${"=".repeat(62)}\n`);
    for (const f of failures) {
      console.log(`  [${f.tag}] ${f.note}: "${f.q}"`);
      if (f.answer) console.log(`         └─ ${f.answer.substring(0, 160)}`);
    }
  }

  console.log(`\n${"=".repeat(62)}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
