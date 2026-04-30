// scripts/fix-game8-titles.ts
//
// Phase 1f — Game8 title-truncation fix.
// During original ingestion, the markdown parser ate hyphenated title
// continuations after newlines: "Best One-Handed Weapons" became "Best One"
// because "-Handed Weapons" on a new line was interpreted as a list-item
// bullet. The Voyage embeddings were generated from the truncated content,
// so vector similarity to tier-list queries ("best one-handed weapons")
// is poor. This script fixes the content prefix and re-embeds.
//
// Scope (verified via SQL pre-check, see RESUME.md):
//   archives/595314: "Best One"        × 34 chunks
//   archives/595374: "Best Two"        × 33 chunks
//   archives/586776: "List of All One" × 39 chunks
//   archives/586777: "List of All Two" × 66 chunks
//   Total: 172 chunks. No other game8 truncations found.
//
// Modes (CLI flags):
//   --dry-run      : load chunks, show before/after sample, no DB writes, no API calls
//   --execute      : apply the fix (re-embed + UPDATE), requires SUPABASE_SERVICE_ROLE_KEY
//   --report       : print per-URL stats from a previous --execute run (re_embedded_at)
//
// Voyage model voyage-3.5-lite + input_type "document" — matches every other
// corpus-writing script (phase1d, ingest-fextralife, seed-*). Mismatching the
// model would cause near-zero cosine similarity post-rewrite.

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Env loading (mirrors phase1d-strip-boilerplate.ts) ──────────────────────
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
const SB_URL     = env.NEXT_PUBLIC_SUPABASE_URL    || process.env.NEXT_PUBLIC_SUPABASE_URL    || "";
const SB_ANON    = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SB_SERVICE = env.SUPABASE_SERVICE_ROLE_KEY    || process.env.SUPABASE_SERVICE_ROLE_KEY    || "";
const VOYAGE     = env.VOYAGE_API_KEY               || process.env.VOYAGE_API_KEY               || "";

// ── Constants ────────────────────────────────────────────────────────────────
const VOYAGE_BATCH_SIZE = 32;
const VOYAGE_MODEL = "voyage-3.5-lite";
const VOYAGE_INPUT_TYPE = "document";
const VOYAGE_PRICE_PER_M_TOKENS = 0.02;
const DEFAULT_CONCURRENCY = 4;

// Per-URL title fix mapping. The `wrong` string is what the chunk currently
// starts with; `correct` is what it should start with.
const TITLE_FIXES: Record<string, { wrong: string; correct: string }> = {
  "https://game8.co/games/Crimson-Desert/archives/595314": {
    wrong: "Best One\n\n",
    correct: "Best One-Handed Weapons\n\n",
  },
  "https://game8.co/games/Crimson-Desert/archives/595374": {
    wrong: "Best Two\n\n",
    correct: "Best Two-Handed Weapons\n\n",
  },
  "https://game8.co/games/Crimson-Desert/archives/586776": {
    wrong: "List of All One\n\n",
    correct: "List of All One-Handed Weapons\n\n",
  },
  "https://game8.co/games/Crimson-Desert/archives/586777": {
    wrong: "List of All Two\n\n",
    correct: "List of All Two-Handed Weapons\n\n",
  },
};

// ── Shared rate-limit pool (mirrors phase1d-strip-boilerplate.ts) ───────────
let globalPauseUntilMs = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── CLI ──────────────────────────────────────────────────────────────────────
interface CliArgs { dryRun: boolean; execute: boolean; report: boolean; concurrency: number; }
function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (p: string) => argv.find(a => a.startsWith(p))?.split("=")[1];
  const c = parseInt(get("--concurrency=") ?? String(DEFAULT_CONCURRENCY), 10);
  return {
    dryRun: argv.includes("--dry-run"),
    execute: argv.includes("--execute"),
    report: argv.includes("--report"),
    concurrency: c,
  };
}

