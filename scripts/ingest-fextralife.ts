/**
 * Fextralife Wiki Ingestion Script
 *
 * Crawls the Crimson Desert Fextralife wiki, extracts content from each page,
 * chunks it by section, generates Voyage AI embeddings, and upserts into Supabase.
 *
 * Usage:
 *   npx tsx scripts/ingest-fextralife.ts                    # Ingest all categories
 *   npx tsx scripts/ingest-fextralife.ts --category abyss-gear
 *   npx tsx scripts/ingest-fextralife.ts --dry-run           # Preview without inserting
 *   npx tsx scripts/ingest-fextralife.ts --deep              # Follow links 2 levels deep
 *   npx tsx scripts/ingest-fextralife.ts --changed-only      # Skip pages with unchanged content
 *   npx tsx scripts/ingest-fextralife.ts --deep --changed-only  # Deep + skip unchanged
 *
 * Requires env vars (from .env.local locally, or process.env in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY
 *   (Uses service role key — anon key cannot write to knowledge_chunks per RLS)
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ===== ENV SETUP =====
// Supports both local (.env.local) and CI (process.env / GitHub Actions secrets)
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
const supabase = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);
const VOYAGE_KEY = getEnv("VOYAGE_API_KEY");
const BASE_URL = "https://crimsondesert.wiki.fextralife.com";

// ===== CONTENT HASHING =====
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ===== RATE LIMITING =====
const DELAY_MS = 800; // 800ms between requests — polite but faster than 1.5s
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ===== CATEGORY DEFINITIONS =====
interface Category {
  name: string;
  indexPath: string;
  contentType: string;
  spoilerLevel: number;
}

const CATEGORIES: Category[] = [
  // Core combat/story content
  { name: "bosses",      indexPath: "/Bosses",           contentType: "boss",        spoilerLevel: 2 },
  { name: "enemies",     indexPath: "/Enemies",           contentType: "boss",        spoilerLevel: 1 },
  { name: "quests",      indexPath: "/Quests",            contentType: "quest",       spoilerLevel: 3 },
  { name: "walkthrough", indexPath: "/Walkthrough",       contentType: "quest",       spoilerLevel: 3 },

  // Equipment — all sub-types crawled explicitly for completeness
  { name: "weapons",     indexPath: "/Weapons",           contentType: "item",        spoilerLevel: 1 },
  { name: "armor",       indexPath: "/Armor",             contentType: "item",        spoilerLevel: 1 },
  { name: "abyss-gear",  indexPath: "/Abyss+Gear",        contentType: "item",        spoilerLevel: 2 }, // was missing!
  { name: "accessories", indexPath: "/Accessories",       contentType: "item",        spoilerLevel: 1 },

  // Items
  { name: "items",       indexPath: "/Items",             contentType: "item",        spoilerLevel: 1 },
  { name: "collectibles",indexPath: "/Collectibles",      contentType: "item",        spoilerLevel: 1 }, // was missing!
  { name: "key-items",   indexPath: "/Key+Items",         contentType: "item",        spoilerLevel: 2 }, // was missing!

  // World / characters
  { name: "locations",   indexPath: "/Locations",         contentType: "exploration", spoilerLevel: 1 },
  { name: "characters",  indexPath: "/Characters",        contentType: "character",   spoilerLevel: 2 },
  { name: "npcs",        indexPath: "/NPCs",              contentType: "character",   spoilerLevel: 1 }, // was missing!

  // Systems
  { name: "skills",      indexPath: "/Skills",            contentType: "mechanic",    spoilerLevel: 1 },
  { name: "crafting",    indexPath: "/Crafting+Guide",    contentType: "recipe",      spoilerLevel: 1 },
  { name: "guides",      indexPath: "/Guides+%26+Walkthrough", contentType: "mechanic", spoilerLevel: 1 },

  // Challenges — 5 tabs (Exploration, Mastery, Combat, Life, Minigame), 78 challenge pages
  { name: "challenges",  indexPath: "/Challenges",        contentType: "mechanic",    spoilerLevel: 2 },

  // Beginner / mechanic guide pages — high-value for common player questions
  { name: "beginner-guides", indexPath: "/New+Player+Help",      contentType: "mechanic", spoilerLevel: 1 },
  { name: "grappling",       indexPath: "/Grappling",            contentType: "mechanic", spoilerLevel: 1 },
  { name: "game-progress",   indexPath: "/Game+Progress+Route",  contentType: "mechanic", spoilerLevel: 2 },
];

// ===== HTML PARSING =====

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, "\n\n### ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<th[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\|[\s|]+\|/g, " ")
    .replace(/\|\s*\|/g, " ")
    .replace(/^\s*\|\s*/gm, "")
    .replace(/\s*\|\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractMainContent(html: string): string {
  // Strategy: find the start of wiki content, then grab everything until a known end marker.
  // The old lazy regex ([\s\S]*?) stopped at the first </div></div>, missing sections
  // like "Where to Find" that come later in the page.

  // Step 1: Find the start of the content block
  const startMarkers = [
    /(<div[^>]*id="wiki-content-block"[^>]*>)/i,
    /(<div[^>]*class="[^"]*wiki-content[^"]*"[^>]*>)/i,
    /(<div[^>]*id="tagged-pages-container"[^>]*>)/i,
    /(<div[^>]*class="[^"]*col-sm-9[^"]*"[^>]*>)/i,
  ];

  let startIdx = -1;
  for (const marker of startMarkers) {
    const match = html.match(marker);
    if (match && match.index !== undefined) {
      startIdx = match.index + match[0].length;
      break;
    }
  }

  if (startIdx === -1) {
    // Last resort: strip the whole page
    return stripHtml(html);
  }

  // Step 2: Find the end — cut before sidebar, footer, comments, or related pages
  const endMarkers = [
    /<!-- end wiki content -->/i,
    /<div[^>]*class="[^"]*side-bar-right[^"]*"/i,
    /<div[^>]*id="fxt-footer"/i,
    /<footer/i,
    /<div[^>]*class="[^"]*comments-section[^"]*"/i,
    /<div[^>]*id="wiki-comments"/i,
    /<div[^>]*class="[^"]*related-pages[^"]*"/i,
    /<div[^>]*class="[^"]*tagged-pages[^"]*"/i,
  ];

  let endIdx = html.length;
  for (const marker of endMarkers) {
    const match = html.substring(startIdx).match(marker);
    if (match && match.index !== undefined) {
      const candidateEnd = startIdx + match.index;
      if (candidateEnd < endIdx) {
        endIdx = candidateEnd;
      }
    }
  }

  const contentHtml = html.substring(startIdx, endIdx);
  return stripHtml(contentHtml);
}

function extractPageTitle(html: string): string {
  const titleMatch =
    html.match(/<h1[^>]*class="[^"]*wiki-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return stripHtml(titleMatch[1]).replace(/ \| Crimson Desert Wiki/i, "").trim();
  }
  return "Unknown";
}

