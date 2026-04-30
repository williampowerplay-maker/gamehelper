// scripts/trace-tier-list-pipeline.ts
//
// One-off diagnostic trace that mirrors src/app/api/chat/route.ts's full
// retrieval pipeline (classify → vector → keyword boost → rerank) and
// reports each step's actual values for tier-list queries.
//
// Used in Phase 1 diagnosis (Session 33) to identify which boosts are
// pushing the wrong chunks into the post-rerank top-10 for tier-list
// queries. NOT a permanent script — purely diagnostic.

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(): Record<string, string> {
  try {
    const envPath = path.join(__dirname, "..", ".env.local");
    const c = fs.readFileSync(envPath, "utf-8");
    const v: Record<string, string> = {};
    c.split("\n").forEach(l => { const m = l.match(/^([^#=]+)=(.*)$/); if (m) v[m[1].trim()] = m[2].trim(); });
    return v;
  } catch { return {}; }
}
const env = loadEnv();
const SB_URL  = env.NEXT_PUBLIC_SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const SB_SVC  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const VOYAGE  = env.VOYAGE_API_KEY            || process.env.VOYAGE_API_KEY            || "";

// ── Mirror route.ts:classifyContentType (only the bits relevant to tier-list) ──
function classifyContentType(question: string): string | null {
  const q = question.toLowerCase();
  if (/\b(best build|optimal build|build for|builds for|what.*build|recommended build|endgame build)\b/.test(q)) return null;
  if (/\b(best (weapon|gear|armor|accessory|accessories|item|equipment) for (a ?)?(beginner|new player|early|starter)|starter (weapon|gear)|beginner (weapon|gear))\b/.test(q)) return null;
  if (/\b(what (weapons?|abilities|skills|classes|weapon types?) (can|does|do) \w+ use|what (weapons?|weapon types?) (are|is) (available|in the game))\b/.test(q)) return null;
  if (/\b(vs\.?|versus)\b|better than\b|compare.{0,30}(weapon|armor|skill|class)|(sword|spear|bow|axe|staff|dagger|ring|necklace|earring|armor|armour)\s+(or|vs)\s+\w|\bor\b.{0,30}\b(which (is |one )?(better|stronger|best|worse|worse))|which (is|one) (better|stronger|best)/.test(q)) return null;
  if (/\b(food (buff|bonus|effect|for|before|during|guide)|best food (for|to eat|before)|what (food|meal) (should|to|is good)|elixir (effect|buff|guide)|buff food|combat food|healing food|consumable (guide|tips?|buff|strategy)|what (to eat|should i eat|food (to use|gives))|food (that (gives|boosts?|increases?)|for (combat|fighting|bosses?|dungeons?)))\b/.test(q)) return null;
  if (/\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|what.{0,20}(good for|best for|work(s)? (well|good))|is .{3,30} (any )?good\b|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)) return null;
  if (/\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q)) return null;
  return "OTHER"; // sentinel — we only care if it returns null for the tier-list cases
}

function isRecommendationQuery(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)
    || /\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q);
}
function isListQuery(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(list (all|every)|all (the )?(bosses?|weapons?|armou?rs?|skills?|quests?|accessories|items?|locations?|enemies?|recipes?|puzzles?|challenges?)|every (weapon|boss|skill|armou?r|item|accessory|enemy|quest)|complete list|full list of|how many (bosses?|weapons?|skills?|quests?|items?|regions?|dungeons?))\b/.test(q);
}
function isTierListQuery(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(what (are|is) the (best|top|strongest)|which (is|are) the best|top \d+|tier list of)\b.{1,25}\b(weapon|sword|bow|gun|spear|pike|axe|hammer|dagger|staff|shield|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories|item|gear)s?\b/.test(q)
      || /\b(best|top|strongest)\b.{1,25}\b(weapon|sword|bow|gun|spear|pike|axe|hammer|dagger|staff|shield|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories|item|gear)s?\b/.test(q);
}

const BOOST_STOPWORDS = new Set(["how","what","where","when","why","who","which","does","the","and","for","are","but","not","you","this","that","with","have","from","they","will","just","than","then","here","some","there","about","into","can","could","would","should","did","find","get","give","buy","farm","craft","make","locate","obtain","show","tell","use","equip","upgrade","unlock"]);

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5-lite", input: [text], input_type: "query" }),
  });
  if (!res.ok) throw new Error(`Voyage HTTP ${res.status}`);
  const d = await res.json();
  return d.data[0].embedding;
}