// ── Types ────────────────────────────────────────────────────────────────────
interface ChunkRow { id: string; source_url: string; content: string; re_embedded_at?: string | null; }
interface PlannedFix {
  id: string;
  source_url: string;
  original_length: number;
  new_content: string;
  new_length: number;
}

// Source-of-truth backup table created in step 3 (see RESUME.md). 172 rows,
// same schema as knowledge_chunks. Reading from this 172-row table avoids
// the PostgREST statement timeout that hits when seq-scanning the 59K-row
// main table without a source_url index.
const SOURCE_TABLE = "knowledge_chunks_backup_titlefix_20260430";

// ── Phase A: load + plan ────────────────────────────────────────────────────
async function planFixes(supabase: SupabaseClient): Promise<{
  planned: PlannedFix[];
  skipped: { id: string; source_url: string; reason: string }[];
}> {
  const planned: PlannedFix[] = [];
  const skipped: { id: string; source_url: string; reason: string }[] = [];

  // Read from the 172-row backup table, NOT knowledge_chunks (59K rows).
  // No source_url index exists; main-table queries time out via PostgREST.
  const urls = Object.keys(TITLE_FIXES);
  const { data, error } = await supabase
    .from(SOURCE_TABLE)
    .select("id, source_url, content")
    .in("source_url", urls);
  if (error) throw new Error(`[fix-titles] Supabase error reading ${SOURCE_TABLE}: ${error.message}`);
  if (!data || data.length === 0) {
    console.warn(`[fix-titles] WARN: no chunks found for any of the 4 URLs`);
    return { planned, skipped };
  }

  // Build planning candidates from the backup (original content)
  type Candidate = { id: string; source_url: string; original: string; new: string };
  const candidates: Candidate[] = [];
  for (const row of data as ChunkRow[]) {
    const fix = TITLE_FIXES[row.source_url];
    if (!fix) {
      skipped.push({ id: row.id, source_url: row.source_url, reason: "no TITLE_FIXES mapping" });
      continue;
    }
    if (!row.content.startsWith(fix.wrong)) {
      // Backup itself is already fixed — should not happen
      skipped.push({
        id: row.id,
        source_url: row.source_url,
        reason: `BACKUP does not start with expected prefix "${fix.wrong.replace(/\n/g, "\\n")}"`,
      });
      continue;
    }
    const newContent = fix.correct + row.content.substring(fix.wrong.length);
    candidates.push({ id: row.id, source_url: row.source_url, original: row.content, new: newContent });
  }

  // Verify CURRENT state in knowledge_chunks via PK lookup (fast — uses pkey index).
  // Skip any chunk that no longer starts with the wrong prefix (idempotency guard).
  if (candidates.length > 0) {
    const ids = candidates.map(c => c.id);
    const PK_BATCH = 100; // PostgREST has a URL length limit; 100 UUIDs/batch is safe
    const currentById = new Map<string, string>();
    for (let i = 0; i < ids.length; i += PK_BATCH) {
      const slice = ids.slice(i, i + PK_BATCH);
      const { data: live, error: liveErr } = await supabase
        .from("knowledge_chunks")
        .select("id, content")
        .in("id", slice);
      if (liveErr) throw new Error(`[fix-titles] PK lookup failed: ${liveErr.message}`);
      for (const r of (live ?? []) as { id: string; content: string }[]) {
        currentById.set(r.id, r.content);
      }
    }
    for (const c of candidates) {
      const cur = currentById.get(c.id);
      if (cur === undefined) {
        skipped.push({ id: c.id, source_url: c.source_url, reason: "chunk no longer exists in knowledge_chunks" });
        continue;
      }
      const fix = TITLE_FIXES[c.source_url];
      if (!cur.startsWith(fix.wrong)) {
        // Already fixed (or otherwise mutated) — skip silently for idempotency
        skipped.push({
          id: c.id,
          source_url: c.source_url,
          reason: cur.startsWith(fix.correct)
            ? "already fixed"
            : `current prefix mismatch (not "${fix.wrong.replace(/\n/g, "\\n")}")`,
        });
        continue;
      }
      planned.push({
        id: c.id,
        source_url: c.source_url,
        original_length: cur.length,
        new_content: c.new,
        new_length: c.new.length,
      });
    }
  }

  return { planned, skipped };
}

