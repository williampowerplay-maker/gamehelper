/**
 * Fextralife Wiki Ingestion Script
 *
 * Crawls the Crimson Desert Fextralife wiki, extracts content from each page,
 * chunks it by section, generates Voyage AI embeddings, and upserts into Supabase.
 *
 * Usage:
 *   npx tsx scripts/ingest-fextralife.ts                  # Ingest all categories
 *   npx tsx scripts/ingest-fextralife.ts --category bosses # Ingest one category
 *   npx tsx scripts/ingest-fextralife.ts --dry-run         # Preview without inserting
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, VOYAGE_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ===== ENV SETUP =====
const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
envContent.split("\n").forEach((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const VOYAGE_KEY = env.VOYAGE_API_KEY;
const BASE_URL = "https://crimsondesert.wiki.fextralife.com";

// ===== RATE LIMITING =====
const DELAY_MS = 1500; // Be respectful — 1.5s between requests
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ===== CATEGORY DEFINITIONS =====
// Each category maps to an index page on the wiki and a content_type for tagging
interface Category {
  name: string;
  indexPath: string;
  contentType: string;
  spoilerLevel: number;
}

const CATEGORIES: Category[] = [
  { name: "bosses", indexPath: "/Bosses", contentType: "boss", spoilerLevel: 2 },
  { name: "quests", indexPath: "/Quests", contentType: "quest", spoilerLevel: 3 },
  { name: "weapons", indexPath: "/Weapons", contentType: "item", spoilerLevel: 1 },
  { name: "armor", indexPath: "/Armor", contentType: "item", spoilerLevel: 1 },
  { name: "skills", indexPath: "/Skills", contentType: "mechanic", spoilerLevel: 1 },
  { name: "items", indexPath: "/Items", contentType: "item", spoilerLevel: 1 },
  { name: "locations", indexPath: "/Locations", contentType: "exploration", spoilerLevel: 1 },
  { name: "characters", indexPath: "/Characters", contentType: "character", spoilerLevel: 2 },
  { name: "walkthrough", indexPath: "/Walkthrough", contentType: "quest", spoilerLevel: 3 },
  { name: "guides", indexPath: "/Guides+%26+Walkthrough", contentType: "mechanic", spoilerLevel: 1 },
  { name: "enemies", indexPath: "/Enemies", contentType: "boss", spoilerLevel: 1 },
  { name: "crafting", indexPath: "/Crafting+Guide", contentType: "recipe", spoilerLevel: 1 },
];

// ===== HTML PARSING =====
// We use regex-based parsing to avoid needing cheerio/jsdom dependencies

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
    // Clean up table formatting noise
    .replace(/\|[\s|]+\|/g, " ") // collapse empty table cells
    .replace(/\|\s*\|/g, " ")
    .replace(/^\s*\|\s*/gm, "") // leading pipe on a line
    .replace(/\s*\|\s*$/gm, "") // trailing pipe on a line
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractMainContent(html: string): string {
  // Fextralife wiki content is typically in a div with id "wiki-content-block" or class "wiki-content"
  const contentMatch =
    html.match(/<div[^>]*id="wiki-content-block"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
    html.match(/<div[^>]*class="[^"]*wiki-content[^"]*"[^>]*>([\s\S]*?)<!-- end wiki content -->/i) ||
    html.match(/<div[^>]*id="tagged-pages-container"[^>]*>([\s\S]*?)<\/div>/i) ||
    // Fallback: grab the main body area
    html.match(/<div[^>]*class="[^"]*col-sm-9[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);

  if (contentMatch) {
    return stripHtml(contentMatch[1]);
  }

  // Last resort: strip the whole page
  return stripHtml(html);
}

function extractPageTitle(html: string): string {
  const titleMatch = html.match(/<h1[^>]*class="[^"]*wiki-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return stripHtml(titleMatch[1]).replace(/ \| Crimson Desert Wiki/i, "").trim();
  }
  return "Unknown";
}