// Pages that are pure navigation/index — never crawl as content pages
// Only truly empty navigation/index pages that have no useful content
const NAV_PAGES = new Set([
  "/Crimson+Desert+Wiki",    // Wiki homepage — just links
  "/General+Information",    // Pure nav hub
  "/Equipment",              // Pure index listing sub-categories
  "/World+Information",      // Pure nav hub
  "/Character+Information",  // Pure nav hub
  "/Interactive+Map",        // Embedded widget, not text content
  "/todo",                   // Internal wiki page
  // Category index pages — we crawl these as entry points but not as content targets
  "/Bosses", "/Quests", "/Weapons", "/Armor", "/Abyss+Gear",
  "/Skills", "/Items", "/Locations", "/Characters", "/Walkthrough",
  "/Guides+%26+Walkthrough", "/Enemies", "/Crafting+Guide",
  "/NPCs", "/Collectibles", "/Key+Items", "/Accessories",
  "/Challenges",
  // Note: /Grappling, /New+Player+Help, /Game+Progress+Route are NOT excluded —
  // they are real content pages added as beginner-guides/grappling/game-progress categories
]);

function extractLinks(html: string, currentPath: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  // Strip nav chrome before scanning for links
  const contentArea = html
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<div[^>]*id="sidebar"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<div[^>]*class="[^"]*sidebar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<div[^>]*id="fxt-footer"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*class="[^"]*navbar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  const linkRegex = /href="(\/[^"]+)"/g;
  let match;
  while ((match = linkRegex.exec(contentArea)) !== null) {
    const href = match[1];
    if (
      href.startsWith("/") &&
      !href.includes(".") &&
      !href.startsWith("/file") &&
      !href.includes("#") &&
      href !== currentPath &&
      href !== "/" &&
      !href.startsWith("/search") &&
      !href.startsWith("/login") &&
      !href.startsWith("/register") &&
      !href.startsWith("/profile") &&
      !NAV_PAGES.has(href) &&
      !seen.has(href)
    ) {
      seen.add(href);
      links.push(href);
    }
  }

  return links;
}