// ── Voyage embedding (batched) with rate-limit pool ─────────────────────────
async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const now = Date.now();
  if (now < globalPauseUntilMs) await sleep(globalPauseUntilMs - now + 50);
  let lastErr = "unknown";
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const t0 = Date.now();
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: VOYAGE_INPUT_TYPE }),
      });
      const ms = Date.now() - t0;
      if (ms > 2000) console.warn(`[fix-titles] WARN slow Voyage call ${ms}ms (batch=${texts.length})`);
      if (res.status === 429) {
        const ra = parseInt(res.headers.get("retry-after") ?? "0", 10);
        const pauseMs = (Number.isFinite(ra) && ra > 0) ? ra * 1000 : Math.min(16000, 1000 * Math.pow(2, attempt));
        const wasPast = globalPauseUntilMs <= Date.now();
        const newPause = Date.now() + pauseMs;
        if (newPause > globalPauseUntilMs) {
          globalPauseUntilMs = newPause;
          if (wasPast) console.log(`[fix-titles] Voyage rate-limited; pausing pool for ${Math.ceil(pauseMs/1000)}s`);
        }
        lastErr = "HTTP 429";
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.data.map((d: { embedding: number[] }) => d.embedding);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt === 5) break;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  console.warn(`[fix-titles] Voyage batch failed after 6 attempts: ${lastErr}`);
  return texts.map(() => null);
}

// ── Concurrent batch worker pool ─────────────────────────────────────────────
async function runBatchedConcurrent<T>(
  items: T[][],
  concurrency: number,
  worker: (batch: T[], idx: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const take = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, take));
}

// ── Token estimate helper ───────────────────────────────────────────────────
function estimateTokens(texts: string[]): number {
  // ~1 token per 4 chars (matches phase1d estimate)
  return Math.round(texts.reduce((s, t) => s + t.length / 4, 0));
}

// ── Per-URL summary ──────────────────────────────────────────────────────────
function summarize(planned: PlannedFix[], skipped: { id: string; source_url: string; reason: string }[]): void {
  const byUrl = new Map<string, number>();
  for (const p of planned) byUrl.set(p.source_url, (byUrl.get(p.source_url) ?? 0) + 1);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Per-URL plan:`);
  for (const url of Object.keys(TITLE_FIXES)) {
    const archive = url.split("/").pop();
    const fix = TITLE_FIXES[url];
    const cnt = byUrl.get(url) ?? 0;
    const skippedHere = skipped.filter(s => s.source_url === url).length;
    console.log(`  archives/${archive}: ${cnt} planned, ${skippedHere} skipped  ("${fix.wrong.replace(/\n/g, "\\n")}" → "${fix.correct.replace(/\n/g, "\\n")}")`);
  }
  const totalChars = planned.reduce((s, p) => s + p.new_length, 0);
  const tokens = estimateTokens(planned.map(p => p.new_content));
  const cost = (tokens / 1_000_000) * VOYAGE_PRICE_PER_M_TOKENS;
  console.log(`\nTotal planned:    ${planned.length} chunks`);
  console.log(`Total skipped:    ${skipped.length} chunks`);
  console.log(`Total new chars:  ${totalChars.toLocaleString()}`);
  console.log(`Voyage tokens:    ~${tokens.toLocaleString()}`);
  console.log(`Voyage cost:      ~$${cost.toFixed(4)}  (model=${VOYAGE_MODEL})`);
  if (skipped.length > 0) {
    console.log(`\nSkipped reasons (first 5):`);
    for (const s of skipped.slice(0, 5)) console.log(`  ${s.id} (${s.source_url.split("/").pop()}): ${s.reason}`);
  }
}

// ── --dry-run path ───────────────────────────────────────────────────────────
// Uses service-role if available — anon key's 8s statement_timeout hits even
// on a single-URL eq+order_by query against the 59K-row table.
async function runDryRun(supabase: SupabaseClient): Promise<void> {
  const { planned, skipped } = await planFixes(supabase);
  summarize(planned, skipped);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Sample before/after (1 chunk per URL):`);
  for (const url of Object.keys(TITLE_FIXES)) {
    const sample = planned.find(p => p.source_url === url);
    if (!sample) {
      console.log(`\n  ${url.split("/").pop()}: NO SAMPLE (no planned chunks)`);
      continue;
    }
    const archive = url.split("/").pop();
    const fix = TITLE_FIXES[url];
    // Reconstruct BEFORE from new_content: replace correct prefix with wrong prefix.
    const beforeContent = fix.wrong + sample.new_content.substring(fix.correct.length);
    console.log(`\n  archives/${archive}  id=${sample.id}`);
    console.log(`    BEFORE (first 100): ${JSON.stringify(beforeContent.substring(0, 100))}`);
    console.log(`    AFTER  (first 100): ${JSON.stringify(sample.new_content.substring(0, 100))}`);
    console.log(`    length: ${sample.original_length} → ${sample.new_length} (Δ +${sample.new_length - sample.original_length})`);
  }
  console.log(`\n[fix-titles] DRY RUN — no chunks touched, no API calls made.`);
}

