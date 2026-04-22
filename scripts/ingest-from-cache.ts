/**
 * Cache-based Ingestion — Phase 2 of 2-phase ingest pipeline
 *
 * Reads pre-crawled wiki pages from wiki-cache/ (written by crawl-wiki.ts),
 * chunks them, generates Voyage AI embeddings, and upserts to Supabase.
 *
 * Run crawl-wiki.ts first to populate the cache, then run this script.
 *
 * Benefits vs crawl+ingest in one shot:
 *   - Tweak chunking logic → re-run this script only (no wiki hits, no wait)
 *   - --changed-only re-embeds only pages whose cached text changed since last ingest
 *   - Zero network dependency on the wiki — works offline once cache is populated
 *
 * Usage:
 *   npx tsx scripts/ingest-from-cache.ts                         # All categories
 *   npx tsx scripts/ingest-from-cache.ts --category bosses       # One category
 *   npx tsx scripts/ingest-from-cache.ts --changed-only          # Only changed pages
 *   npx tsx scripts/ingest-from-cache.ts --dry-run               # Preview chunks, no DB writes
 *   npx tsx scripts/ingest-from-cache.ts --dry-run --category weapons
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY
 *   (Uses service role key — anon key cannot write to knowledge_chunks per RLS)
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

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

// SECURITY: Ingest scripts must use the service role key — anon key cannot
// INSERT/DELETE on knowledge_chunks (RLS restricts writes to service_role).
// SUPABASE_SERVICE_ROLE_KEY is in .env.local and never committed.
const supabase = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);
const VOYAGE_KEY = getEnv("VOYAGE_API_KEY");

const CACHE_DIR = path.join(__dirname, "..", "wiki-cache");
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");
// Tracks which content hashes have already been embedded/ingested
const INGEST_STATE_PATH = path.join(CACHE_DIR, "ingest-state.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ===== CATEGORY DEFINITIONS =====
// Must stay in sync with crawl-wiki.ts
interface Category {
  name: string;
  indexPath: string;
  contentType: string;
  spoilerLevel: number;
}

const CATEGORIES: Category[] = [
  // ── Fextralife wiki categories ──────────────────────────────────────────
  { name: "bosses",           indexPath: "/Bosses",                 contentType: "boss",        spoilerLevel: 2 },
  { name: "enemies",          indexPath: "/Enemies",                contentType: "boss",        spoilerLevel: 1 },
  { name: "quests",           indexPath: "/Quests",                 contentType: "quest",       spoilerLevel: 3 },
  { name: "walkthrough",      indexPath: "/Walkthrough",            contentType: "quest",       spoilerLevel: 3 },
  { name: "weapons",          indexPath: "/Weapons",                contentType: "item",        spoilerLevel: 1 },
  { name: "armor",            indexPath: "/Armor",                  contentType: "item",        spoilerLevel: 1 },
  { name: "abyss-gear",       indexPath: "/Abyss+Gear",             contentType: "item",        spoilerLevel: 2 },
  { name: "accessories",      indexPath: "/Accessories",            contentType: "item",        spoilerLevel: 1 },
  { name: "items",            indexPath: "/Items",                  contentType: "item",        spoilerLevel: 1 },
  { name: "collectibles",     indexPath: "/Collectibles",           contentType: "item",        spoilerLevel: 1 },
  { name: "key-items",        indexPath: "/Key+Items",              contentType: "item",        spoilerLevel: 2 },
  { name: "locations",        indexPath: "/Locations",              contentType: "exploration", spoilerLevel: 1 },
  { name: "characters",       indexPath: "/Characters",             contentType: "character",   spoilerLevel: 2 },
  { name: "npcs",             indexPath: "/NPCs",                   contentType: "character",   spoilerLevel: 1 },
  { name: "skills",           indexPath: "/Skills",                 contentType: "mechanic",    spoilerLevel: 1 },
  { name: "crafting",         indexPath: "/Crafting+Guide",         contentType: "recipe",      spoilerLevel: 1 },
  { name: "guides",           indexPath: "/Guides+%26+Walkthrough", contentType: "mechanic",    spoilerLevel: 1 },
  { name: "challenges",       indexPath: "/Challenges",             contentType: "mechanic",    spoilerLevel: 2 },
  // ── Game8.co guide categories (puzzle/mechanic/strategy content) ────────
  { name: "game8-puzzles",    indexPath: "",                        contentType: "puzzle",      spoilerLevel: 2 },
  { name: "game8-bosses",     indexPath: "",                        contentType: "boss",        spoilerLevel: 2 },
  { name: "game8-walkthrough",indexPath: "",                        contentType: "quest",       spoilerLevel: 3 },
  { name: "game8-guides",     indexPath: "",                        contentType: "mechanic",    spoilerLevel: 1 },
  { name: "game8-tier-lists", indexPath: "",                        contentType: "mechanic",    spoilerLevel: 1 },
  { name: "game8-weapons",    indexPath: "",                        contentType: "item",        spoilerLevel: 1 },
  { name: "game8-armor",      indexPath: "",                        contentType: "item",        spoilerLevel: 1 },
  { name: "game8-accessories",indexPath: "",                        contentType: "item",        spoilerLevel: 1 },
  { name: "game8-abyss",      indexPath: "",                        contentType: "item",        spoilerLevel: 2 },
  { name: "game8-skills",     indexPath: "",                        contentType: "mechanic",    spoilerLevel: 1 },
  { name: "game8-crafting",   indexPath: "",                        contentType: "recipe",      spoilerLevel: 1 },
  { name: "game8-items",      indexPath: "",                        contentType: "item",        spoilerLevel: 1 },
  { name: "game8-locations",  indexPath: "",                        contentType: "exploration", spoilerLevel: 1 },
  { name: "game8-characters", indexPath: "",                        contentType: "character",   spoilerLevel: 2 },
  { name: "game8-challenges", indexPath: "",                        contentType: "mechanic",    spoilerLevel: 2 },
];

// ===== CHUNKING =====

const CHUNK_SPLIT_AT = 800;
const CHUNK_TARGET   = 500;
const CHUNK_OVERLAP  = 150;
const INTER_OVERLAP  = 120;
const MIN_CHUNK_LEN  = 150;

interface Chunk {
  content: string;
  source_url: string;
  source_type: string;
  quest_name: string | null;
  content_type: string;
  character: string | null;
  region: string | null;
  chapter: string | null;
  spoiler_level: number;
}

function splitWithOverlap(text: string): string[] {
  const result: string[] = [];
  let start = 0;

  while (start < text.length) {
    if (text.length - start <= CHUNK_SPLIT_AT) {
      const tail = text.slice(start).trim();
      if (tail.length >= MIN_CHUNK_LEN) result.push(tail);
      break;
    }

    const searchFrom = start + Math.floor(CHUNK_TARGET * 0.5);
    const searchTo   = Math.min(start + CHUNK_SPLIT_AT, text.length);
    const window     = text.slice(searchFrom, searchTo);

    let breakOffset = -1;
    const para = window.indexOf("\n\n");
    if (para >= 0) {
      breakOffset = para + 2;
    } else {
      const sent = window.search(/[.!?]\s/);
      if (sent >= 0 && sent <= Math.floor(window.length * 0.9)) {
        breakOffset = sent + 2;
      } else {
        const line = window.lastIndexOf("\n");
        if (line >= 0) {
          breakOffset = line + 1;
        } else {
          const space = window.lastIndexOf(" ");
          breakOffset = space >= 0 ? space + 1 : window.length;
        }
      }
    }

    const end = searchFrom + breakOffset;
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_LEN) result.push(chunk);

    const rawNext = end - CHUNK_OVERLAP;
    const spaceIdx = text.indexOf(" ", rawNext);
    start = spaceIdx > rawNext && spaceIdx < end ? spaceIdx + 1 : end;
  }

  return result;
}

function sectionTail(text: string): string {
  if (text.length <= INTER_OVERLAP) return text.trim();
  const tail = text.slice(-INTER_OVERLAP);
  const spaceIdx = tail.indexOf(" ");
  return spaceIdx >= 0 && spaceIdx < INTER_OVERLAP * 0.4
    ? tail.slice(spaceIdx + 1).trim()
    : tail.trim();
}

// ===== METADATA DETECTION =====

const CHARACTERS = ["kliff", "damiane", "oongka"];
function detectCharacter(text: string): string | null {
  const lower = text.toLowerCase();
  for (const c of CHARACTERS) {
    if (lower.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return null;
}

const REGIONS = [
  "hernand", "pailune", "frozen soul", "karin", "goldleaf",
  "starfall", "windhill", "greymane", "serendia", "calpheon",
  "drieghan", "kamasylvia", "abyss nexus",
];
function detectRegion(text: string): string | null {
  const lower = text.toLowerCase();
  for (const r of REGIONS) {
    if (lower.includes(r))
      return r.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return null;
}

function makeChunk(
  content: string,
  pageTitle: string,
  pageUrl: string,
  category: Category,
  rawText: string
): Chunk {
  return {
    content: `${pageTitle}\n\n${content}`.slice(0, 4000),
    source_url: pageUrl,
    source_type: "fextralife_wiki",
    quest_name: ["quest", "boss"].includes(category.contentType) ? pageTitle : null,
    content_type: category.contentType,
    character: detectCharacter(rawText),
    region: detectRegion(rawText),
    chapter: null,
    spoiler_level: category.spoilerLevel,
  };
}

function chunkPageContent(
  text: string,
  pageTitle: string,
  pageUrl: string,
  category: Category
): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = text.split(/\n(?=### )/);
  const isSingleSection = sections.length <= 1;

  if (isSingleSection) {
    if (text.length < MIN_CHUNK_LEN) return chunks;
    if (text.length <= CHUNK_SPLIT_AT) {
      chunks.push(makeChunk(text, pageTitle, pageUrl, category, text));
    } else {
      for (const sub of splitWithOverlap(text)) {
        chunks.push(makeChunk(sub, pageTitle, pageUrl, category, sub));
      }
    }
    return chunks;
  }

  let prevTail = "";
  for (const section of sections) {
    const s = section.trim();
    if (s.length < MIN_CHUNK_LEN) continue;

    const interOverlapPrefix = prevTail ? `[...] ${prevTail}\n\n` : "";

    if (s.length <= CHUNK_SPLIT_AT) {
      chunks.push(makeChunk(`${interOverlapPrefix}${s}`, pageTitle, pageUrl, category, s));
    } else {
      const subChunks = splitWithOverlap(s);
      for (let j = 0; j < subChunks.length; j++) {
        const content = j === 0 ? `${interOverlapPrefix}${subChunks[j]}` : subChunks[j];
        chunks.push(makeChunk(content, pageTitle, pageUrl, category, subChunks[j]));
      }
    }

    prevTail = sectionTail(s);
  }

  return chunks;
}

// ===== EMBEDDING =====

async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  if (!VOYAGE_KEY) {
    console.log("  No VOYAGE_API_KEY — skipping embeddings");
    return texts.map(() => null);
  }

  const batchSize = 32;
  const allEmbeddings: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3.5-lite",
          input: batch,
          input_type: "document",
        }),
      });

      if (!res.ok) {
        console.error(`  Voyage API error: ${res.status}`);
        allEmbeddings.push(...batch.map(() => null));
        continue;
      }

      const data = await res.json();
      for (const item of data.data) allEmbeddings.push(item.embedding);
    } catch (e) {
      console.error("  Embedding error:", e);
      allEmbeddings.push(...batch.map(() => null));
    }

    if (i + batchSize < texts.length) await sleep(500);
  }

  return allEmbeddings;
}

// ===== INGEST STATE =====
// Tracks which URL+contentHash combos have already been fully ingested.
// This is separate from the crawl manifest — the manifest tracks what's been crawled,
// this tracks what's been embedded + inserted into Supabase.

interface IngestStateEntry {
  url: string;
  contentHash: string;
  ingestedAt: string;
  chunkCount: number;
}

function loadIngestState(): Map<string, IngestStateEntry> {
  const map = new Map<string, IngestStateEntry>();
  if (!fs.existsSync(INGEST_STATE_PATH)) return map;
  try {
    const entries: IngestStateEntry[] = JSON.parse(fs.readFileSync(INGEST_STATE_PATH, "utf-8"));
    for (const e of entries) map.set(e.url, e);
  } catch {
    console.warn("  Warning: could not parse ingest-state.json — re-ingesting all");
  }
  return map;
}

function saveIngestState(state: Map<string, IngestStateEntry>) {
  const entries = Array.from(state.values()).sort((a, b) => a.url.localeCompare(b.url));
  fs.writeFileSync(INGEST_STATE_PATH, JSON.stringify(entries, null, 2));
}

// ===== MANIFEST =====

interface ManifestEntry {
  url: string;
  path: string;
  title: string;
  contentHash: string;
  cachedAt: string;
  category: string;
  contentType: string;
  spoilerLevel: number;
  filePath: string;
}

function loadManifest(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`ERROR: wiki-cache/manifest.json not found.`);
    console.error(`Run "npx tsx scripts/crawl-wiki.ts" first to populate the cache.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ===== INGEST CATEGORY FROM CACHE =====

async function ingestCategory(
  category: Category,
  manifest: ManifestEntry[],
  ingestState: Map<string, IngestStateEntry>,
  dryRun: boolean,
  changedOnly: boolean
) {
  console.log(`\n========== ${category.name.toUpperCase()} ==========`);

  const pages = manifest.filter((e) => e.category === category.name);
  if (pages.length === 0) {
    console.log(`  No cached pages found for "${category.name}".`);
    console.log(`  Run: npx tsx scripts/crawl-wiki.ts --category ${category.name}`);
    return;
  }

  console.log(`  ${pages.length} pages in cache`);

  // Filter to only changed pages in changed-only mode
  const toIngest = changedOnly
    ? pages.filter((p) => {
        const state = ingestState.get(p.url);
        return !state || state.contentHash !== p.contentHash;
      })
    : pages;

  if (changedOnly) {
    console.log(`  ${toIngest.length} changed/new pages to ingest (${pages.length - toIngest.length} unchanged)`);
  }

  if (toIngest.length === 0) {
    console.log("  Nothing to ingest.");
    return;
  }

  // Build chunks from cache files
  const allChunks: Chunk[] = [];
  const pageUrlsToDelete: string[] = [];
  let loadFailed = 0;

  for (const entry of toIngest) {
    const filePath = path.join(CACHE_DIR, entry.filePath);
    if (!fs.existsSync(filePath)) {
      console.warn(`  WARNING: cache file missing: ${entry.filePath} (re-run crawl-wiki.ts)`);
      loadFailed++;
      continue;
    }

    let cachedPage: { text: string; title: string };
    try {
      cachedPage = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      console.warn(`  WARNING: could not parse ${entry.filePath}`);
      loadFailed++;
      continue;
    }

    const chunks = chunkPageContent(
      cachedPage.text,
      cachedPage.title,
      entry.url,
      category
    );

    if (chunks.length > 0) {
      allChunks.push(...chunks);
      pageUrlsToDelete.push(entry.url);
    }
  }

  if (loadFailed > 0) console.warn(`  ${loadFailed} cache files missing or corrupt`);
  console.log(`  Total chunks to insert: ${allChunks.length}`);

  if (dryRun) {
    console.log("  [DRY RUN] Skipping database insert");
    if (allChunks.length > 0) {
      console.log("\n  --- Sample chunk ---");
      console.log(`  ${allChunks[0].content.slice(0, 300)}...`);
      console.log(`  content_type: ${allChunks[0].content_type}`);
      console.log(`  source: ${allChunks[0].source_url}`);
      console.log(`  spoiler_level: ${allChunks[0].spoiler_level}`);
      // Show chunk distribution
      const avgLen = Math.round(allChunks.reduce((s, c) => s + c.content.length, 0) / allChunks.length);
      console.log(`  avg chunk length: ${avgLen} chars`);
    }
    return;
  }

  // Delete old chunks for changed URLs
  if (pageUrlsToDelete.length > 0) {
    console.log(`  Clearing old chunks for ${pageUrlsToDelete.length} pages...`);
    for (let i = 0; i < pageUrlsToDelete.length; i += 50) {
      const batch = pageUrlsToDelete.slice(i, i + 50);
      await supabase.from("knowledge_chunks").delete().in("source_url", batch);
    }
  }

  // Generate embeddings
  console.log("  Generating embeddings...");
  const embeddings = await generateEmbeddings(allChunks.map((c) => c.content));

  // Insert in batches
  console.log("  Inserting to Supabase...");
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < allChunks.length; i += 50) {
    const batch = allChunks.slice(i, i + 50).map((chunk, j) => ({
      ...chunk,
      embedding: embeddings[i + j],
    }));

    const { error } = await supabase.from("knowledge_chunks").insert(batch);
    if (error) {
      console.error(`  Insert error (batch ${i}):`, error.message);
      errors++;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Done: ${inserted} inserted, ${errors} batch errors`);

  // Update ingest state so --changed-only knows what's been ingested
  const now = new Date().toISOString();

  // Count chunks per URL for state tracking
  const chunksByUrl = new Map<string, number>();
  for (const chunk of allChunks) {
    chunksByUrl.set(chunk.source_url, (chunksByUrl.get(chunk.source_url) || 0) + 1);
  }

  for (const entry of toIngest) {
    ingestState.set(entry.url, {
      url: entry.url,
      contentHash: entry.contentHash,
      ingestedAt: now,
      chunkCount: chunksByUrl.get(entry.url) || 0,
    });
  }
}

// ===== CLI =====

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const changedOnly = args.includes("--changed-only");
  const categoryFlagIdx = args.indexOf("--category");
  const targetCategory = categoryFlagIdx >= 0 ? args[categoryFlagIdx + 1] : null;

  console.log("=== Fextralife Cache Ingestion ===");
  console.log(`Mode:         ${dryRun ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`Changed-only: ${changedOnly ? "YES (skip already-ingested unchanged pages)" : "NO (re-ingest all cached pages)"}`);
  console.log(`Target:       ${targetCategory || "ALL categories"}`);
  console.log(`Cache dir:    ${CACHE_DIR}`);

  const categories = targetCategory
    ? CATEGORIES.filter((c) => c.name === targetCategory)
    : CATEGORIES;

  if (categories.length === 0) {
    console.error(`Unknown category: ${targetCategory}`);
    console.log("Available:", CATEGORIES.map((c) => c.name).join(", "));
    process.exit(1);
  }

  const manifest = loadManifest();
  console.log(`\nManifest: ${manifest.length} cached pages`);

  const ingestState = loadIngestState();
  console.log(`Ingest state: ${ingestState.size} previously ingested pages`);

  for (const category of categories) {
    await ingestCategory(category, manifest, ingestState, dryRun, changedOnly);
  }

  // Save ingest state after all categories are done
  if (!dryRun) {
    saveIngestState(ingestState);
    console.log(`\nIngest state saved: ${ingestState.size} total entries`);
  }

  console.log("\n========== INGEST COMPLETE ==========");
  console.log("\nWorkflow summary:");
  console.log("  crawl-wiki.ts       → fetches wiki pages, saves to wiki-cache/");
  console.log("  ingest-from-cache.ts → chunks + embeds + upserts from wiki-cache/");
}

main().catch(console.error);
