/**
 * Supplemental scraper — extracts "How to Obtain" / "Where to Find" data
 * from item pages that already exist in the DB, and inserts them as new chunks.
 *
 * Only processes Fextralife item pages. Skips pages that:
 * - Already have a location/obtain chunk (idempotent)
 * - Don't have obtain info on the wiki (stubs)
 *
 * Usage: npx tsx scripts/supplement-item-locations.ts [--dry-run] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load env
const envContent = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
const env: Record<string, string> = {};
envContent.split("\n").forEach((line) => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const VOYAGE_KEY = env.VOYAGE_API_KEY;

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity;
const CRAWL_DELAY = 600; // ms between requests

// ===== HTML EXTRACTION =====

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, " - ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/?(td|th)[^>]*>/gi, " ")
    .replace(/<h[1-6][^>]*>/gi, "\n### ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Extracts "How to Obtain" / "Where to Find" section from an item page.
 * Returns the extracted text or null if not found / placeholder only.
 */
function extractObtainInfo(html: string, pageTitle: string): string | null {
  // Strategy: Look for sections that contain obtain/location/acquisition info
  // These appear as headers or bold text within the wiki content block

  // First, get the wiki content block
  const startMarkers = [
    /(<div[^>]*id="wiki-content-block"[^>]*>)/i,
    /(<div[^>]*class="[^"]*wiki-content[^"]*"[^>]*>)/i,
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
  if (startIdx === -1) return null;

  const endMarkers = [
    /<div[^>]*class="[^"]*side-bar-right[^"]*"/i,
    /<div[^>]*id="fxt-footer"/i,
    /<footer/i,
    /<div[^>]*class="[^"]*comments-section[^"]*"/i,
  ];

  let endIdx = html.length;
  for (const marker of endMarkers) {
    const match = html.substring(startIdx).match(marker);
    if (match && match.index !== undefined) {
      const candidateEnd = startIdx + match.index;
      if (candidateEnd < endIdx) endIdx = candidateEnd;
    }
  }

  const contentHtml = html.substring(startIdx, endIdx);
  const fullText = stripHtml(contentHtml);

  // Look for obtain/location patterns in the text
  // Priority: section headers first (most reliable), then specific phrases
  const obtainPatterns = [
    // "How to Obtain" or "Where to Find" section headers — most reliable
    /###\s*(?:How to (?:Obtain|Get|Acquire|Craft)|Where to [Ff]ind|(?:Item )?Location|Acquisition)[^\n]*\n([\s\S]*?)(?=###|$)/i,
    // "can be found/obtained" with location context (not lore descriptions)
    /(?:can be (?:found|obtained|acquired|purchased|bought)) (?:in the following|at |from |by |after )[^\n.]*.[\s\S]*?(?=###|\n\n\n|$)/i,
    // "Dropped by" or "Sold by" patterns — explicit acquisition
    /(?:dropped by|sold by|reward (?:from|for)|obtained (?:from|by|after|through))[^\n.]*.[\s\S]*?(?=###|\n\n\n|$)/i,
    // "Defeat X to obtain/get" — boss drop pattern
    /(?:defeat|kill|slay)\s+[A-Z][^\n.]*(?:to (?:obtain|get|receive|earn))[^\n.]*/i,
    // "found inside/at/in [Location]" — specific container/location (not "found in ancient/old/lost" lore)
    /found (?:inside|at|near|within)\s+(?:the\s+)?[A-Z][^\n.]*/i,
  ];

  const results: string[] = [];
  for (const pattern of obtainPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      const text = match[0].trim();
      // Skip placeholder text
      if (/go(?:es)? here/i.test(text)) continue;
      if (text.length < 20) continue;
      if (!results.includes(text)) results.push(text);
    }
  }

  if (results.length === 0) return null;

  // Also extract infobox-style location data from structured HTML
  // Look for table cells near "Location" or "How to Obtain" labels
  const infoboxPatterns = [
    /<t[hd][^>]*>[^<]*(?:Location|How to (?:Obtain|Get)|Where to Find|Acquisition|Dropped? By|Sold By)[^<]*<\/t[hd]>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi,
  ];

  for (const pattern of infoboxPatterns) {
    let m;
    while ((m = pattern.exec(contentHtml)) !== null) {
      const val = stripHtml(m[1]).trim();
      if (val.length > 5 && !/go(?:es)? here/i.test(val) && !results.includes(val)) {
        results.push(val);
      }
    }
  }

  if (results.length === 0) return null;

  // Build the chunk content
  const combined = results.join("\n\n");
  return `${pageTitle}\n\nHow to Obtain / Where to Find:\n${combined}`;
}

// ===== EMBEDDING =====

async function getEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  if (!VOYAGE_KEY) return texts.map(() => null);

  const BATCH_SIZE = 20;
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3.5-lite", input: batch, input_type: "document" }),
      });
      if (!res.ok) {
        console.error(`  Voyage error: ${res.status}`);
        results.push(...batch.map(() => null));
        continue;
      }
      const data = await res.json();
      for (const item of data.data) {
        results.push(item.embedding);
      }
    } catch (e) {
      console.error("  Voyage fetch error:", e);
      results.push(...batch.map(() => null));
    }
  }

  return results;
}