// ── --execute path ───────────────────────────────────────────────────────────
async function runExecute(args: CliArgs): Promise<void> {
  if (!SB_SERVICE) {
    throw new Error(
      "[fix-titles] --execute requires SUPABASE_SERVICE_ROLE_KEY in .env.local. " +
      "Get it from Supabase → Project Settings → API → service_role key."
    );
  }
  const sbWrite = createClient(SB_URL, SB_SERVICE);
  const { planned, skipped } = await planFixes(sbWrite);
  summarize(planned, skipped);
  if (planned.length === 0) {
    console.log("[fix-titles] No planned fixes. Nothing to do.");
    return;
  }

  console.log(`\n[fix-titles] Executing: re-embed + UPDATE ${planned.length} chunks (batch=${VOYAGE_BATCH_SIZE}, concurrency=${args.concurrency})`);
  const batches: PlannedFix[][] = [];
  for (let i = 0; i < planned.length; i += VOYAGE_BATCH_SIZE) batches.push(planned.slice(i, i + VOYAGE_BATCH_SIZE));

  const t0 = Date.now();
  let processed = 0;
  let failed = 0;
  const failures: { id: string; reason: string }[] = [];

  await runBatchedConcurrent(batches, args.concurrency, async (batch, idx) => {
    const texts = batch.map(p => p.new_content);
    const embeddings = await embedBatch(texts);
    const updates: Array<{ id: string; content: string; embedding: number[]; re_embedded_at: string }> = [];
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const e = embeddings[i];
      if (!e) {
        failures.push({ id: p.id, reason: "Voyage embedding returned null" });
      } else {
        updates.push({ id: p.id, content: p.new_content, embedding: e, re_embedded_at: new Date().toISOString() });
      }
    }
    if (updates.length > 0) {
      const { error } = await sbWrite.from("knowledge_chunks").upsert(updates, { onConflict: "id" });
      if (error) {
        for (const u of updates) failures.push({ id: u.id, reason: `Supabase upsert failed: ${error.message}` });
      } else {
        processed += updates.length;
      }
    }
    failed = failures.length;
    if (idx % 2 === 0 || idx === batches.length - 1) {
      console.log(`[fix-titles]   batch ${idx + 1}/${batches.length}: processed=${processed} failed=${failed}`);
    }
  });

  const wallMs = Date.now() - t0;
  const totalTokens = estimateTokens(planned.map(p => p.new_content));
  const totalCost = (totalTokens / 1_000_000) * VOYAGE_PRICE_PER_M_TOKENS;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 1f title-fix complete.`);
  console.log(`  Updated:        ${processed}`);
  console.log(`  Skipped:        ${skipped.length}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`  Total tokens:   ~${totalTokens.toLocaleString()}`);
  console.log(`  Voyage cost:    ~$${totalCost.toFixed(4)}`);
  console.log(`  Wall time:      ${(wallMs / 1000).toFixed(1)}s`);
  if (failures.length > 0) {
    console.log(`\n  Failure detail (first 10):`);
    for (const f of failures.slice(0, 10)) console.log(`    ${f.id}: ${f.reason}`);
  }

  // Per-URL outcome
  console.log(`\nPer-URL outcome:`);
  const successById = new Set(planned.filter(p => !failures.some(f => f.id === p.id)).map(p => p.id));
  for (const url of Object.keys(TITLE_FIXES)) {
    const archive = url.split("/").pop();
    const planForUrl = planned.filter(p => p.source_url === url);
    const ok = planForUrl.filter(p => successById.has(p.id)).length;
    const skip = skipped.filter(s => s.source_url === url).length;
    const fail = planForUrl.length - ok;
    console.log(`  archives/${archive}: ${ok} updated, ${skip} skipped, ${fail} failed`);
  }
}