function extractLinksFromIndex(html: string, basePath: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  // Strip known nav/sidebar/footer sections, then extract links from the rest
  const contentArea = html
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<div[^>]*id="sidebar"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<div[^>]*class="[^"]*sidebar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<div[^>]*id="fxt-footer"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*class="[^"]*navbar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // Known nav pages to exclude (these appear in every page's sidebar/header)
  const navPages = new Set([
    "/Crimson+Desert+Wiki", "/General+Information", "/DLC", "/Patch+Notes",
    "/Controls", "/Combat", "/FAQs", "/Character+Information", "/Characters",
    "/Character+Customization", "/Stats", "/Status+Effects", "/Skills",
    "/Kliff+Skills", "/Oongka+Skills", "/Damiane+Skills", "/Equipment",
    "/Weapons", "/Projectiles", "/Tools", "/Shields", "/Armor", "/Headgear",
    "/Gloves", "/Body+Armor", "/Cloaks", "/Footwear", "/Accessories",
    "/Abyss+Gear", "/Items", "/Collectibles", "/Crafting+Manuals",
    "/Key+Items", "/Recovery+Items", "/Horse+Items", "/Gatherables",
    "/Meats+and+Grains", "/Fruits+and+Vegetables", "/Mushrooms+and+Herbs",
    "/Minerals", "/Crafting+Materials", "/World+Information", "/Locations",
    "/Greymane+Camp", "/Abyss+Nexus", "/Interactive+Map", "/Factions",
    "/Quests", "/NPCs", "/Vendors", "/Housing+Guide", "/Enemies", "/Bosses",
    "/Lore", "/Guides+%26+Walkthrough", "/New+Player+Help", "/Walkthrough",
    "/Game+Progress+Route", "/New+Game+Plus", "/Trophy+%26+Achievement+Guide",
    "/Crafting+Guide", "/All+Bell+Locations", "/All+Abyss+Artifact+Locations",
    "/Kliff", "/Oongka", "/Damiane", "/todo",
  ]);

  // Match all internal wiki links
  const linkRegex = /href="(\/[^"]+)"/g;
  let match;
  while ((match = linkRegex.exec(contentArea)) !== null) {
    const href = match[1];
    // Filter: must be a wiki page, not a file/image/external, not the index page itself
    if (
      href.startsWith("/") &&
      !href.includes(".") && // no file extensions
      !href.startsWith("/file") &&
      !href.includes("#") &&
      href !== basePath &&
      href !== "/" &&
      !href.startsWith("/search") &&
      !href.startsWith("/login") &&
      !href.startsWith("/register") &&
      !href.startsWith("/profile") &&
      !navPages.has(href) &&
      !seen.has(href)
    ) {
      seen.add(href);
      links.push(href);
    }
  }

  return links;
}

// ===== CHUNKING =====
// Split page content into logical sections based on headings

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

function chunkPageContent(
  text: string,
  pageTitle: string,
  pageUrl: string,
  category: Category
): Chunk[] {
  const chunks: Chunk[] = [];

  // Split on heading markers (###)
  const sections = text.split(/\n(?=### )/);

  if (sections.length <= 1 || text.length < 500) {
    // Small page or no headings — treat as single chunk
    if (text.length > 50) {
      chunks.push({
        content: `${pageTitle}\n\n${text}`.slice(0, 4000),
        source_url: pageUrl,
        source_type: "fextralife_wiki",
        quest_name: category.contentType === "quest" || category.contentType === "boss" ? pageTitle : null,
        content_type: category.contentType,
        character: detectCharacter(text),
        region: detectRegion(text),
        chapter: null,
        spoiler_level: category.spoilerLevel,
      });
    }
    return chunks;
  }

  // Multi-section page: create a chunk per meaningful section
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 50) continue; // Skip tiny sections

    // Prepend page title for context
    const chunkContent = `${pageTitle}\n\n${trimmed}`.slice(0, 4000);

    chunks.push({
      content: chunkContent,
      source_url: pageUrl,
      source_type: "fextralife_wiki",
      quest_name: category.contentType === "quest" || category.contentType === "boss" ? pageTitle : null,
      content_type: category.contentType,
      character: detectCharacter(trimmed),
      region: detectRegion(trimmed),
      chapter: null,
      spoiler_level: category.spoilerLevel,
    });
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

  // Voyage AI supports batches up to 128 inputs
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

    if (i + batchSize < texts.length) await sleep(500); // Rate limit Voyage
  }

  return allEmbeddings;
}