// ===== CHUNKING =====

// Chunk size tuning:
//   CHUNK_SPLIT_AT  — sections longer than this get split into sub-chunks
//   CHUNK_TARGET    — aim for this many chars per sub-chunk
//   CHUNK_OVERLAP   — chars carried forward between adjacent sub-chunks (intra-section)
//   INTER_OVERLAP   — chars from end of previous section prepended to next section's first chunk
const CHUNK_SPLIT_AT  = 800;
const CHUNK_TARGET    = 500;
const CHUNK_OVERLAP   = 150;
const INTER_OVERLAP   = 120;
const MIN_CHUNK_LEN   = 150; // Filter out boilerplate / nav fragments

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

/**
 * Split a long text block into overlapping sub-chunks.
 * Tries to break at paragraph → sentence → line → word boundaries.
 */
function splitWithOverlap(text: string): string[] {
  const result: string[] = [];
  let start = 0;

  while (start < text.length) {
    // Remaining text fits in one chunk
    if (text.length - start <= CHUNK_SPLIT_AT) {
      const tail = text.slice(start).trim();
      if (tail.length >= MIN_CHUNK_LEN) result.push(tail);
      break;
    }

    // Search for a natural break between 50% and 100% of CHUNK_TARGET
    const searchFrom = start + Math.floor(CHUNK_TARGET * 0.5);
    const searchTo   = Math.min(start + CHUNK_SPLIT_AT, text.length);
    const window     = text.slice(searchFrom, searchTo);

    // Priority: paragraph > sentence end > newline > word boundary
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

    // Step back by CHUNK_OVERLAP for the next window (snap to word boundary)
    const rawNext = end - CHUNK_OVERLAP;
    const spaceIdx = text.indexOf(" ", rawNext);
    start = spaceIdx > rawNext && spaceIdx < end ? spaceIdx + 1 : end;
  }

  return result;
}

/**
 * Return the last ~INTER_OVERLAP chars of a section, snapped to a word/sentence
 * boundary, for use as an inter-section overlap prefix.
 */
function sectionTail(text: string): string {
  if (text.length <= INTER_OVERLAP) return text.trim();
  const tail = text.slice(-INTER_OVERLAP);
  // Start at a word boundary so we don't begin mid-word
  const spaceIdx = tail.indexOf(" ");
  return (spaceIdx >= 0 && spaceIdx < INTER_OVERLAP * 0.4)
    ? tail.slice(spaceIdx + 1).trim()
    : tail.trim();
}

function makeChunkMeta(
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

  // Short / unsectioned pages → single chunk (possibly split if large)
  const sections = text.split(/\n(?=### )/);
  const isSingleSection = sections.length <= 1;

  if (isSingleSection) {
    if (text.length < MIN_CHUNK_LEN) return chunks;
    if (text.length <= CHUNK_SPLIT_AT) {
      chunks.push(makeChunkMeta(text, pageTitle, pageUrl, category, text));
    } else {
      for (const sub of splitWithOverlap(text)) {
        chunks.push(makeChunkMeta(sub, pageTitle, pageUrl, category, sub));
      }
    }
    return chunks;
  }

  // Multi-section pages — process each section, with inter-section overlap
  let prevTail = "";

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (section.length < MIN_CHUNK_LEN) continue;

    // Build the prefix: page title + optional tail from previous section
    const interOverlapPrefix = prevTail ? `[...] ${prevTail}\n\n` : "";

    if (section.length <= CHUNK_SPLIT_AT) {
      // Short section — single chunk, prepend inter-overlap on first sub-chunk only
      const content = `${interOverlapPrefix}${section}`;
      chunks.push(makeChunkMeta(content, pageTitle, pageUrl, category, section));
    } else {
      // Long section — split into overlapping sub-chunks
      const subChunks = splitWithOverlap(section);
      for (let j = 0; j < subChunks.length; j++) {
        // Only the first sub-chunk of a section gets the inter-overlap prefix
        const content = j === 0 ? `${interOverlapPrefix}${subChunks[j]}` : subChunks[j];
        chunks.push(makeChunkMeta(content, pageTitle, pageUrl, category, subChunks[j]));
      }
    }

    prevTail = sectionTail(section);
  }

  return chunks;
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
    if (lower.includes(r)) return r.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return null;
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
      for (const item of data.data) {
        allEmbeddings.push(item.embedding);
      }
    } catch (e) {
      console.error("  Embedding error:", e);
      allEmbeddings.push(...batch.map(() => null));
    }

    if (i + batchSize < texts.length) await sleep(500);
  }

  return allEmbeddings;
}

