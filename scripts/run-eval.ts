/**
 * Retrieval Eval Harness
 *
 * Loads rows from retrieval_eval, runs each query through the full retrieval
 * pipeline (embed → vector search → keyword boost → rerank), then computes
 * Recall@10 and MRR against the expected_chunk_ids ground truth.
 *
 * This is intentionally read-only: it does NOT call Claude and does NOT write
 * to the queries or retrieval_debug tables.
 *
 * Usage:
 *   npx tsx scripts/run-eval.ts
 *   npx tsx scripts/run-eval.ts --no-filter   # ignore classifier, full search only
 *   npx tsx scripts/run-eval.ts --k=5         # recall@5 instead of @10
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Config ───────────────────────────────────────────────────────────────────
const K = parseInt(process.argv.find(a => a.startsWith("--k="))?.split("=")[1] ?? "10");
const NO_FILTER = process.argv.includes("--no-filter");

// ── Env loading (mirrors route.ts approach) ──────────────────────────────────
function loadEnv(): Record<string, string> {
  try {
    const envPath = path.join(__dirname, "..", ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    content.split("\n").forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch { return {}; }
}

const env = loadEnv();
const SUPABASE_URL     = env.NEXT_PUBLIC_SUPABASE_URL    || process.env.NEXT_PUBLIC_SUPABASE_URL    || "";
const SUPABASE_KEY     = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const VOYAGE_API_KEY   = env.VOYAGE_API_KEY              || process.env.VOYAGE_API_KEY              || "";

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing SUPABASE env vars"); process.exit(1); }
if (!VOYAGE_API_KEY)                { console.error("Missing VOYAGE_API_KEY");     process.exit(1); }

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Types ────────────────────────────────────────────────────────────────────
interface EvalRow {
  id: string;
  query: string;
  expected_chunk_ids: string[];
  notes: string | null;
}

interface Chunk {
  id: string;
  content: string;
  source_url: string;
  source_type: string;
  quest_name: string | null;
  content_type: string;
  similarity: number;
  keywordBoost?: boolean;
  termHits?: number;
}

interface EvalResult {
  query: string;
  classifier: string | null;
  fallback: boolean;
  totalCandidates: number;
  top10ids: string[];
  expectedIds: string[];
  recallAtK: number;
  rr: number; // reciprocal rank (0 if not found)
  topSimilarity: number;
  notes: string | null;
}

// ── Classifier (copy of classifyContentType from route.ts) ───────────────────
function classifyContentType(question: string): string | null {
  if (NO_FILTER) return null;
  const q = question.toLowerCase();

  if (/\b(best build|optimal build|build for|builds for|what.*build|recommended build|endgame build)\b/.test(q)) return null;
  if (/\b(best (weapon|gear|armor|accessory|accessories|item|equipment) for (a ?)?(beginner|new player|early|starter)|starter (weapon|gear)|beginner (weapon|gear))\b/.test(q)) return null;
  if (/\b(what (weapons?|abilities|skills|classes|weapon types?) (can|does|do) \w+ use|what (weapons?|weapon types?) (are|is) (available|in the game))\b/.test(q)) return null;
  if (/\b(vs\.?|versus)\b|better than\b|compare.{0,30}(weapon|armor|skill|class)|(sword|spear|bow|axe|staff|dagger|ring|necklace|earring|armor|armour)\s+(or|vs)\s+\w|\bor\b.{0,30}\b(which (is |one )?(better|stronger|best|worse|worse))|which (is|one) (better|stronger|best)/.test(q)) return null;
  if (/\b(food (buff|bonus|effect|for|before|during|guide)|best food (for|to eat|before)|what (food|meal) (should|to|is good)|elixir (effect|buff|guide)|buff food|combat food|healing food|consumable (guide|tips?|buff|strategy)|what (to eat|should i eat|food (to use|gives))|food (that (gives|boosts?|increases?)|for (combat|fighting|bosses?|dungeons?)))\b/.test(q)) return null;

  // Session 26: bossNames extended with Phase 1c retags (corpus content_type='boss').
  const bossNames = ["kailok","hornsplitter","ludvig","gregor","fortain","gabriel","lucian","bastier","walter","lanford","master du","antumbra","crimson warden","crimson nightmare","hexe marie","trukan","saigord","staglord","saigord the staglord","reed devil","blinding flash","grave walker","icewalker","white horn","stoneback crab","queen stoneback crab","taming dragon","tenebrum","crowcaller","draven","cassius","kearush","myurdin","excavatron","priscus","muskan","cubewalker","lithus","black fang","hemon","beindel","gwen kraber","white bearclaw","queen spider","crookrock","desert marauder","rusten","abyss kutum","kutum","goyen","matthias","white bear","t'rukan","lava myurdin","ator","ator archon","marni's clockwork mantis","marni's excavatron","awakened lucian bastier","awakened ludvig","one armed ludvig","new moon reaper","full moon reaper","half moon reaper","beloth the darksworn","dreadnought","thunder tank","turbine","pororin forest guardians","fundamentalist goblins","golden star"];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";

  if (/\b(puzzles?|strongbox|ancient ruins|sealed gate|disc puzzle|spire.{0,15}puzzle|sanctum.{0,15}puzzle|maze.{0,15}puzzle|ruins.{0,15}puzzle|how (do i|to) solve|puzzle solution)\b/.test(q)) return "puzzle";
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge|cook|cooking)\b/.test(q)) return "recipe";
  if (/\b(new game\+?|ng\+|post.?game|after (beating|finishing|completing) the (game|story|main quest)|endgame (content|guide|tips?|activities?)|what (to do|is there) after (the )?(game|story|ending)|end game content|postgame|game\+)\b/.test(q)) return "mechanic";
  if (/\b(camp (management|system|upgrade|level|buildings?|feature|guide|expand|expansion)|greymane camp (guide|upgrade|system|how|expand)|faction (system|reputation|rank|guide|how)|how (do i|to) (upgrade|level up|build up|improve|expand|grow|develop) (my |the )?camp|base (building|management|upgrade|system)|camp (resources?|workers?|npc|unlock)|expand(ing)? (the |my |greymane )?camp|how (big|large) (can|does) (the |my )?camp (get|become|grow))\b/.test(q)) return "mechanic";
  if (/\b(mount(s)? (system|guide|tips?|unlock|how|work)|how (do i|to|do) (get|obtain|unlock|tame|ride|use) (a |the )?(mount|horse|pet|steed)|how do(es)? (mounts?|horses?|pets?) work|pet (system|guide|combat|unlock|how)|horse (guide|system|tips?|riding|unlock|taming)|riding (system|guide|tips?)|best (mount|horse|pet)\b)\b/.test(q)) return "mechanic";

  // Session 26 reorder: EXPLORATION → RECOMMENDATION → ITEM → SKILL/MECHANIC.
  // EXPLORATION moved up so "where is the Sanctum of Temperance?" routes to exploration,
  // not item via getItemPhrases' (now-removed) `where (is|are) the` pattern.
  if (/\b(where is|how do i get to|how to reach|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|tower|temple|crypt|catacomb|sanctum|sanctorum|ranch|gate|basin|falls|grotto|ridge|beacon|ancient ruins$|ancient ruin$)\b/.test(q)) return "exploration";

  if (/\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|what.{0,20}(good for|best for|work(s)? (well|good))|is .{3,30} (any )?good\b|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)) return null;
  if (/\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q)) return null;

  // ITEM moved ABOVE mechanic (session 26): "artifact" added to itemKeywords so Faded Abyss Artifact
  // routes to item (post-1c content_type) before mechanic's `abyss artifact`+`how does .+ work` patterns fire.
  // `where (is|are) the` removed from getItemPhrases (now in EXPLORATION above).
  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|equipment|item|artifact|drop|loot|reward|obtain|enhance)\b/;
  const getItemPhrases = /\b(where (do i|can i) (find|get|buy|farm|obtain)|how (do i|to) (acquire|obtain|get|find)|where to (find|get|buy|obtain)|how to get)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return "item";

  if (/\b(skill|ability|talent|passive|active|skill tree|mechanic|system|stamina|stat|attribute|combo|aerial|grapple|grappling|observation|abyss artifact|challenge|challenges|mastery|minigame|mini-game|fast travel|fast-travel|travel point|abyss nexus|traces of the abyss|how does the .+ work|how does .+ work|what does .+ do|refinement|refine|upgrade equipment|how to upgrade|how to heal|healing|potion|consumable|critical rate|critical chance)\b/.test(q)) return "mechanic";

  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";
  if (/\b(who is|who are|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane|matthias|shakatu|myurdin|naira|yann|grundir)\b/.test(q)) return "character";

  return null;
}

// ── Voyage embedding ─────────────────────────────────────────────────────────
function embedQuery(question: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "voyage-3.5-lite", input: [question], input_type: "query" });
    const req = https.request(
      { hostname: "api.voyageai.com", path: "/v1/embeddings", method: "POST",
        headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try { resolve(JSON.parse(data).data?.[0]?.embedding ?? []); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Retrieve: mirrors the pipeline in route.ts ────────────────────────────────
async function retrieve(question: string, topK: number): Promise<{
  chunks: Chunk[];
  preSliceChunks: Chunk[];
  classifier: string | null;
  fallback: boolean;
}> {
  const contentTypeFilter = classifyContentType(question);
  const effectiveMatchCount = topK;
  let fallback = false;

  // ── Voyage embedding ──────────────────────────────────────────────────────
  const queryEmbedding = await embedQuery(question);

  // ── Vector search ─────────────────────────────────────────────────────────
  const rpcParams: Record<string, unknown> = {
    query_embedding: queryEmbedding,
    match_threshold: 0.25,
    match_count: effectiveMatchCount + 10,
  };
  if (contentTypeFilter) rpcParams.content_type_filter = contentTypeFilter;

  let { data: vectorData } = await supabase.rpc("match_knowledge_chunks", rpcParams) as { data: Chunk[] | null };

  if ((!vectorData || vectorData.length === 0) && contentTypeFilter) {
    fallback = true;
    const { data: unfilteredData } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: effectiveMatchCount + 4,
    }) as { data: Chunk[] | null };
    vectorData = unfilteredData;
  }

  let chunks: Chunk[] = vectorData || [];

  // ── Keyword boost (mirrors route.ts logic) ────────────────────────────────
  const boostStopWords = new Set(["how","what","where","when","why","who","which","does","the","and","for","are","but","not","you","this","that","with","have","from","they","will","just","than","then","here","some","there","about","into","can","could","would","should","did","find","get","give","buy","farm","craft","make","locate","obtain","show","tell","use","equip","upgrade","unlock"]);
  const boostKeywords = question.replace(/[^a-zA-Z0-9\s'-]/g, "").split(/\s+/)
    .filter((w) => w.length > 3 && !boostStopWords.has(w.toLowerCase())).slice(0, 6);
  const quotedNames: string[] = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
  const cleanedForPhrase = question
    .replace(/^(how (to do|to get|to reach|to complete|to find|to unlock|to|do i|does|can i)|where (is|can i find|do i find)|what (is|are|does)|who is|when is|tell me about|explain)\s+/i, "")
    .replace(/^(find|locate|get|buy|farm|obtain|craft|make|use|equip|upgrade|unlock|show|tell|give)\s+/i, "")
    .replace(/^(the|a|an|do|my)\s+/i, "")
    .replace(/\s+(challenge|challenges|quest|mission|boss|fight|item|skill|location|area|region|guide|help|tips?|strategy|strategies|ruins?|dungeon)s?\s*$/i, "").trim();
  if (cleanedForPhrase.split(/\s+/).length >= 2 && !quotedNames.some((n) => n.toLowerCase() === cleanedForPhrase.toLowerCase())) {
    quotedNames.push(cleanedForPhrase);
  }
  const allBoostTerms = [...new Set([...boostKeywords, ...quotedNames])];

  if (allBoostTerms.length > 0) {
    const multiWordUrlTerms = allBoostTerms.filter((t) => t.includes(" ")).map((t) => t.replace(/\s+/g, "+"));
    const singleWordUrlTerms = allBoostTerms.filter((t) => !t.includes(" ") && t.length >= 7);
    const urlTerms = multiWordUrlTerms.length > 0 ? multiWordUrlTerms : singleWordUrlTerms;

    let keywordChunks: Chunk[] = [];

    if (urlTerms.length > 0) {
      let urlQ: any = supabase.from("knowledge_chunks")
        .select("id, content, source_url, source_type, quest_name, content_type")
        .or(urlTerms.map((t) => `source_url.ilike.%${t}%`).join(","));
      if (contentTypeFilter) urlQ = urlQ.eq("content_type", contentTypeFilter);
      const { data: urlMatches } = await urlQ.limit(10);
      if (urlMatches) keywordChunks = urlMatches;
    }

    if (keywordChunks.length < 4) {
      let cQ: any = supabase.from("knowledge_chunks")
        .select("id, content, source_url, source_type, quest_name, content_type")
        .or(allBoostTerms.map((t) => `content.ilike.%${t}%`).join(","));
      if (contentTypeFilter) cQ = cQ.eq("content_type", contentTypeFilter);
      const { data: contentMatches } = await cQ.limit(8);
      if (contentMatches) {
        const existingKwIds = new Set(keywordChunks.map((c) => c.id));
        for (const c of contentMatches) { if (!existingKwIds.has(c.id)) keywordChunks.push(c); }
      }
    }

    if (keywordChunks.length > 0) {
      const existingIds = new Set(chunks.map((c) => c.id));
      const newKw = keywordChunks
        .filter((c) => !existingIds.has(c.id))
        .map((c) => {
          const isUrlMatch = urlTerms.some((t) => String(c.source_url || "").toLowerCase().includes(t.toLowerCase()));
          return { ...c, similarity: isUrlMatch ? 0.88 : 0.40, keywordBoost: true };
        });
      if (newKw.length > 0) chunks = [...chunks, ...newKw];
    }
  }

  // ── Reranker (mirrors route.ts logic) ─────────────────────────────────────
  if (chunks.length > 0) {
    const questionTerms = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const urlTermsForRerank = allBoostTerms.map((t) => t.replace(/\s+/g, "+").toLowerCase());
    chunks = chunks.map((c) => {
      const content = String(c.content || "").toLowerCase();
      const sourceUrl = String(c.source_url || "").toLowerCase();
      const contentStart = content.substring(0, 200);
      const termHits = questionTerms.filter((t) => content.includes(t)).length;
      const baseSim = Number(c.similarity || 0.3);
      let boost = Math.min(0.10, termHits * 0.02);
      if (urlTermsForRerank.some((t) => sourceUrl.includes(t))) boost += 0.08;
      const contentStartHits = urlTermsForRerank.filter((t) => contentStart.includes(t.replace(/\+/g, " "))).length;
      if (contentStartHits > 0) boost += Math.min(0.20, contentStartHits * 0.10);
      for (const pn of allBoostTerms) { if (content.includes(pn.toLowerCase())) boost += 0.04; }
      const isLocationQuery = /\b(where (do i|can i|to) (find|get|buy|farm|obtain)|how (do i|to) (get|obtain|acquire|find)|where is|location of|how to get|where to find|where to get)\b/.test(question.toLowerCase());
      if (isLocationQuery) {
        const locSigs = ["where to find","where to get","can be found","obtained from","merchant","boss drop","chest","located at","how to obtain","dropped by","found in","sold by","purchase from","reward from"];
        if (locSigs.some((sig) => content.includes(sig))) boost += 0.15;
      }
      return { ...c, similarity: baseSim + boost, termHits };
    }) as Chunk[];

    chunks.sort((a, b) => b.similarity - a.similarity);
  }

  const preSliceChunks = [...chunks];
  const finalChunks = chunks.slice(0, topK);

  return { chunks: finalChunks, preSliceChunks, classifier: contentTypeFilter, fallback };
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function recallAtK(retrieved: string[], expected: string[], k: number): number {
  if (expected.length === 0) return NaN;
  const topK = new Set(retrieved.slice(0, k));
  const hits = expected.filter((id) => topK.has(id)).length;
  return hits / expected.length;
}

function reciprocalRank(retrieved: string[], expected: string[]): number {
  if (expected.length === 0) return NaN;
  const expectedSet = new Set(expected);
  for (let i = 0; i < retrieved.length; i++) {
    if (expectedSet.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Retrieval Eval — Recall@${K} & MRR`);
  console.log(`  Mode: ${NO_FILTER ? "NO FILTER (full search)" : "classifier active"}`);
  console.log(`${"═".repeat(60)}\n`);

  // Load eval rows
  const { data: evalRows, error } = await supabase
    .from("retrieval_eval")
    .select("*")
    .order("created_at");

  if (error || !evalRows) { console.error("Failed to load retrieval_eval:", error); process.exit(1); }
  console.log(`Loaded ${evalRows.length} eval queries.\n`);

  const results: EvalResult[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const row of evalRows as EvalRow[]) {
    process.stdout.write(`  Running: "${row.query.substring(0, 55)}"... `);
    try {
      const { chunks, preSliceChunks, classifier, fallback } = await retrieve(row.query, K);
      const top10ids = chunks.map((c) => c.id);
      const r: EvalResult = {
        query: row.query,
        classifier,
        fallback,
        totalCandidates: preSliceChunks.length,
        top10ids,
        expectedIds: row.expected_chunk_ids,
        recallAtK: recallAtK(top10ids, row.expected_chunk_ids, K),
        rr: reciprocalRank(top10ids, row.expected_chunk_ids),
        topSimilarity: chunks[0]?.similarity ?? 0,
        notes: row.notes,
      };
      results.push(r);
      const recallStr = isNaN(r.recallAtK) ? "N/A" : `${(r.recallAtK * 100).toFixed(0)}%`;
      const rrStr     = isNaN(r.rr)        ? "N/A" : r.rr.toFixed(3);
      console.log(`Recall@${K}=${recallStr}  RR=${rrStr}  top_sim=${r.topSimilarity.toFixed(3)}`);
      await sleep(600); // polite Voyage rate-limit gap
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message}`);
    }
  }

  // ── Markdown table output ─────────────────────────────────────────────────
  const validRecall = results.filter((r) => !isNaN(r.recallAtK));
  const validMRR    = results.filter((r) => !isNaN(r.rr));
  const meanRecall  = validRecall.reduce((s, r) => s + r.recallAtK, 0) / (validRecall.length || 1);
  const meanMRR     = validMRR.reduce((s, r) => s + r.rr, 0) / (validMRR.length || 1);

  console.log(`\n${"═".repeat(60)}`);
  console.log("## Retrieval Eval Results\n");
  console.log(`| # | Query | Classifier | Fallback | Candidates | Recall@${K} | MRR | Top Sim |`);
  console.log(`|---|-------|-----------|----------|------------|------------|-----|---------|`);

  results.forEach((r, i) => {
    const q       = r.query.length > 40 ? r.query.substring(0, 37) + "..." : r.query;
    const cls     = r.classifier ?? "none";
    const fb      = r.fallback ? "⚠️ yes" : "no";
    const recall  = isNaN(r.recallAtK) ? "—" : `${(r.recallAtK * 100).toFixed(0)}%`;
    const rr      = isNaN(r.rr)        ? "—" : r.rr.toFixed(3);
    const topSim  = r.topSimilarity.toFixed(3);
    console.log(`| ${i + 1} | ${q} | \`${cls}\` | ${fb} | ${r.totalCandidates} | **${recall}** | ${rr} | ${topSim} |`);
  });

  console.log(`|   | **MEAN** | | | | **${(meanRecall * 100).toFixed(0)}%** | **${meanMRR.toFixed(3)}** | |`);

  // ── Per-query top-10 detail ───────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("## Per-Query Top-10 Detail\n");
  for (const r of results) {
    console.log(`### ${r.query}`);
    console.log(`Classifier: \`${r.classifier ?? "none"}\` | Fallback: ${r.fallback} | Candidates in pool: ${r.totalCandidates}\n`);
    console.log("| Rank | Chunk ID | Similarity | Expected? | Source URL (truncated) |");
    console.log("|------|----------|------------|-----------|------------------------|");
    const expSet = new Set(r.expectedIds);
    r.top10ids.forEach((id, i) => {
      // Find chunk details - we have the chunk objects from retrieve()
      const hit = expSet.has(id) ? "✅" : "❌";
      console.log(`| ${i + 1} | \`${id.substring(0, 8)}\` | — | ${hit} | (see DB) |`);
    });
    if (r.expectedIds.length > 0) {
      const missing = r.expectedIds.filter((id) => !r.top10ids.includes(id));
      if (missing.length > 0) {
        console.log(`\n⚠️  Missing expected: ${missing.map((id) => `\`${id.substring(0, 8)}\``).join(", ")}`);
      }
    }
    console.log();
  }

  console.log(`${"═".repeat(60)}`);
  console.log(`  Recall@${K}: ${(meanRecall * 100).toFixed(1)}%   MRR: ${meanMRR.toFixed(3)}`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch(console.error);
