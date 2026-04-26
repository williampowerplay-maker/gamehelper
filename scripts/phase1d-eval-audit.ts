// scripts/phase1d-eval-audit.ts
//
// Comprehensive eval audit: for each retrieval_eval query, run the retrieval
// pipeline and capture full top-10 chunk IDs + content + seed-match status.
// Output to phase1d-eval-audit-comprehensive.json for downstream CSV building.
//
// Read-only — no DB writes, no embedding writes.

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { writeFileSync } from "node:fs";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Env loading (mirrors run-eval.ts pattern) ────────────────────────────────
function loadEnv(): Record<string, string> {
  try {
    const envPath = path.join(__dirname, "..", ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    content.split("\n").forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    });
    return vars;
  } catch { return {}; }
}
const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const VOYAGE_API_KEY = env.VOYAGE_API_KEY || process.env.VOYAGE_API_KEY || "";
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing SUPABASE env"); process.exit(1); }
if (!VOYAGE_API_KEY) { console.error("Missing VOYAGE_API_KEY"); process.exit(1); }

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// ── Classifier (copy of classifyContentType from route.ts; must stay in sync) ──
function classifyContentType(question: string): string | null {
  const q = question.toLowerCase();

  if (/\b(best build|optimal build|build for|builds for|what.*build|recommended build|endgame build)\b/.test(q)) return null;
  if (/\b(best (weapon|gear|armor|accessory|accessories|item|equipment) for (a ?)?(beginner|new player|early|starter)|starter (weapon|gear)|beginner (weapon|gear))\b/.test(q)) return null;
  if (/\b(what (weapons?|abilities|skills|classes|weapon types?) (can|does|do) \w+ use|what (weapons?|weapon types?) (are|is) (available|in the game))\b/.test(q)) return null;
  if (/\b(vs\.?|versus)\b|better than\b|compare.{0,30}(weapon|armor|skill|class)|(sword|spear|bow|axe|staff|dagger|ring|necklace|earring|armor|armour)\s+(or|vs)\s+\w|\bor\b.{0,30}\b(which (is |one )?(better|stronger|best|worse|worse))|which (is|one) (better|stronger|best)/.test(q)) return null;
  if (/\b(food (buff|bonus|effect|for|before|during|guide)|best food (for|to eat|before)|what (food|meal) (should|to|is good)|elixir (effect|buff|guide)|buff food|combat food|healing food|consumable (guide|tips?|buff|strategy)|what (to eat|should i eat|food (to use|gives))|food (that (gives|boosts?|increases?)|for (combat|fighting|bosses?|dungeons?)))\b/.test(q)) return null;

  const bossNames = ["kailok","hornsplitter","ludvig","gregor","fortain","gabriel","lucian","bastier","walter","lanford","master du","antumbra","crimson warden","crimson nightmare","hexe marie","trukan","saigord","staglord","saigord the staglord","reed devil","blinding flash","grave walker","icewalker","white horn","stoneback crab","queen stoneback crab","taming dragon","tenebrum","crowcaller","draven","cassius","kearush","myurdin","excavatron","priscus","muskan","cubewalker","lithus","black fang","hemon","beindel","gwen kraber","white bearclaw","queen spider","crookrock","desert marauder","rusten","abyss kutum","kutum","goyen","matthias","white bear","t'rukan","lava myurdin","ator","ator archon","marni's clockwork mantis","marni's excavatron","awakened lucian bastier","awakened ludvig","one armed ludvig","new moon reaper","full moon reaper","half moon reaper","beloth the darksworn","dreadnought","thunder tank","turbine","pororin forest guardians","fundamentalist goblins","golden star"];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";

  if (/\b(puzzles?|strongbox|ancient ruins|sealed gate|disc puzzle|spire.{0,15}puzzle|sanctum.{0,15}puzzle|maze.{0,15}puzzle|ruins.{0,15}puzzle|how (do i|to) solve|puzzle solution)\b/.test(q)) return "puzzle";
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge|cook|cooking)\b/.test(q)) return "recipe";
  if (/\b(new game\+?|ng\+|post.?game|after (beating|finishing|completing) the (game|story|main quest)|endgame (content|guide|tips?|activities?)|what (to do|is there) after (the )?(game|story|ending)|end game content|postgame|game\+)\b/.test(q)) return "mechanic";
  if (/\b(camp (management|system|upgrade|level|buildings?|feature|guide|expand|expansion)|greymane camp (guide|upgrade|system|how|expand)|faction (system|reputation|rank|guide|how)|how (do i|to) (upgrade|level up|build up|improve|expand|grow|develop) (my |the )?camp|base (building|management|upgrade|system)|camp (resources?|workers?|npc|unlock)|expand(ing)? (the |my |greymane )?camp|how (big|large) (can|does) (the |my )?camp (get|become|grow))\b/.test(q)) return "mechanic";
  if (/\b(mount(s)? (system|guide|tips?|unlock|how|work)|how (do i|to|do) (get|obtain|unlock|tame|ride|use) (a |the )?(mount|horse|pet|steed)|how do(es)? (mounts?|horses?|pets?) work|pet (system|guide|combat|unlock|how)|horse (guide|system|tips?|riding|unlock|taming)|riding (system|guide|tips?)|best (mount|horse|pet)\b)\b/.test(q)) return "mechanic";
  if (/\b(where is|how do i get to|how to reach|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|tower|temple|crypt|catacomb|sanctum|sanctorum|ranch|gate|basin|falls|grotto|ridge|beacon|ancient ruins$|ancient ruin$)\b/.test(q)) return "exploration";
  if (/\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|what.{0,20}(good for|best for|work(s)? (well|good))|is .{3,30} (any )?good\b|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)) return null;
  if (/\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q)) return null;

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
      (res) => { let data = ""; res.on("data", (d) => (data += d));
        res.on("end", () => { try { resolve(JSON.parse(data).data?.[0]?.embedding ?? []); } catch (e) { reject(e); } });
      });
    req.on("error", reject); req.write(body); req.end();
  });
}