// ===== FETCH =====

async function fetchPage(pagePath: string): Promise<string | null> {
  const url = `${BASE_URL}${pagePath}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "CrimsonDesertGuide/1.0 (game-guide-bot; +https://github.com/williampowerplay-maker/crimson-guide)",
      },
    });
    if (!res.ok) {
      console.error(`  HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error(`  Fetch error for ${url}:`, e);
    return null;
  }
}

// ===== MAIN INGESTION =====

async function ingestCategory(category: Category, dryRun: boolean, deep: boolean, changedOnly: boolean) {
  console.log(`\n========== ${category.name.toUpperCase()} ==========`);
  console.log(`Index: ${BASE_URL}${category.indexPath}${deep ? " (deep)" : ""}${changedOnly ? " (changed-only)" : ""}`);

  // Step 1: Fetch index page
  const indexHtml = await fetchPage(category.indexPath);
  if (!indexHtml) {
    console.error("  Failed to fetch index page. Skipping.");
    return;
  }

  // BFS crawl queue — level 1 links come from the index page
  const level1Links = extractLinks(indexHtml, category.indexPath);
  console.log(`  Found ${level1Links.length} level-1 pages`);

  // Collect all pages to crawl (deduplicated)
  const allLinks = new Set<string>(level1Links);

  // Chunk the index page itself
  const indexContent = extractMainContent(indexHtml);
  const indexTitle = extractPageTitle(indexHtml);
  const allChunks: Chunk[] = chunkPageContent(
    indexContent,
    indexTitle,
    `${BASE_URL}${category.indexPath}`,
    category
  );

  // Load existing hashes for changed-only mode
  const existingHashes = new Map<string, string>();
  if (changedOnly) {
    const { data: hashRows } = await supabase
      .from("page_hashes")
      .select("url, content_hash")
      .eq("category", category.name);
    for (const row of hashRows || []) {
      existingHashes.set(row.url, row.content_hash);
    }
    console.log(`  Loaded ${existingHashes.size} existing hashes`);
  }

  // Track new hashes to upsert after ingest
  const newHashes: { url: string; content_hash: string; category: string; last_checked_at: string; last_changed_at: string }[] = [];
  const now = new Date().toISOString();

  // Step 2: Crawl level-1 pages; optionally collect level-2 links
  const level2Links = new Set<string>();
  let crawled = 0;
  let skipped = 0;
  const level1Array = Array.from(allLinks);

  for (const link of level1Array) {
    await sleep(DELAY_MS);
    crawled++;
    process.stdout.write(`  [${crawled}/${level1Array.length}] ${link}...`);

    const html = await fetchPage(link);
    if (!html) { console.log(" FAILED"); continue; }

    const content = extractMainContent(html);
    const title = extractPageTitle(html);
    if (content.length < 100) { console.log(" too short, skipping"); continue; }

    const pageUrl = `${BASE_URL}${link}`;
    const hash = hashContent(content);
    const prevHash = existingHashes.get(pageUrl);

    // In changed-only mode, skip pages whose content hash hasn't changed
    if (changedOnly && prevHash === hash) {
      newHashes.push({ url: pageUrl, content_hash: hash, category: category.name, last_checked_at: now, last_changed_at: now });
      console.log(" unchanged, skipping");
      skipped++;
      // Still collect deep links even for skipped pages
      if (deep) {
        for (const ol of extractLinks(html, link)) {
          if (!allLinks.has(ol)) { allLinks.add(ol); level2Links.add(ol); }
        }
      }
      continue;
    }

    const chunks = chunkPageContent(content, title, pageUrl, category);
    allChunks.push(...chunks);
    newHashes.push({ url: pageUrl, content_hash: hash, category: category.name, last_checked_at: now, last_changed_at: now });

    if (deep) {
      const outLinks = extractLinks(html, link);
      let newLinks = 0;
      for (const ol of outLinks) {
        if (!allLinks.has(ol)) { allLinks.add(ol); level2Links.add(ol); newLinks++; }
      }
      console.log(` ${chunks.length} chunks (+${newLinks} new links)`);
    } else {
      console.log(` ${chunks.length} chunks`);
    }
  }

  if (changedOnly) console.log(`  Skipped ${skipped} unchanged pages`);

  // Step 3: Crawl level-2 pages (deep mode only)
  if (deep && level2Links.size > 0) {
    console.log(`\n  --- Level 2: ${level2Links.size} additional pages ---`);
    const level2Array = Array.from(level2Links);
    let l2Crawled = 0;

    for (const link of level2Array) {
      await sleep(DELAY_MS);
      l2Crawled++;
      process.stdout.write(`  [L2 ${l2Crawled}/${level2Array.length}] ${link}...`);

      const html = await fetchPage(link);
      if (!html) { console.log(" FAILED"); continue; }

      const content = extractMainContent(html);
      const title = extractPageTitle(html);
      if (content.length < 100) { console.log(" too short, skipping"); continue; }

      const pageUrl = `${BASE_URL}${link}`;
      const hash = hashContent(content);
      const prevHash = existingHashes.get(pageUrl);

      if (changedOnly && prevHash === hash) {
        newHashes.push({ url: pageUrl, content_hash: hash, category: category.name, last_checked_at: now, last_changed_at: now });
        console.log(" unchanged, skipping");
        skipped++;
        continue;
      }

      const chunks = chunkPageContent(content, title, pageUrl, category);
      allChunks.push(...chunks);
      newHashes.push({ url: pageUrl, content_hash: hash, category: category.name, last_checked_at: now, last_changed_at: now });
      console.log(` ${chunks.length} chunks`);
    }
  }

  console.log(`\n  Total chunks for ${category.name}: ${allChunks.length}`);

  if (dryRun) {
    console.log("  [DRY RUN] Skipping database insert");
    if (allChunks.length > 0) {
      console.log("\n  --- Sample chunk ---");
      console.log(`  ${allChunks[0].content.slice(0, 200)}...`);
      console.log(`  content_type: ${allChunks[0].content_type}`);
      console.log(`  source: ${allChunks[0].source_url}`);
    }
    return;
  }

  // Step 4: Delete existing chunks for this category's URLs (idempotent re-runs)
  console.log("  Clearing old chunks for this category...");
  const sourceUrls = [...new Set(allChunks.map(c => c.source_url))];
  // Delete in batches of 50 URLs
  for (let i = 0; i < sourceUrls.length; i += 50) {
    const batch = sourceUrls.slice(i, i + 50);
    await supabase.from("knowledge_chunks").delete().in("source_url", batch);
  }

  // Step 5: Generate embeddings
  console.log("  Generating embeddings...");
  const embeddings = await generateEmbeddings(allChunks.map((c) => c.content));

  // Step 6: Insert in batches of 50
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

  // Step 7: Upsert page hashes so next run knows what changed
  if (newHashes.length > 0) {
    console.log(`  Saving ${newHashes.length} page hashes...`);
    for (let i = 0; i < newHashes.length; i += 50) {
      await supabase.from("page_hashes").upsert(newHashes.slice(i, i + 50), { onConflict: "url" });
    }
  }
}