interface ChunkRow {
  id: string; content: string; source_url: string; source_type?: string;
  quest_name?: string; content_type?: string; similarity: number;
  keywordBoost?: boolean; termHits?: number;
  // Trace fields:
  _origin?: string;     // 'vector' | 'url-match' | 'content-match'
  _baseSim?: number;
  _boostBreakdown?: string;
}

const QUERY = "what are the best one-handed weapons?";
const EXPECTED = new Set([
  "fa85ee79-1e19-4852-a738-2052a134b7a9",
  "4bad19ac-a944-4157-b00c-eeb7a2ca3ef5",
  "e5b04a96-b88d-4114-8e09-96bf470ea6df",
]);

async function main() {
  if (!SB_URL || !SB_SVC) throw new Error("Missing SUPABASE env");
  if (!VOYAGE) throw new Error("Missing VOYAGE_API_KEY");
  const supabase = createClient(SB_URL, SB_SVC);

  console.log("═".repeat(80));
  console.log(`TRACE: "${QUERY}"`);
  console.log("═".repeat(80));

  // ── Step 1: Classifier ─────────────────────────────────────────
  const ctype = classifyContentType(QUERY);
  const isRec = isRecommendationQuery(QUERY);
  const isList = isListQuery(QUERY);
  const isTierList = isTierListQuery(QUERY);
  // matchCount for nudge tier (default eval/spoilerTier)
  const baseMatchCount = 4; // TIER_CLAUDE.nudge.matchCount
  const effectiveMatchCount = (isList || isTierList) ? 20 : isRec ? Math.min(baseMatchCount + 4, 12) : baseMatchCount;
  console.log(`\n[STEP 1] Classifier`);
  console.log(`  classifyContentType: ${ctype === null ? "null (full search)" : ctype}`);
  console.log(`  isRecommendationQuery: ${isRec}`);
  console.log(`  isListQuery: ${isList}`);
  console.log(`  isTierListQuery: ${isTierList}`);
  console.log(`  baseMatchCount (nudge tier): ${baseMatchCount}`);
  console.log(`  effectiveMatchCount: ${effectiveMatchCount}`);
  console.log(`  → vector search will fetch ${effectiveMatchCount + 10} candidates`);

  // ── Step 2: Vector search ──────────────────────────────────────
  console.log(`\n[STEP 2] Vector search (match_threshold=0.25, match_count=${effectiveMatchCount + 10})`);
  const emb = await embedQuery(QUERY);
  const { data: vecData, error: vecErr } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: emb,
    match_threshold: 0.25,
    match_count: effectiveMatchCount + 10,
  });
  if (vecErr) throw new Error("vector rpc: " + vecErr.message);
  let chunks = (vecData as ChunkRow[]).map(c => ({ ...c, _origin: "vector" as const }));
  console.log(`  returned ${chunks.length} candidates`);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const url = c.source_url.replace(/^https?:\/\//, "").slice(0, 60);
    const exp = EXPECTED.has(c.id) ? "✓" : " ";
    console.log(`    ${(i+1).toString().padStart(2)}. ${c.id.slice(0,8)} ${exp} sim=${Number(c.similarity).toFixed(3)} ${url}`);
  }

  // ── Step 3: Keyword extraction ─────────────────────────────────
  const boostKeywords = QUERY
    .replace(/[^a-zA-Z0-9\s'-]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !BOOST_STOPWORDS.has(w.toLowerCase()))
    .slice(0, 6);
  const quotedNames: string[] = QUERY.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
  const cleanedForPhrase = QUERY
    .replace(/^(how (to do|to get|to reach|to complete|to find|to unlock|to|do i|does|can i)|where (is|can i find|do i find)|what (is|are|does)|who is|when is|tell me about|explain)\s+/i, "")
    .replace(/^(find|locate|get|buy|farm|obtain|craft|make|use|equip|upgrade|unlock|show|tell|give)\s+/i, "")
    .replace(/^(the|a|an|do|my)\s+/i, "")
    .replace(/\s+(challenge|challenges|quest|mission|boss|fight|item|skill|location|area|region|guide|help|tips?|strategy|strategies|ruins?|dungeon)s?\s*$/i, "")
    .replace(/[?!.,;:'"()[\]{}]/g, "")
    .trim();
  if (cleanedForPhrase.split(/\s+/).length >= 2 && !quotedNames.some(n => n.toLowerCase() === cleanedForPhrase.toLowerCase())) {
    quotedNames.push(cleanedForPhrase);
  }
  const allBoostTerms = [...new Set([...boostKeywords, ...quotedNames])];
  console.log(`\n[STEP 3] Keyword extraction`);
  console.log(`  boostKeywords (stopword-filtered, len>3, max 6): ${JSON.stringify(boostKeywords)}`);
  console.log(`  quotedNames (capital-letter regex): ${JSON.stringify(quotedNames.slice(0, 1))}`);
  console.log(`  cleanedForPhrase (after question-prefix strip): ${JSON.stringify(cleanedForPhrase)}`);
  console.log(`  allBoostTerms: ${JSON.stringify(allBoostTerms)}`);

  const multiWordUrlTerms = allBoostTerms.filter(t => t.includes(" ")).map(t => t.replace(/\s+/g, "+"));
  const singleWordUrlTerms = allBoostTerms.filter(t => !t.includes(" ") && t.length >= 7);
  const urlTerms = multiWordUrlTerms.length > 0 ? multiWordUrlTerms : singleWordUrlTerms;
  console.log(`  multiWordUrlTerms: ${JSON.stringify(multiWordUrlTerms)}`);
  console.log(`  singleWordUrlTerms (>=7 chars): ${JSON.stringify(singleWordUrlTerms)}`);
  console.log(`  urlTerms (used for ILIKE): ${JSON.stringify(urlTerms)}`);

  // ── Step 4: URL-ILIKE boost (Priority 1, limit 10) ──────────────
  console.log(`\n[STEP 4] URL-ILIKE boost (limit 10, contentTypeFilter=${ctype === null ? "NULL" : ctype})`);
  let urlMatches: ChunkRow[] = [];
  if (urlTerms.length > 0) {
    let qb: any = supabase
      .from("knowledge_chunks")
      .select("id, content, source_url, source_type, quest_name, content_type")
      .or(urlTerms.map(t => `source_url.ilike.%${t}%`).join(","));
    // No content_type filter for tier-list queries (ctype is null)
    const { data, error } = await qb.limit(10);
    if (error) console.log(`  ERR: ${error.message}`);
    urlMatches = (data || []) as ChunkRow[];
  }
  console.log(`  URL-ILIKE returned ${urlMatches.length} chunks`);
  for (const c of urlMatches.slice(0, 10)) {
    const url = c.source_url.replace(/^https?:\/\//, "").slice(0, 60);
    console.log(`    ${c.id.slice(0,8)} ${url}`);
  }

  // ── Step 5: Content-ILIKE boost (Priority 2 if URL <4, limit 8) ─
  console.log(`\n[STEP 5] Content-ILIKE boost (fires if urlMatches < 4, limit 8)`);
  let contentMatches: ChunkRow[] = [];
  if (urlMatches.length < 4) {
    let qb: any = supabase
      .from("knowledge_chunks")
      .select("id, content, source_url, source_type, quest_name, content_type")
      .or(allBoostTerms.map(t => `content.ilike.%${t}%`).join(","));
    const { data, error } = await qb.limit(8);
    if (error) console.log(`  ERR: ${error.message}`);
    contentMatches = (data || []) as ChunkRow[];
    console.log(`  Content-ILIKE returned ${contentMatches.length} chunks`);
    for (const c of contentMatches) {
      const url = c.source_url.replace(/^https?:\/\//, "").slice(0, 60);
      console.log(`    ${c.id.slice(0,8)} ${url}`);
    }
  } else {
    console.log(`  SKIPPED (urlMatches=${urlMatches.length} >= 4)`);
  }

  // ── Step 6: Merge keyword candidates into pool ─────────────────
  let keywordChunks: ChunkRow[] = [...urlMatches];
  const seenKw = new Set(urlMatches.map(c => c.id));
  for (const c of contentMatches) if (!seenKw.has(c.id)) keywordChunks.push(c);

  const existingIds = new Set(chunks.map(c => c.id));
  const newKw = keywordChunks.filter(c => !existingIds.has(c.id)).map(c => {
    const isUrl = urlTerms.some(t => (c.source_url || "").toLowerCase().includes(t.toLowerCase()));
    return { ...c, similarity: isUrl ? 0.88 : 0.40, keywordBoost: true, _origin: isUrl ? "url-match" as const : "content-match" as const };
  });
  console.log(`\n[STEP 6] Merge keyword candidates`);
  console.log(`  keywordChunks total: ${keywordChunks.length}`);
  console.log(`  Already in vector pool: ${keywordChunks.length - newKw.length}`);
  console.log(`  New (added to pool with assigned sim): ${newKw.length}`);
  for (const c of newKw) {
    const url = c.source_url.replace(/^https?:\/\//, "").slice(0, 60);
    console.log(`    ${c.id.slice(0,8)} sim=${c.similarity.toFixed(2)} (${c._origin}) ${url}`);
  }
  chunks = [...chunks, ...newKw];

  // ── Step 7: Re-rank ─────────────────────────────────────────────
  const questionTerms = QUERY.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const urlTermsForRerank = allBoostTerms.map(t => t.replace(/\s+/g, "+").toLowerCase());
  console.log(`\n[STEP 7] Re-rank`);
  console.log(`  questionTerms (len>3, NO stopword filter): ${JSON.stringify(questionTerms)}`);
  console.log(`  urlTermsForRerank (lowercased, +-encoded): ${JSON.stringify(urlTermsForRerank)}`);
  console.log(`  pool size pre-rerank: ${chunks.length}`);

  chunks = chunks.map(c => {
    const content = String(c.content || "").toLowerCase();
    const sourceUrl = String(c.source_url || "").toLowerCase();
    const contentStart = content.substring(0, 200);
    const termHits = questionTerms.filter(t => content.includes(t)).length;
    const baseSim = Number(c.similarity || 0.3);
    let boost = Math.min(0.10, termHits * 0.02);
    let breakdown = `termHits=${termHits} (+${Math.min(0.10, termHits * 0.02).toFixed(2)})`;
    if (!isTierList && urlTermsForRerank.some(t => sourceUrl.includes(t))) {
      boost += 0.08;
      const matched = urlTermsForRerank.find(t => sourceUrl.includes(t));
      breakdown += ` url-match[${matched}](+0.08)`;
    } else if (isTierList && urlTermsForRerank.some(t => sourceUrl.includes(t))) {
      const matched = urlTermsForRerank.find(t => sourceUrl.includes(t));
      breakdown += ` url-match[${matched}](SKIPPED-tier-list)`;
    }
    const contentStartHits = urlTermsForRerank.filter(t => contentStart.includes(t.replace(/\+/g, " "))).length;
    if (contentStartHits > 0) {
      const csBoost = Math.min(0.20, contentStartHits * 0.10);
      boost += csBoost;
      breakdown += ` contentStart=${contentStartHits} (+${csBoost.toFixed(2)})`;
    }
    let pnHits = 0;
    for (const pn of allBoostTerms) {
      if (content.includes(pn.toLowerCase())) { boost += 0.04; pnHits++; }
    }
    if (pnHits > 0) breakdown += ` pn=${pnHits} (+${(pnHits * 0.04).toFixed(2)})`;
    return { ...c, similarity: baseSim + boost, termHits, _baseSim: baseSim, _boostBreakdown: breakdown };
  });
  chunks.sort((a, b) => Number(b.similarity) - Number(a.similarity));

  // ── Step 8: Final top-effectiveMatchCount ──────────────────────
  console.log(`\n[STEP 8] Final ranking — top ${effectiveMatchCount} after slice`);
  console.log(`  rank  origin       baseSim → final  expected?  source_url${" ".repeat(34)}  boost breakdown`);
  for (let i = 0; i < Math.min(chunks.length, effectiveMatchCount); i++) {
    const c = chunks[i] as ChunkRow;
    const url = c.source_url.replace(/^https?:\/\//, "").slice(0, 50).padEnd(50);
    const exp = EXPECTED.has(c.id) ? "✓" : " ";
    console.log(`  ${(i+1).toString().padStart(3)}.  ${(c._origin || "?").padEnd(13)} ${(c._baseSim ?? 0).toFixed(3)} → ${Number(c.similarity).toFixed(3)}   ${exp}        ${url}  ${c._boostBreakdown}`);
  }

  // ── Step 9: Where did the expected chunks land? ────────────────
  console.log(`\n[STEP 9] Expected chunk fates`);
  for (const expId of EXPECTED) {
    const idx = chunks.findIndex(c => c.id === expId);
    if (idx >= 0) {
      const c = chunks[idx] as ChunkRow;
      console.log(`  ${expId.slice(0,8)}: rank ${idx + 1} in post-rerank pool (size ${chunks.length}) — ${c._origin} baseSim=${(c._baseSim ?? 0).toFixed(3)} final=${Number(c.similarity).toFixed(3)} | ${c._boostBreakdown}`);
    } else {
      console.log(`  ${expId.slice(0,8)}: NOT in pool of ${chunks.length} — would need to be in vector top-${effectiveMatchCount + 10} OR caught by URL/content boost`);
    }
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
