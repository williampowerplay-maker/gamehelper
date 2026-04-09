/**
 * Wiki Crawler — Phase 1 of 2-phase ingest pipeline
 *
 * Crawls the Crimson Desert Fextralife wiki and saves extracted page content
 * to a local `wiki-cache/` directory. No embeddings, no Supabase writes.
 *
 * Run this first, then run ingest-from-cache.ts to chunk + embed + upsert.
 *
 * Benefits of separating crawl from ingest:
 *   - Re-chunk or tweak extraction logic without re-crawling the wiki
 *   - Re-embed without hitting the wiki at all
 *   - --changed-only skips pages whose HTML content hasn't changed since last crawl
 *
 * Usage:
 *   npx tsx scripts/crawl-wiki.ts                         # Crawl all categories
 *   npx tsx scripts/crawl-wiki.ts --category bosses       # One category only
 *   npx tsx scripts/crawl-wiki.ts --deep                  # Follow links 2 levels
 *   npx tsx scripts/crawl-wiki.ts --changed-only          # Skip unchanged pages
 *   npx tsx scripts/crawl-wiki.ts --deep --changed-only   # Deep + skip unchanged
 *   npx tsx scripts/crawl-wiki.ts --dry-run               # Preview without writing
 *
 * Output structure:
 *   wiki-cache/
 *     manifest.json          — index of all cached pages + metadata
 *     pages/
 *       bosses/
 *         Griefbringer.json  — { url, title, text, contentHash, cachedAt }
 *       weapons/
 *         ...
 */

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

const BASE_URL = "https://crimsondesert.wiki.fextralife.com";
const CACHE_DIR = path.join(__dirname, "..", "wiki-cache");
const PAGES_DIR = path.join(CACHE_DIR, "pages");
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");

const DELAY_MS = 800; // polite rate limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ===== CATEGORY DEFINITIONS =====
// Mirrors ingest-from-cache.ts — keep in sync
interface Category {
  name: string;
  indexPath: string;
  contentType: string;
  spoilerLevel: number;
}

const CATEGORIES: Category[] = [
  { name: "bosses",      indexPath: "/Bosses",                contentType: "boss",        spoilerLevel: 2 },
  { name: "enemies",     indexPath: "/Enemies",               contentType: "boss",        spoilerLevel: 1 },
  { name: "quests",      indexPath: "/Quests",                contentType: "quest",       spoilerLevel: 3 },
  { name: "walkthrough", indexPath: "/Walkthrough",           contentType: "quest",       spoilerLevel: 3 },
  { name: "weapons",     indexPath: "/Weapons",               contentType: "item",        spoilerLevel: 1 },
  { name: "armor",       indexPath: "/Armor",                 contentType: "item",        spoilerLevel: 1 },
  { name: "abyss-gear",  indexPath: "/Abyss+Gear",            contentType: "item",        spoilerLevel: 2 },
  { name: "accessories", indexPath: "/Accessories",           contentType: "item",        spoilerLevel: 1 },
  { name: "items",       indexPath: "/Items",                 contentType: "item",        spoilerLevel: 1 },
  { name: "collectibles",indexPath: "/Collectibles",          contentType: "item",        spoilerLevel: 1 },
  { name: "key-items",   indexPath: "/Key+Items",             contentType: "item",        spoilerLevel: 2 },
  { name: "locations",   indexPath: "/Locations",             contentType: "exploration", spoilerLevel: 1 },
  { name: "characters",  indexPath: "/Characters",            contentType: "character",   spoilerLevel: 2 },
  { name: "npcs",        indexPath: "/NPCs",                  contentType: "character",   spoilerLevel: 1 },
  { name: "skills",      indexPath: "/Skills",                contentType: "mechanic",    spoilerLevel: 1 },
  { name: "crafting",    indexPath: "/Crafting+Guide",        contentType: "recipe",      spoilerLevel: 1 },
  { name: "guides",      indexPath: "/Guides+%26+Walkthrough",contentType: "mechanic",    spoilerLevel: 1 },
  { name: "challenges",  indexPath: "/Challenges",            contentType: "mechanic",    spoilerLevel: 2 },
];

const NAV_PAGES = new Set([
  "/Crimson+Desert+Wiki", "/General+Information", "/Equipment",
  "/World+Information", "/Character+Information", "/Interactive+Map", "/todo",
  "/Bosses", "/Quests", "/Weapons", "/Armor", "/Abyss+Gear",
  "/Skills", "/Items", "/Locations", "/Characters", "/Walkthrough",
  "/Guides+%26+Walkthrough", "/Enemies", "/Crafting+Guide",
  "/NPCs", "/Collectibles", "/Key+Items", "/Accessories", "/Challenges",
]);

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
  if (startIdx === -1) return stripHtml(html);

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
      if (candidateEnd < endIdx) endIdx = candidateEnd;
    }
  }

  return stripHtml(html.substring(startIdx, endIdx));
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