// ===== MAIN =====

async function main() {
  console.log(`Supplemental Item Location Scraper${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`Limit: ${LIMIT === Infinity ? "none" : LIMIT}`);

  // Get all distinct item page URLs from DB
  const { data: urlRows, error } = await supabase
    .from("knowledge_chunks")
    .select("source_url")
    .eq("content_type", "item")
    .like("source_url", "%fextralife.com%");

  if (error || !urlRows) {
    console.error("Failed to fetch URLs:", error?.message);
    return;
  }

  const urls = [...new Set(urlRows.map((r) => r.source_url as string))];
  console.log(`Found ${urls.length} item URLs in DB`);

  // Check which URLs already have obtain/location chunks (skip those)
  const { data: existingChunks } = await supabase
    .from("knowledge_chunks")
    .select("source_url")
    .like("content", "%How to Obtain / Where to Find:%");

  const alreadyDone = new Set((existingChunks || []).map((r) => r.source_url));
  const toProcess = urls.filter((u) => !alreadyDone.has(u)).slice(0, LIMIT);
  console.log(`Already supplemented: ${alreadyDone.size}, to process: ${toProcess.length}\n`);

  let found = 0;
  let skipped = 0;
  let errors = 0;
  const newChunks: { content: string; url: string }[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const url = toProcess[i];
    const pageName = decodeURIComponent(url.split("/").pop() || "").replace(/\+/g, " ");

    if ((i + 1) % 50 === 0 || i === 0) {
      console.log(`[${i + 1}/${toProcess.length}] Processing... (found: ${found}, skipped: ${skipped}, errors: ${errors})`);
    }

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "CrimsonGuide-Bot/1.0 (game-companion)" },
      });
      if (!res.ok) {
        if (res.status === 404) { skipped++; continue; }
        errors++;
        continue;
      }

      const html = await res.text();
      const obtainInfo = extractObtainInfo(html, pageName);

      if (obtainInfo) {
        found++;
        newChunks.push({ content: obtainInfo, url });

        if (found <= 5) {
          console.log(`  FOUND: ${pageName}`);
          console.log(`    ${obtainInfo.split("\n").slice(2).join(" ").slice(0, 120)}...`);
        }
      } else {
        skipped++;
      }
    } catch (e) {
      errors++;
    }

    await new Promise((r) => setTimeout(r, CRAWL_DELAY));
  }

  console.log(`\nScraping complete:`);
  console.log(`  Found obtain info: ${found}`);
  console.log(`  No obtain info (stubs): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  if (DRY_RUN || newChunks.length === 0) {
    console.log(DRY_RUN ? "\nDry run — no DB writes." : "\nNo new chunks to insert.");
    return;
  }

  // Embed all new chunks
  console.log(`\nEmbedding ${newChunks.length} chunks...`);
  const embeddings = await getEmbeddings(newChunks.map((c) => c.content));

  // Insert into DB
  console.log("Inserting into DB...");
  let inserted = 0;
  const BATCH = 50;

  for (let i = 0; i < newChunks.length; i += BATCH) {
    const batch = newChunks.slice(i, i + BATCH).map((chunk, j) => ({
      content: chunk.content,
      source_url: chunk.url,
      source_type: "wiki",
      content_type: "item",
      embedding: embeddings[i + j],
    }));

    const { error: insertErr } = await supabase.from("knowledge_chunks").insert(batch);
    if (insertErr) {
      console.error(`  Insert error at batch ${i}: ${insertErr.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\nDone! Inserted ${inserted} location/obtain chunks.`);
}

main().catch(console.error);