// ── --report path: post-run stats from re_embedded_at column ─────────────────
async function runReport(supabase: SupabaseClient): Promise<void> {
  console.log(`[fix-titles] Per-URL re_embedded_at status:`);
  for (const url of Object.keys(TITLE_FIXES)) {
    const archive = url.split("/").pop();
    const { data, error } = await supabase
      .from("knowledge_chunks")
      .select("id, re_embedded_at, content")
      .eq("source_url", url);
    if (error) { console.warn(`  ${url}: ERROR ${error.message}`); continue; }
    const total = data?.length ?? 0;
    const reembed = (data ?? []).filter(r => r.re_embedded_at).length;
    const stillTruncated = (data ?? []).filter(r => r.content.startsWith(TITLE_FIXES[url].wrong)).length;
    const fixed = (data ?? []).filter(r => r.content.startsWith(TITLE_FIXES[url].correct)).length;
    console.log(`  archives/${archive}: total=${total} re_embedded=${reembed} fixed_prefix=${fixed} still_truncated=${stillTruncated}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_ANON) throw new Error("Missing SUPABASE env vars");
  if (!VOYAGE) throw new Error("Missing VOYAGE_API_KEY");

  const args = parseArgs();
  const modeCount = [args.dryRun, args.execute, args.report].filter(Boolean).length;
  if (modeCount === 0) {
    console.log("[fix-titles] No mode flag. Use one of:");
    console.log("    --dry-run                    : preview, no DB writes, no API calls");
    console.log("    --execute --concurrency=4    : re-embed + UPDATE (requires SUPABASE_SERVICE_ROLE_KEY)");
    console.log("    --report                     : per-URL status from re_embedded_at column");
    return;
  }
  if (modeCount > 1) throw new Error("Pick one mode flag.");

  // Service role required for reads too — anon's 8s statement_timeout hits
  // even on small eq+order_by queries against the 59K-row table.
  const supabase = SB_SERVICE
    ? createClient(SB_URL, SB_SERVICE)
    : createClient(SB_URL, SB_ANON);
  if (!SB_SERVICE) {
    console.warn("[fix-titles] WARN: SUPABASE_SERVICE_ROLE_KEY not set — anon may time out on planFixes scan.");
  }
  if (args.dryRun)  { await runDryRun(supabase); return; }
  if (args.report)  { await runReport(supabase); return; }
  if (args.execute) { await runExecute(args); return; }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