function extractLinks(html: string, currentPath: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

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

// ===== CONTENT HASHING =====
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ===== CACHE =====

interface CachedPage {
  url: string;           // Full URL e.g. https://crimsondesert.wiki.fextralife.com/Griefbringer
  path: string;          // Wiki path e.g. /Griefbringer
  title: string;
  text: string;          // Extracted + stripped content (ready for chunking)
  contentHash: string;   // sha256 of text, 16 chars
  cachedAt: string;      // ISO timestamp
  category: string;      // e.g. "bosses"
  contentType: string;   // e.g. "boss"
  spoilerLevel: number;
}

interface ManifestEntry {
  url: string;
  path: string;
  title: string;
  contentHash: string;
  cachedAt: string;
  category: string;
  contentType: string;
  spoilerLevel: number;
  filePath: string;      // relative path within wiki-cache/pages/
}

function loadManifest(): Map<string, ManifestEntry> {
  const map = new Map<string, ManifestEntry>();
  if (!fs.existsSync(MANIFEST_PATH)) return map;
  try {
    const entries: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
    for (const entry of entries) map.set(entry.url, entry);
  } catch {
    console.warn("  Warning: could not parse manifest.json — starting fresh");
  }
  return map;
}

function saveManifest(manifest: Map<string, ManifestEntry>) {
  const entries = Array.from(manifest.values()).sort((a, b) =>
    a.category.localeCompare(b.category) || a.url.localeCompare(b.url)
  );
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2));
}