// ===== CLI =====

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const deep = args.includes("--deep");
  const changedOnly = args.includes("--changed-only");
  const categoryFlag = args.indexOf("--category");
  const targetCategory = categoryFlag >= 0 ? args[categoryFlag + 1] : null;

  console.log("Fextralife Wiki Ingestion Script");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Depth: ${deep ? "2 levels (following in-page links)" : "1 level (index links only)"}`);
  console.log(`Changed-only: ${changedOnly ? "YES (skip unchanged pages)" : "NO (re-ingest all pages)"}`);
  console.log(`Target: ${targetCategory || "ALL categories"}`);
  console.log(`Delay between requests: ${DELAY_MS}ms`);
  console.log(`\nCategories: ${CATEGORIES.map(c => c.name).join(", ")}`);

  const categories = targetCategory
    ? CATEGORIES.filter((c) => c.name === targetCategory)
    : CATEGORIES;

  if (categories.length === 0) {
    console.error(`Unknown category: ${targetCategory}`);
    console.log("Available:", CATEGORIES.map((c) => c.name).join(", "));
    process.exit(1);
  }

  for (const category of categories) {
    await ingestCategory(category, dryRun, deep, changedOnly);
  }

  console.log("\n========== COMPLETE ==========");
}

main().catch(console.error);