// ===== MAIN INGESTION =====

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

async function ingestCategory(category: Category, dryRun: boolean) {
  console.log(`\n========== ${category.name.toUpperCase()} ==========`);
  console.log(`Index: ${BASE_URL}${category.indexPath}`);

  // Step 1: Fetch the index page to get all sub-page links
  const indexHtml = await fetchPage(category.indexPath);
  if (!indexHtml) {
    console.error("  Failed to fetch index page. Skipping.");
    return;
  }

  const pageLinks = extractLinksFromIndex(indexHtml, category.indexPath);
  console.log(`  Found ${pageLinks.length} linked pages`);

  // Also chunk the index page itself (often has useful overview content)
  const indexContent = extractMainContent(indexHtml);
  const indexTitle = extractPageTitle(indexHtml);
  const allChunks: Chunk[] = chunkPageContent(
    indexContent,
    indexTitle,
    `${BASE_URL}${category.indexPath}`,
    category
  );

  // Step 2: Crawl each linked page
  let crawled = 0;
  for (const link of pageLinks) {
    await sleep(DELAY_MS);
    crawled++;
    process.stdout.write(`  [${crawled}/${pageLinks.length}] ${link}...`);

    const html = await fetchPage(link);
    if (!html) {
      console.log(" FAILED");
      continue;
    }

    const content = extractMainContent(html);
    const title = extractPageTitle(html);

    if (content.length < 100) {
      console.log(" too short, skipping");
      continue;
    }

    const chunks = chunkPageContent(content, title, `${BASE_URL}${link}`, category);
    allChunks.push(...chunks);
    console.log(` ${chunks.length} chunks`);
  }

  console.log(`\n  Total chunks for ${category.name}: ${allChunks.length}`);

  if (dryRun) {
    console.log("  [DRY RUN] Skipping database insert and embedding generation");
    // Show a sample
    if (allChunks.length > 0) {
      console.log("\n  --- Sample chunk ---");
      console.log(`  Title context: ${allChunks[0].content.slice(0, 150)}...`);
      console.log(`  Content type: ${allChunks[0].content_type}`);
      console.log(`  Source: ${allChunks[0].source_url}`);
    }
    return;
  }

  // Step 3: Generate embeddings
  console.log("  Generating embeddings...");
  const embeddings = await generateEmbeddings(allChunks.map((c) => c.content));

  // Step 4: Upsert into Supabase
  console.log("  Upserting to Supabase...");
  let inserted = 0;
  let errors = 0;

  // Insert in batches of 50
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
}

// ===== CLI =====

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const categoryFlag = args.indexOf("--category");
  const targetCategory = categoryFlag >= 0 ? args[categoryFlag + 1] : null;

  console.log("Fextralife Wiki Ingestion Script");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Target: ${targetCategory || "ALL categories"}`);
  console.log(`Delay between requests: ${DELAY_MS}ms`);

  const categories = targetCategory
    ? CATEGORIES.filter((c) => c.name === targetCategory)
    : CATEGORIES;

  if (categories.length === 0) {
    console.error(`Unknown category: ${targetCategory}`);
    console.log("Available:", CATEGORIES.map((c) => c.name).join(", "));
    process.exit(1);
  }

  for (const category of categories) {
    await ingestCategory(category, dryRun);
  }

  console.log("\n========== COMPLETE ==========");
}

main().catch(console.error);