// ── Retrieve (mirrors run-eval.ts retrieve() logic) ──────────────────────────
async function retrieve(question: string, topK: number): Promise<{ chunks: Chunk[]; classifier: string | null; fallback: boolean; }> {
  const contentTypeFilter = classifyContentType(question);
  const effectiveMatchCount = topK;
  let fallback = false;
  const queryEmbedding = await embedQuery(question);

  const rpcParams: Record<string, unknown> = { query_embedding: queryEmbedding, match_threshold: 0.25, match_count: effectiveMatchCount + 10 };
  if (contentTypeFilter) rpcParams.content_type_filter = contentTypeFilter;

  let { data: vectorData } = await supabase.rpc("match_knowledge_chunks", rpcParams) as { data: Chunk[] | null };
  if ((!vectorData || vectorData.length === 0) && contentTypeFilter) {
    fallback = true;
    const { data: unfilteredData } = await supabase.rpc("match_knowledge_chunks", { query_embedding: queryEmbedding, match_threshold: 0.25, match_count: effectiveMatchCount + 4 }) as { data: Chunk[] | null };
    vectorData = unfilteredData;
  }
  let chunks: Chunk[] = vectorData || [];

  // Keyword boost (mirrors route.ts)
  const boostStopWords = new Set(["how","what","where","when","why","who","which","does","the","and","for","are","but","not","you","this","that","with","have","from","they","will","just","than","then","here","some","there","about","into","can","could","would","should","did","find","get","give","buy","farm","craft","make","locate","obtain","show","tell","use","equip","upgrade","unlock"]);
  const boostKeywords = question.replace(/[^a-zA-Z0-9\s'-]/g, "").split(/\s+/).filter((w) => w.length > 3 && !boostStopWords.has(w.toLowerCase())).slice(0, 6);
  const quotedNames: string[] = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
  const cleanedForPhrase = question
    .replace(/^(how (to do|to get|to reach|to complete|to find|to unlock|to|do i|does|can i)|where (is|can i find|do i find)|what (is|are|does)|who is|when is|tell me about|explain)\s+/i, "")
    .replace(/^(find|locate|get|buy|farm|obtain|craft|make|use|equip|upgrade|unlock|show|tell|give)\s+/i, "")
    .replace(/^(the|a|an|do|my)\s+/i, "")
    .replace(/\s+(challenge|challenges|quest|mission|boss|fight|item|skill|location|area|region|guide|help|tips?|strategy|strategies|ruins?|dungeon)s?\s*$/i, "").trim();
  if (cleanedForPhrase.split(/\s+/).length >= 2 && !quotedNames.some((n) => n.toLowerCase() === cleanedForPhrase.toLowerCase())) quotedNames.push(cleanedForPhrase);
  const allBoostTerms = [...new Set([...boostKeywords, ...quotedNames])];

  if (allBoostTerms.length > 0) {
    const multiWordUrlTerms = allBoostTerms.filter((t) => t.includes(" ")).map((t) => t.replace(/\s+/g, "+"));
    const singleWordUrlTerms = allBoostTerms.filter((t) => !t.includes(" ") && t.length >= 7);
    const urlTerms = multiWordUrlTerms.length > 0 ? multiWordUrlTerms : singleWordUrlTerms;

    let keywordChunks: Chunk[] = [];
    if (urlTerms.length > 0) {
      let urlQ: any = supabase.from("knowledge_chunks").select("id, content, source_url, source_type, quest_name, content_type")
        .or(urlTerms.map((t) => `source_url.ilike.%${t}%`).join(","));
      if (contentTypeFilter) urlQ = urlQ.eq("content_type", contentTypeFilter);
      const { data: urlMatches } = await urlQ.limit(10);
      if (urlMatches) keywordChunks = urlMatches;
    }
    if (keywordChunks.length < 4) {
      let cQ: any = supabase.from("knowledge_chunks").select("id, content, source_url, source_type, quest_name, content_type")
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
      const newKw = keywordChunks.filter((c) => !existingIds.has(c.id)).map((c) => {
        const isUrlMatch = urlTerms.some((t) => String(c.source_url || "").toLowerCase().includes(t.toLowerCase()));
        return { ...c, similarity: isUrlMatch ? 0.88 : 0.40, keywordBoost: true };
      });
      if (newKw.length > 0) chunks = [...chunks, ...newKw];
    }
  }

  // Reranker
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
  return { chunks: chunks.slice(0, topK), classifier: contentTypeFilter, fallback };
}

// ── Audit ────────────────────────────────────────────────────────────────────
interface AuditEntry {
  query: string;
  classifier: string | null;
  fallback: boolean;
  recall: number;
  expected_chunk_ids: string[];
  expected_chunks: Array<{ id: string; rank: number | null; in_top10: boolean; content_type: string; source_url: string; len: number; head: string }>;
  top10: Array<{ rank: number; id: string; similarity: number; is_expected: boolean; content_type: string; source_url: string; len: number; head: string }>;
}

(async () => {
  const { data: rows, error } = await supabase.from("retrieval_eval").select("*").order("created_at");
  if (error || !rows) throw error;

  const audit: AuditEntry[] = [];
  for (const row of rows as Array<{ query: string; expected_chunk_ids: string[] }>) {
    process.stdout.write(`Auditing: "${row.query.substring(0, 50)}"... `);
    const { chunks, classifier, fallback } = await retrieve(row.query, 10);
    const top10Ids = chunks.map((c) => c.id);
    const expectedSet = new Set(row.expected_chunk_ids);
    const recall = row.expected_chunk_ids.length === 0 ? NaN : row.expected_chunk_ids.filter((id) => top10Ids.includes(id)).length / row.expected_chunk_ids.length;

    // Pull content for top-10 + any expected chunks not in top-10
    const allIds = [...new Set([...top10Ids, ...row.expected_chunk_ids])];
    const { data: chunkData } = await supabase.from("knowledge_chunks").select("id, content_type, source_url, content").in("id", allIds);
    const byId = new Map((chunkData || []).map((c: { id: string }) => [c.id, c]));

    const top10: AuditEntry["top10"] = chunks.map((c, i) => {
      const full = byId.get(c.id) as { content_type?: string; source_url?: string; content?: string } | undefined;
      return {
        rank: i + 1,
        id: c.id,
        similarity: Number(c.similarity || 0),
        is_expected: expectedSet.has(c.id),
        content_type: full?.content_type ?? "",
        source_url: full?.source_url ?? "",
        len: full?.content?.length ?? 0,
        head: (full?.content ?? "").substring(0, 200).replace(/\n/g, " "),
      };
    });

    const expected_chunks: AuditEntry["expected_chunks"] = row.expected_chunk_ids.map((id) => {
      const idx = top10Ids.indexOf(id);
      const full = byId.get(id) as { content_type?: string; source_url?: string; content?: string } | undefined;
      return {
        id, rank: idx >= 0 ? idx + 1 : null, in_top10: idx >= 0,
        content_type: full?.content_type ?? "?", source_url: full?.source_url ?? "?",
        len: full?.content?.length ?? 0,
        head: (full?.content ?? "").substring(0, 200).replace(/\n/g, " "),
      };
    });

    audit.push({ query: row.query, classifier, fallback, recall, expected_chunk_ids: row.expected_chunk_ids, expected_chunks, top10 });
    console.log(`recall=${(recall * 100).toFixed(0)}% top10=${top10.length} cls=${classifier ?? "none"}`);
    await new Promise((r) => setTimeout(r, 600)); // polite Voyage gap
  }

  writeFileSync("./phase1d-eval-audit-comprehensive.json", JSON.stringify(audit, null, 2), "utf-8");
  console.log(`\nWrote phase1d-eval-audit-comprehensive.json (${audit.length} queries)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
