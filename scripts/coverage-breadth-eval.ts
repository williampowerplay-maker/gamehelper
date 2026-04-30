// scripts/coverage-breadth-eval.ts
//
// Coverage breadth eval — additive to retrieval_eval. Estimates per-content-type
// retrieval pass rates by sampling entities (specific bosses/quests/items/puzzles)
// from the corpus and asking "did ANY chunk from the expected entity URL surface
// in top-10 for an obvious query about that entity?"
//
// Sampling per type (population in 2026-04-30 corpus):
//   boss   (~75)   : full enumeration
//   puzzle (~14)   : full enumeration
//   quest  (~426)  : 20%, clamp [50, 100]
//   item   (~2581) : 10%, clamp [100, 200]
//
// Sample is DETERMINISTIC by stableHash(entity_url + seed). Same seed → same
// sample. Different seed → independent sample.
//
// CLI:
//   --dry-run         : print population, sample size, first 10 queries per type
//   --seed=N          : sampling seed (default 42)
//   --concurrency=N   : query concurrency (default 4)
//   --out=path        : CSV output path (default ./coverage-breadth-{seed}.csv)
//
// NOT a retrieval_eval replacement. Designed for fast iteration on per-type
// coverage hypotheses (e.g. "do quest queries surface fextralife quest pages?").

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Env loading (mirrors run-eval.ts pattern) ────────────────────────────────
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

// ── Constants ────────────────────────────────────────────────────────────────
const VOYAGE_MODEL = "voyage-3.5-lite";
const VOYAGE_BATCH_SIZE = 32;
const TARGET_TYPES = ["boss", "quest", "item", "puzzle"] as const;
type EntityType = typeof TARGET_TYPES[number];

// Sampling rules by type
const SAMPLE_RULES: Record<EntityType, { pct: number; min: number; max: number; full: boolean }> = {
  boss:   { pct: 1.0,  min: 0,   max: 9999, full: true  },
  puzzle: { pct: 1.0,  min: 0,   max: 9999, full: true  },
  quest:  { pct: 0.20, min: 50,  max: 100,  full: false },
  item:   { pct: 0.10, min: 100, max: 200,  full: false },
};

// Hand-curated category-index URLs that slip past the phase1e queue and the
// chunk-count [2, 100] filter. These are pages that ARE in the corpus with
// boss/quest/item/puzzle content_type but are NOT specific entities.
// Matched against the URL path slug after the host.
const CATEGORY_INDEX_SLUGS = new Set([
  // item categories
  "Footwear", "Body_Armor", "Body+Armor", "Recovery_Items", "Recovery+Items",
  "Crafting_Manuals", "Crafting+Manuals", "Headgear", "Cloaks", "Gloves",
  "Two-Handed_Weapons", "Two-Handed+Weapons", "Two_Handed_Weapons", "Two+Handed+Weapons",
  "One-Handed_Weapons", "One-Handed+Weapons", "One_Handed_Weapons", "One+Handed+Weapons",
  "Shields", "Resources", "Gatherables", "Collectibles", "Tools", "Accessories",
  // quest categories
  "Faction_Quests", "Faction+Quests", "Main_Quests", "Main+Quests",
  "Side_Quests", "Side+Quests", "Quests", "Walkthrough",
  // boss "categories" (also includes the misclassified Pywel — continent, not boss)
  "Bosses", "Pywel",
  // puzzle categories (none observed in spot-check, but defensive)
  "Puzzles", "Challenges",
]);

// ── CLI ──────────────────────────────────────────────────────────────────────
interface CliArgs { dryRun: boolean; seed: number; concurrency: number; out: string; }
function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (p: string) => argv.find(a => a.startsWith(p))?.split("=")[1];
  const seed = parseInt(get("--seed=") ?? "42", 10);
  const conc = parseInt(get("--concurrency=") ?? "4", 10);
  const out = get("--out=") ?? `./coverage-breadth-${seed}.csv`;
  return { dryRun: argv.includes("--dry-run"), seed, concurrency: conc, out };
}

// ── Stable hash for deterministic sampling ───────────────────────────────────
// SHA-256(url + seed) → first 8 bytes as bigint. Same input → same output.
function stableHash(input: string, seed: number): bigint {
  const h = crypto.createHash("sha256").update(input + ":" + seed).digest();
  return h.readBigUInt64BE(0);
}