function savePage(page: CachedPage, dryRun: boolean): string {
  // Convert wiki path to a safe filename: /Feather+of+the+Earth → Feather+of+the+Earth.json
  const slug = page.path.replace(/^\//, "").replace(/[<>:"/\\|?*]/g, "_");
  const categoryDir = path.join(PAGES_DIR, page.category);
  const filePath = path.join(categoryDir, `${slug}.json`);
  const relativePath = path.relative(CACHE_DIR, filePath);

  if (!dryRun) {
    fs.mkdirSync(categoryDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(page, null, 2));
  }

  return relativePath;
}

// ===== FETCH =====

async function fetchPage(pagePath: string): Promise<string | null> {
  const url = `${BASE_URL}${pagePath}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "CrimsonDesertGuide/1.0 (game-guide-bot; +https://github.com/williampowerplay-maker/crimson-guide)",
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

// ===== CRAWL =====

async function crawlCategory(
  category: Category,
  manifest: Map<string, ManifestEntry>,
  dryRun: boolean,
  deep: boolean,
  changedOnly: boolean
): Promise<{ crawled: number; skipped: number; failed: number; newEntries: ManifestEntry[] }> {
  console.log(`\n========== ${category.name.toUpperCase()} ==========`);
  console.log(
    `Index: ${BASE_URL}${category.indexPath}${deep ? " (deep)" : ""}${changedOnly ? " (changed-only)" : ""}`
  );

  const stats = { crawled: 0, skipped: 0, failed: 0, newEntries: [] as ManifestEntry[] };
  const now = new Date().toISOString();

  // Step 1: Fetch index page to get level-1 links
  const indexHtml = await fetchPage(category.indexPath);
  if (!indexHtml) {
    console.error("  Failed to fetch index page. Skipping.");
    stats.failed++;
    return stats;
  }

  const level1Links = extractLinks(indexHtml, category.indexPath);
  console.log(`  Found ${level1Links.length} level-1 links`);

  const allLinks = new Set<string>(level1Links);
  const level2Links = new Set<string>();

  async function processPage(pagePath: string, levelLabel: string, total: number, idx: number) {
    process.stdout.write(`  ${levelLabel} [${idx}/${total}] ${pagePath}...`);

    const html = await fetchPage(pagePath);
    if (!html) {
      console.log(" FAILED");
      stats.failed++;
      return;
    }

    const text = extractMainContent(html);
    const title = extractPageTitle(html);

    if (text.length < 100) {
      console.log(" too short, skipping");
      return;
    }

    const pageUrl = `${BASE_URL}${pagePath}`;
    const contentHash = hashContent(text);
    const existing = manifest.get(pageUrl);

    if (changedOnly && existing && existing.contentHash === contentHash) {
      console.log(" unchanged, skipping");
      stats.skipped++;
      // Still collect deep links even for unchanged pages
      if (deep) {
        for (const link of extractLinks(html, pagePath)) {
          if (!allLinks.has(link)) { allLinks.add(link); level2Links.add(link); }
        }
      }
      return;
    }

    const page: CachedPage = {
      url: pageUrl,
      path: pagePath,
      title,
      text,
      contentHash,
      cachedAt: now,
      category: category.name,
      contentType: category.contentType,
      spoilerLevel: category.spoilerLevel,
    };

    const relativePath = savePage(page, dryRun);

    const entry: ManifestEntry = {
      url: pageUrl,
      path: pagePath,
      title,
      contentHash,
      cachedAt: now,
      category: category.name,
      contentType: category.contentType,
      spoilerLevel: category.spoilerLevel,
      filePath: relativePath,
    };

    if (!dryRun) {
      manifest.set(pageUrl, entry);
    }
    stats.newEntries.push(entry);
    stats.crawled++;

    if (deep) {
      const outLinks = extractLinks(html, pagePath);
      let newLinks = 0;
      for (const link of outLinks) {
        if (!allLinks.has(link)) { allLinks.add(link); level2Links.add(link); newLinks++; }
      }
      console.log(` saved (${text.length} chars, +${newLinks} new links)`);
    } else {
      console.log(` saved (${text.length} chars)`);
    }
  }

  // Step 2: Crawl level-1 pages
  const level1Array = Array.from(level1Links);
  for (let i = 0; i < level1Array.length; i++) {
    await sleep(DELAY_MS);
    await processPage(level1Array[i], "L1", level1Array.length, i + 1);
  }

  // Step 3: Crawl level-2 pages (deep mode only)
  if (deep && level2Links.size > 0) {
    console.log(`\n  --- Level 2: ${level2Links.size} additional pages ---`);
    const level2Array = Array.from(level2Links);
    for (let i = 0; i < level2Array.length; i++) {
      await sleep(DELAY_MS);
      await processPage(level2Array[i], "L2", level2Array.length, i + 1);
    }
  }

  console.log(
    `\n  ${category.name}: ${stats.crawled} crawled, ${stats.skipped} unchanged, ${stats.failed} failed`
  );
  return stats;
}

// ===== CLI =====

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const deep = args.includes("--deep");
  const changedOnly = args.includes("--changed-only");
  const categoryFlagIdx = args.indexOf("--category");
  const targetCategory = categoryFlagIdx >= 0 ? args[categoryFlagIdx + 1] : null;

  console.log("=== Fextralife Wiki Crawler ===");
  console.log(`Mode:         ${dryRun ? "DRY RUN (no files written)" : "LIVE"}`);
  console.log(`Depth:        ${deep ? "2 levels" : "1 level"}`);
  console.log(`Changed-only: ${changedOnly ? "YES" : "NO"}`);
  console.log(`Target:       ${targetCategory || "ALL categories"}`);
  console.log(`Cache dir:    ${CACHE_DIR}`);
  console.log(`Delay:        ${DELAY_MS}ms between requests`);

  const categories = targetCategory
    ? CATEGORIES.filter((c) => c.name === targetCategory)
    : CATEGORIES;

  if (categories.length === 0) {
    console.error(`Unknown category: ${targetCategory}`);
    console.log("Available:", CATEGORIES.map((c) => c.name).join(", "));
    process.exit(1);
  }

  // Ensure cache dirs exist
  if (!dryRun) {
    fs.mkdirSync(PAGES_DIR, { recursive: true });
  }

  // Load existing manifest
  const manifest = loadManifest();
  console.log(`\nLoaded ${manifest.size} existing manifest entries`);

  let totalCrawled = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const category of categories) {
    const stats = await crawlCategory(category, manifest, dryRun, deep, changedOnly);
    totalCrawled += stats.crawled;
    totalSkipped += stats.skipped;
    totalFailed += stats.failed;
  }

  // Save updated manifest
  if (!dryRun) {
    saveManifest(manifest);
    console.log(`\nManifest saved: ${manifest.size} total pages`);
  }

  console.log("\n========== CRAWL COMPLETE ==========");
  console.log(`  Pages crawled/updated: ${totalCrawled}`);
  console.log(`  Pages unchanged (skipped): ${totalSkipped}`);
  console.log(`  Pages failed: ${totalFailed}`);
  console.log(`  Total in cache: ${manifest.size}`);
  console.log("\nNext step: run ingest-from-cache.ts to chunk + embed + upsert");
}

main().catch(console.error);