// ── URL normalization for variant dedup + category-index detection ──────────
function getSlug(url: string): string {
  // Strip protocol + host + leading slash
  return url.replace(/^https?:\/\/[^/]+\//, "").split("?")[0].split("#")[0];
}
function canonicalName(url: string): string {
  const slug = getSlug(url);
  // Decode percent-encoding, then replace + and _ with space
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* leave as-is */ }
  return decoded.replace(/[+_]/g, " ").trim().toLowerCase();
}
function isCategoryIndex(url: string): boolean {
  const slug = getSlug(url);
  if (slug.startsWith("Subcontent:")) return true;
  if (CATEGORY_INDEX_SLUGS.has(slug)) return true;
  return false;
}
function entityNameFromUrl(url: string): string {
  const slug = getSlug(url);
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* leave as-is */ }
  return decoded.replace(/[+_]/g, " ").trim();
}

// ── Query generation ─────────────────────────────────────────────────────────
function makeQuery(type: EntityType, name: string): string {
  switch (type) {
    case "boss":   return `how do I beat ${name}?`;
    case "quest":  return `what is the ${name} quest?`;
    case "item":   return `what is the ${name}?`;
    case "puzzle": return `how do I solve the ${name}?`;
  }
}

// ── Voyage embedding (batch) ─────────────────────────────────────────────────
async function embedBatch(texts: string[]): Promise<number[][]> {
  let lastErr = "unknown";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: "query" }),
      });
      if (res.status === 429) {
        const ra = parseInt(res.headers.get("retry-after") ?? "0", 10);
        const pauseMs = (Number.isFinite(ra) && ra > 0) ? ra * 1000 : Math.min(16000, 1000 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, pauseMs));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      return d.data.map((x: { embedding: number[] }) => x.embedding);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`Voyage batch failed: ${lastErr}`);
}

// ── Tier-list / list / rec detection (mirror route.ts) ───────────────────────
function isTierListQuery(q: string): boolean {
  const ql = q.toLowerCase();
  return /\b(what (are|is) the (best|top|strongest)|which (is|are) the best|top \d+|tier list of)\b.{1,25}\b(weapon|sword|bow|gun|spear|pike|axe|hammer|dagger|staff|shield|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories|item|gear)s?\b/.test(ql)
      || /\b(best|top|strongest)\b.{1,25}\b(weapon|sword|bow|gun|spear|pike|axe|hammer|dagger|staff|shield|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories|item|gear)s?\b/.test(ql);
}

const BOOST_STOPWORDS = new Set(["how","what","where","when","why","who","which","does","the","and","for","are","but","not","you","this","that","with","have","from","they","will","just","than","then","here","some","there","about","into","can","could","would","should","did","find","get","give","buy","farm","craft","make","locate","obtain","show","tell","use","equip","upgrade","unlock"]);

interface ChunkRow {
  id: string; content: string; source_url: string;
  source_type?: string; quest_name?: string | null; content_type?: string;
  similarity: number;
}

// ── Single-query retrieval (mirrors route.ts pipeline) ──────────────────────
// Note: classifier intentionally NOT applied here — for coverage breadth we want
// to test the unconstrained pipeline. classifyContentType could narrow the
// search to a content_type that doesn't include the entity's actual type.
async function retrieveOne(supabase: SupabaseClient, question: string, queryEmb: number[], topK: number): Promise<ChunkRow[]> {
  const isTier = isTierListQuery(question);
  // Mirror full-tier match_count = 8 (default) — this is our reference pipeline.
  const baseMatchCount = 8;
  const effectiveMatchCount = isTier ? 20 : baseMatchCount;

  // Vector search
  const { data: vecData } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: queryEmb,
    match_threshold: 0.25,
    match_count: effectiveMatchCount + 10,
  });
  let chunks: ChunkRow[] = (vecData || []) as ChunkRow[];

  // Keyword extraction
  const boostKeywords = question.replace(/[^a-zA-Z0-9\s'-]/g, "").split(/\s+/)
    .filter(w => w.length > 3 && !BOOST_STOPWORDS.has(w.toLowerCase())).slice(0, 6);
  const quotedNames: string[] = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
  const cleanedForPhrase = question
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

  if (allBoostTerms.length > 0) {
    const multiWordUrlTerms = allBoostTerms.filter(t => t.includes(" ")).map(t => t.replace(/\s+/g, "+"));
    const singleWordUrlTerms = allBoostTerms.filter(t => !t.includes(" ") && t.length >= 7);
    const urlTerms = multiWordUrlTerms.length > 0 ? multiWordUrlTerms : singleWordUrlTerms;

    let keywordChunks: ChunkRow[] = [];
    if (urlTerms.length > 0) {
      const { data: urlMatches } = await supabase.from("knowledge_chunks")
        .select("id, content, source_url, source_type, quest_name, content_type")
        .or(urlTerms.map(t => `source_url.ilike.%${t}%`).join(","))
        .limit(10);
      if (urlMatches) keywordChunks = urlMatches as ChunkRow[];
    }
    if (keywordChunks.length < 4) {
      const { data: contentMatches } = await supabase.from("knowledge_chunks")
        .select("id, content, source_url, source_type, quest_name, content_type")
        .or(allBoostTerms.map(t => `content.ilike.%${t}%`).join(","))
        .limit(8);
      if (contentMatches) {
        const seen = new Set(keywordChunks.map(c => c.id));
        for (const c of contentMatches as ChunkRow[]) if (!seen.has(c.id)) keywordChunks.push(c);
      }
    }
    if (keywordChunks.length > 0) {
      const existingIds = new Set(chunks.map(c => c.id));
      const newKw = keywordChunks.filter(c => !existingIds.has(c.id)).map(c => {
        const isUrlMatch = urlTerms.some(t => String(c.source_url || "").toLowerCase().includes(t.toLowerCase()));
        return { ...c, similarity: isUrlMatch ? 0.88 : 0.40 };
      });
      chunks = [...chunks, ...newKw];
    }

    // Rerank
    const questionTerms = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const urlTermsForRerank = allBoostTerms.map(t => t.replace(/\s+/g, "+").toLowerCase());
    chunks = chunks.map(c => {
      const content = String(c.content || "").toLowerCase();
      const sourceUrl = String(c.source_url || "").toLowerCase();
      const contentStart = content.substring(0, 200);
      const termHits = questionTerms.filter(t => content.includes(t)).length;
      const baseSim = Number(c.similarity || 0.3);
      let boost = Math.min(0.10, termHits * 0.02);
      if (!isTier && urlTermsForRerank.some(t => sourceUrl.includes(t))) boost += 0.08;
      const csHits = urlTermsForRerank.filter(t => contentStart.includes(t.replace(/\+/g, " "))).length;
      if (csHits > 0) boost += Math.min(0.20, csHits * 0.10);
      for (const pn of allBoostTerms) if (content.includes(pn.toLowerCase())) boost += 0.04;
      return { ...c, similarity: baseSim + boost };
    });
    chunks.sort((a, b) => Number(b.similarity) - Number(a.similarity));
  }

  return chunks.slice(0, topK);
}

// ── Phase A: enumerate entities ──────────────────────────────────────────────
interface Entity {
  type: EntityType;
  source_url: string;       // canonical URL (highest-chunk variant)
  variant_urls: string[];   // all URLs sharing the same canonicalName
  chunk_count: number;
  entity_name: string;
}

async function enumerateEntities(supabase: SupabaseClient): Promise<Entity[]> {
  // Pull (source_url, content_type, count) tuples via RPC-equivalent SELECT.
  // We need to bypass PostgREST seq-scan timeout, so go via the RPC route by
  // using a server-side aggregate function. There isn't one; use a paginated
  // SELECT with explicit chunk_count range filter. Service role has higher
  // statement_timeout so this should work.
  //
  // Approach: pull all (source_url, content_type) for fextralife rows, count
  // in JS. Phase1d had to do similar paginated reads.
  console.log("[breadth] Enumerating fextralife entities...");
  const targetTypes = TARGET_TYPES as readonly string[];

  // Pull phase1e excluded URLs once
  const { data: excludedRows, error: excErr } = await supabase
    .from("phase1e_nav_only_candidates_20260425").select("source_url");
  if (excErr) throw new Error("phase1e fetch: " + excErr.message);
  const excluded = new Set((excludedRows ?? []).map((r: { source_url: string }) => r.source_url));
  console.log(`[breadth]   phase1e exclusion list: ${excluded.size} URLs`);

  // Paginated read of (source_url, content_type) for fextralife + target types.
  // No source_url index, so this is a seq scan; service role timeout permits.
  // .order("id") is REQUIRED for deterministic pagination — without it, .range()
  // returns rows in undefined order and can skip/duplicate across pages on rerun.
  // (Same fix Phase1d applied — see scripts/phase1d-strip-boilerplate.ts:156.)
  const PAGE = 1000;
  const counts = new Map<string, { type: EntityType; n: number }>();
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabase.from("knowledge_chunks")
      .select("source_url, content_type")
      .ilike("source_url", "%fextralife%")
      .in("content_type", targetTypes as string[])
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error("knowledge_chunks page: " + error.message);
    if (!data || data.length === 0) break;
    for (const row of data as { source_url: string; content_type: EntityType }[]) {
      if (excluded.has(row.source_url)) continue;
      const cur = counts.get(row.source_url);
      if (cur) cur.n++;
      else counts.set(row.source_url, { type: row.content_type, n: 1 });
    }
    process.stdout.write(`\r[breadth]   page ${page + 1}: ${counts.size} unique URLs so far`);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  process.stdout.write("\n");

  // Apply chunk-count filter and category-index exclusion
  const candidates: Array<{ url: string; type: EntityType; n: number }> = [];
  for (const [url, info] of counts) {
    if (info.n < 2 || info.n > 100) continue;
    if (isCategoryIndex(url)) continue;
    candidates.push({ url, type: info.type, n: info.n });
  }
  console.log(`[breadth]   after chunk-count + category-index filter: ${candidates.length} candidates`);

  // Dedupe URL variants (e.g. /Saint's_Necklace and /Saint's+Necklace) by canonical name + type
  const byCanon = new Map<string, { type: EntityType; variants: { url: string; n: number }[] }>();
  for (const c of candidates) {
    const key = `${c.type}::${canonicalName(c.url)}`;
    let bucket = byCanon.get(key);
    if (!bucket) { bucket = { type: c.type, variants: [] }; byCanon.set(key, bucket); }
    bucket.variants.push({ url: c.url, n: c.n });
  }

  const entities: Entity[] = [];
  for (const bucket of byCanon.values()) {
    // Pick highest-chunk variant as canonical source_url
    const sorted = [...bucket.variants].sort((a, b) => b.n - a.n);
    const canonical = sorted[0];
    entities.push({
      type: bucket.type,
      source_url: canonical.url,
      variant_urls: sorted.map(v => v.url),
      chunk_count: canonical.n,
      entity_name: entityNameFromUrl(canonical.url),
    });
  }

  console.log(`[breadth]   after URL-variant dedup: ${entities.length} entities`);

  // Per-type tally
  const byType: Record<string, number> = {};
  for (const e of entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
  for (const t of TARGET_TYPES) console.log(`[breadth]     ${t.padEnd(6)} ${byType[t] ?? 0}`);
  return entities;
}

// ── Phase B: deterministic sample ────────────────────────────────────────────
function sampleEntities(entities: Entity[], seed: number): Map<EntityType, Entity[]> {
  const byType = new Map<EntityType, Entity[]>();
  for (const t of TARGET_TYPES) byType.set(t, []);
  for (const e of entities) byType.get(e.type)!.push(e);

  const sampled = new Map<EntityType, Entity[]>();
  for (const t of TARGET_TYPES) {
    const pool = byType.get(t)!;
    const rule = SAMPLE_RULES[t];
    let sampleSize: number;
    if (rule.full) {
      sampleSize = pool.length;
    } else {
      sampleSize = Math.round(pool.length * rule.pct);
      if (sampleSize < rule.min) sampleSize = rule.min;
      if (sampleSize > rule.max) sampleSize = rule.max;
      if (sampleSize > pool.length) {
        console.warn(`[breadth] WARN: ${t} sample size ${sampleSize} > pool ${pool.length}; capping`);
        sampleSize = pool.length;
      }
    }
    // Sort by stableHash(url + seed) ascending, take first N
    const ranked = [...pool].sort((a, b) => {
      const ha = stableHash(a.source_url, seed);
      const hb = stableHash(b.source_url, seed);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    sampled.set(t, ranked.slice(0, sampleSize));
  }
  return sampled;
}

// ── Concurrent worker pool ───────────────────────────────────────────────────
async function runConcurrent<T, R>(items: T[], conc: number, worker: (t: T, i: number) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0, done = 0;
  const take = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, take));
  return out;
}

// ── Margin of error (Wald 95% CI) ────────────────────────────────────────────
function moe95(passes: number, n: number): number {
  if (n === 0) return 0;
  const p = passes / n;
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}

// ── CSV escape ───────────────────────────────────────────────────────────────
function csvEscape(v: string | number | boolean): string {
  const s = String(v);
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ── Main ─────────────────────────────────────────────────────────────────────
interface RunResult {
  seed: number;
  sample_index: number;
  entity_type: EntityType;
  entity_name: string;
  expected_url: string;
  query: string;
  pass: boolean;
  top1_chunk_id: string;
  top1_url: string;
  top1_similarity: number;
  count_chunks_from_expected_url_in_top10: number;
  total_population: number;
  sample_size: number;
}

async function main() {
  if (!SB_URL || !SB_SVC) throw new Error("Missing SUPABASE env");
  if (!VOYAGE) throw new Error("Missing VOYAGE_API_KEY");
  const args = parseArgs();
  const supabase = createClient(SB_URL, SB_SVC);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Coverage Breadth Eval — seed=${args.seed}, ${new Date().toISOString().slice(0, 10)}`);
  console.log(`${"═".repeat(70)}\n`);

  // ── Phase A ────────────────────────────────────────────────────────────────
  const entities = await enumerateEntities(supabase);
  const populations: Record<EntityType, number> = { boss: 0, quest: 0, item: 0, puzzle: 0 };
  for (const e of entities) populations[e.type]++;

  // ── Phase B ────────────────────────────────────────────────────────────────
  const sampled = sampleEntities(entities, args.seed);
  console.log("\n[breadth] Sampling plan:");
  for (const t of TARGET_TYPES) {
    const sz = sampled.get(t)!.length;
    const rule = SAMPLE_RULES[t];
    const tag = rule.full ? "[full]" : `[${(rule.pct * 100).toFixed(0)}%, clamp ${rule.min}-${rule.max}]`;
    console.log(`  ${t.padEnd(6)} ${sz}/${populations[t]} ${tag}`);
  }

  // ── Dry-run path ───────────────────────────────────────────────────────────
  if (args.dryRun) {
    console.log("\n[breadth] First 10 queries per type:");
    for (const t of TARGET_TYPES) {
      console.log(`\n  ─── ${t} (${sampled.get(t)!.length} sampled) ───`);
      for (const e of sampled.get(t)!.slice(0, 10)) {
        const q = makeQuery(t, e.entity_name);
        console.log(`    [${e.chunk_count} chunks]  ${q}`);
      }
    }
    console.log("\n[breadth] DRY RUN — no embeddings, no DB calls beyond enumeration.");
    return;
  }

  // ── Phase C: build full query list ─────────────────────────────────────────
  const queries: { entity: Entity; query: string; sample_index: number }[] = [];
  let idx = 0;
  for (const t of TARGET_TYPES) {
    for (const e of sampled.get(t)!) {
      queries.push({ entity: e, query: makeQuery(t, e.entity_name), sample_index: idx++ });
    }
  }
  console.log(`\n[breadth] Built ${queries.length} queries.`);

  // ── Phase D: batch-embed all queries ───────────────────────────────────────
  console.log(`[breadth] Embedding queries (batch=${VOYAGE_BATCH_SIZE})...`);
  const t0 = Date.now();
  const embeddings: number[][] = new Array(queries.length);
  for (let i = 0; i < queries.length; i += VOYAGE_BATCH_SIZE) {
    const slice = queries.slice(i, i + VOYAGE_BATCH_SIZE);
    const embs = await embedBatch(slice.map(q => q.query));
    for (let j = 0; j < embs.length; j++) embeddings[i + j] = embs[j];
    process.stdout.write(`\r[breadth]   embedded ${Math.min(i + VOYAGE_BATCH_SIZE, queries.length)}/${queries.length}`);
  }
  process.stdout.write("\n");

  // ── Phase E: retrieve + grade ──────────────────────────────────────────────
  console.log(`[breadth] Retrieving (concurrency=${args.concurrency})...`);
  const results: RunResult[] = await runConcurrent(
    queries.map((q, i) => ({ q, e: embeddings[i] })),
    args.concurrency,
    async ({ q, e }) => {
      const top10 = await retrieveOne(supabase, q.query, e, 10);
      // Canonical-name pass-check: match by normalized name, NOT URL set membership.
      // Earlier version used `variant_urls` which only contained URLs that survived
      // enumeration filters (phase1e queue, chunk-count [2,100], category-index list).
      // That caused false failures when retrieval returned a hit from a filtered-out
      // variant (e.g., Reed Devil top-1 = `/Reed+Devil` but variant_urls only had
      // `/Reed_Devil` because the `+`-variant was filtered out for some reason).
      // Canonical-name comparison accepts ANY URL pointing to the same entity.
      const expectedCanon = canonicalName(q.entity.source_url);
      const hits = top10.filter(c => canonicalName(c.source_url) === expectedCanon);
      const top1 = top10[0];
      return {
        seed: args.seed,
        sample_index: q.sample_index,
        entity_type: q.entity.type,
        entity_name: q.entity.entity_name,
        expected_url: q.entity.source_url,
        query: q.query,
        pass: hits.length > 0,
        top1_chunk_id: top1?.id ?? "",
        top1_url: top1?.source_url ?? "",
        top1_similarity: top1 ? Number(top1.similarity) : 0,
        count_chunks_from_expected_url_in_top10: hits.length,
        total_population: populations[q.entity.type],
        sample_size: sampled.get(q.entity.type)!.length,
      };
    },
    (done, total) => {
      if (done % 20 === 0 || done === total) {
        process.stdout.write(`\r[breadth]   retrieved ${done}/${total}`);
      }
    },
  );
  process.stdout.write("\n");
  const wallMs = Date.now() - t0;

  // ── Phase F: summary + CSV ─────────────────────────────────────────────────
  const summary: Record<EntityType, { passes: number; n: number }> = {
    boss: { passes: 0, n: 0 }, quest: { passes: 0, n: 0 },
    item: { passes: 0, n: 0 }, puzzle: { passes: 0, n: 0 },
  };
  for (const r of results) {
    summary[r.entity_type].n++;
    if (r.pass) summary[r.entity_type].passes++;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Coverage Breadth Eval — seed=${args.seed}, ${new Date().toISOString().slice(0, 10)}`);
  console.log(`${"═".repeat(70)}\n`);
  let totalPasses = 0, totalN = 0;
  for (const t of TARGET_TYPES) {
    const s = summary[t];
    const rate = s.n === 0 ? 0 : s.passes / s.n;
    const moe = moe95(s.passes, s.n);
    const tag = SAMPLE_RULES[t].full ? "[full enumeration]" : `[sampled ${s.n}/${populations[t]}]`;
    console.log(`  ${t.padEnd(8)}: ${s.passes}/${s.n}   (${(rate * 100).toFixed(1)}% ± ${(moe * 100).toFixed(1)}%)   ${tag}`);
    totalPasses += s.passes; totalN += s.n;
  }
  const overallRate = totalN === 0 ? 0 : totalPasses / totalN;
  const overallMoe = moe95(totalPasses, totalN);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  Overall : ${totalPasses}/${totalN}  (${(overallRate * 100).toFixed(1)}% ± ${(overallMoe * 100).toFixed(1)}%)`);
  console.log(`  Wall time : ${(wallMs / 1000).toFixed(1)}s`);

  // Failure sample (20)
  const fails = results.filter(r => !r.pass);
  if (fails.length > 0) {
    console.log(`\n  Failure sample (${Math.min(20, fails.length)} of ${fails.length}):`);
    console.log(`    ${"type".padEnd(7)}${"entity".padEnd(40)}  top1_url`);
    for (const f of fails.slice(0, 20)) {
      const top1 = f.top1_url.replace(/^https?:\/\/[^/]+\//, "").substring(0, 50);
      console.log(`    ${f.entity_type.padEnd(7)}${f.entity_name.substring(0, 38).padEnd(40)}  ${top1}`);
    }
  }

  // Failure-pattern analysis: top destinations of wrong answers
  if (fails.length > 0) {
    const destCount = new Map<string, number>();
    for (const f of fails) {
      const slug = f.top1_url.replace(/^https?:\/\/[^/]+\//, "");
      destCount.set(slug, (destCount.get(slug) ?? 0) + 1);
    }
    const topDest = [...destCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`\n  Top destinations of wrong-rank-1 (top 10):`);
    for (const [slug, n] of topDest) console.log(`    ${n.toString().padStart(4)}  ${slug.substring(0, 70)}`);
  }

  // CSV
  const header = ["seed","sample_index","entity_type","entity_name","expected_url","query","pass","top1_chunk_id","top1_url","top1_similarity","count_chunks_from_expected_url_in_top10","total_population","sample_size"];
  const rows = [header.map(csvEscape).join(",")];
  for (const r of results) {
    rows.push([r.seed, r.sample_index, r.entity_type, r.entity_name, r.expected_url, r.query, r.pass, r.top1_chunk_id, r.top1_url, r.top1_similarity.toFixed(4), r.count_chunks_from_expected_url_in_top10, r.total_population, r.sample_size].map(csvEscape).join(","));
  }
  fs.writeFileSync(args.out, rows.join("\r\n") + "\r\n", "utf-8");
  console.log(`\n  CSV written: ${args.out}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
