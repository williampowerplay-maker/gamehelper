// scripts/phase1d-strip-boilerplate.ts
//
// Phase 1d — trailing-boilerplate stripper.
// Truncates fextralife chunks at the earliest boilerplate sentinel,
// re-embeds via Voyage AI, and updates knowledge_chunks. Chunks whose
// remainder after truncation is < 150 chars are DELETEd instead.
//
// Modes (CLI flags):
//   --dry-run      : identify candidates, write phase1d-candidates.json + summary,
//                    NO DB writes, NO embeddings, NO API calls
//   --execute      : create staging + backup, run truncation + re-embed + UPDATE/DELETE
//   --resume       : skip chunks where re_embedded_at IS NOT NULL, continue
//   --report-only  : reprint summary from existing phase1d-candidates.json, no API/DB
//
// Voyage model verified session 26: voyage-3.5-lite, input_type "document".
// Matches every other corpus-writing script (ingest-fextralife/from-cache, seed-*,
// supplement-item-locations). Mismatch with the corpus would cause near-zero cosine
// similarity post-rewrite — see CHANGELOG.md line 206.

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { writeFileSync, readFileSync } from "node:fs";
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
const SB_URL     = env.NEXT_PUBLIC_SUPABASE_URL    || process.env.NEXT_PUBLIC_SUPABASE_URL    || "";
const SB_ANON    = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SB_SERVICE = env.SUPABASE_SERVICE_ROLE_KEY    || process.env.SUPABASE_SERVICE_ROLE_KEY    || "";
const VOYAGE     = env.VOYAGE_API_KEY               || process.env.VOYAGE_API_KEY               || "";

// ── Constants ────────────────────────────────────────────────────────────────
const DATE_SUFFIX = "20260426";
const CANDIDATES_TABLE = `phase1d_candidates_${DATE_SUFFIX}`;
const FAILED_TABLE     = `phase1d_failed_${DATE_SUFFIX}`;
const BACKUP_TABLE     = `knowledge_chunks_backup_phase1d_${DATE_SUFFIX}`;
const CANDIDATES_OUT   = "./phase1d-candidates.json";
const BACKUP_SQL_OUT   = "./phase1d-backup-insert.sql";

// 4 sentinels in priority order. Session-26 design dropped:
//   - "Tired of anon posting"   (functionally redundant with "Join the page discussion")
//   - "Copyright © Valnet Inc"  (always co-occurs with "FextraLife is part of the Valnet")
const SENTINELS = [
  'Retrieved from "https://',
  'POPULAR WIKIS',
  'Join the page discussion',
  'FextraLife is part of the Valnet',
];

const MIN_CHUNK_LENGTH_AFTER_TRUNCATION = 150;
const VOYAGE_BATCH_SIZE = 32;
const VOYAGE_MODEL = "voyage-3.5-lite";              // verified — matches corpus
const VOYAGE_INPUT_TYPE = "document";                // re-embedding corpus chunks, not queries
const VOYAGE_PRICE_PER_M_TOKENS = 0.02;
const DEFAULT_CONCURRENCY = 4;

// ── Shared rate-limit pool (mirrors phase1c-classify.ts) ─────────────────────
let globalPauseUntilMs = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── CLI ──────────────────────────────────────────────────────────────────────
interface CliArgs {
  dryRun: boolean; execute: boolean; resume: boolean; reportOnly: boolean;
  concurrency: number;
}
function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (p: string) => argv.find(a => a.startsWith(p))?.split("=")[1];
  const c = parseInt(get("--concurrency=") ?? String(DEFAULT_CONCURRENCY), 10);
  return {
    dryRun: argv.includes("--dry-run"),
    execute: argv.includes("--execute"),
    resume: argv.includes("--resume"),
    reportOnly: argv.includes("--report-only"),
    concurrency: c,
  };
}

// ── Sentinel logic ───────────────────────────────────────────────────────────
function findEarliestSentinel(content: string): { sentinel: string; pos: number } | null {
  // Case-insensitive: matches the SQL ILIKE used in identifyCandidates so the
  // candidate set in phase1d-candidates.json equals the SQL-pulled candidate set.
  const lower = content.toLowerCase();
  let earliest: { sentinel: string; pos: number } | null = null;
  for (const s of SENTINELS) {
    const idx = lower.indexOf(s.toLowerCase());
    if (idx >= 0 && (earliest === null || idx < earliest.pos)) {
      earliest = { sentinel: s, pos: idx };
    }
  }
  return earliest;
}

interface Candidate {
  id: string;
  source_url: string;
  original_length: number;
  sentinel_used: string;
  truncation_position: number;
  action: 'TRUNCATE' | 'DELETE';
  planned_new_length: number | null;
  planned_new_content: string | null;
}

function classifyChunk(id: string, content: string, source_url: string): Candidate | null {
  const hit = findEarliestSentinel(content);
  if (!hit) return null;
  const truncated = content.substring(0, hit.pos).trim();
  if (truncated.length < MIN_CHUNK_LENGTH_AFTER_TRUNCATION) {
    return {
      id, source_url, original_length: content.length,
      sentinel_used: hit.sentinel, truncation_position: hit.pos,
      action: 'DELETE', planned_new_length: null, planned_new_content: null,
    };
  }
  return {
    id, source_url, original_length: content.length,
    sentinel_used: hit.sentinel, truncation_position: hit.pos,
    action: 'TRUNCATE', planned_new_length: truncated.length, planned_new_content: truncated,
  };
}

// ── Phase A: identify candidates (READ-ONLY) ────────────────────────────────
async function identifyCandidates(supabase: SupabaseClient, args: CliArgs): Promise<Candidate[]> {
  console.log("[phase1d] Phase A: identifying candidates...");
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  // Only --resume needs to read re_embedded_at (and only --execute creates the column).
  const selectCols = args.resume
    ? "id, source_url, content, re_embedded_at"
    : "id, source_url, content";

  for (const sentinel of SENTINELS) {
    let offset = 0;
    process.stdout.write(`  scanning '${sentinel}'... `);
    let pageCount = 0;
    while (true) {
      const { data, error } = await supabase.from("knowledge_chunks")
        .select(selectCols)
        .ilike("source_url", "%fextralife%")
        .ilike("content", `%${sentinel}%`)
        .order("id")  // deterministic pagination — without this, .range() can skip rows across runs
        .range(offset, offset + 999);
      if (error) throw new Error(`Supabase error: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as Array<{ id: string; source_url: string; content: string; re_embedded_at?: string | null }>) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        if (args.resume && row.re_embedded_at) continue;
        if (row.content.length < 500) continue;
        const c = classifyChunk(row.id, row.content, row.source_url);
        if (c) candidates.push(c);
      }
      pageCount++;
      if (data.length < 1000) break;
      offset += 1000;
    }
    console.log(`done (${pageCount} page${pageCount === 1 ? '' : 's'})`);
  }
  console.log(`[phase1d] ${candidates.length} unique candidates identified`);
  return candidates;
}

// ── Stratified spot-check sampler (NEW per session-26 design) ────────────────
function shortUrl(url: string): string {
  return url
    .replace('https://crimsondesert.wiki.fextralife.com/', '')
    .replace('https://crimsondesertgame.wiki.fextralife.com/', '');
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function printStratifiedSamples(candidates: Candidate[]): void {
  console.log(`\nStratified spot-check (per sentinel: 5 TRUNCATE + 3 DELETE):`);
  // Group by sentinel
  const bySentinel = new Map<string, Candidate[]>();
  for (const c of candidates) {
    let arr = bySentinel.get(c.sentinel_used);
    if (!arr) { arr = []; bySentinel.set(c.sentinel_used, arr); }
    arr.push(c);
  }
  for (const sentinel of SENTINELS) {
    const bucket = bySentinel.get(sentinel) || [];
    if (bucket.length < 5) {
      console.log(`\n  ${sentinel} — only ${bucket.length} candidates, skipping stratified sample`);
      continue;
    }
    const truncates = bucket.filter(c => c.action === 'TRUNCATE');
    const deletes   = bucket.filter(c => c.action === 'DELETE');
    const truncSamples = pickRandom(truncates, 5);
    const delSamples   = pickRandom(deletes, 3);
    console.log(`\n  ${sentinel} — ${truncSamples.length} TRUNCATE + ${delSamples.length} DELETE:`);
    for (const c of truncSamples) {
      const tag = `T  ${c.original_length} → ${c.planned_new_length}`;
      console.log(`    ${tag.padEnd(20)} ${shortUrl(c.source_url)}`);
    }
    for (const c of delSamples) {
      const tag = `D  ${c.original_length} → DELETE`;
      console.log(`    ${tag.padEnd(20)} ${shortUrl(c.source_url)}`);
    }
  }
}

// ── Summary printer ──────────────────────────────────────────────────────────
function printSummary(candidates: Candidate[]): void {
  const truncate = candidates.filter(c => c.action === 'TRUNCATE');
  const del = candidates.filter(c => c.action === 'DELETE');
  const totalCharsRemoved = truncate.reduce((s, c) => s + (c.original_length - (c.planned_new_length || 0)), 0)
                          + del.reduce((s, c) => s + c.original_length, 0);

  const bySentinel = new Map<string, number>();
  for (const c of candidates) bySentinel.set(c.sentinel_used, (bySentinel.get(c.sentinel_used) || 0) + 1);

  // Token estimate for Voyage on truncated content (only TRUNCATE re-embeds)
  const totalTruncatedChars = truncate.reduce((s, c) => s + (c.planned_new_length || 0), 0);
  const tokenEstimate = totalTruncatedChars / 4; // ~1 token per 4 chars
  const costEstimate = (tokenEstimate / 1_000_000) * VOYAGE_PRICE_PER_M_TOKENS;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Total candidates:        ${candidates.length}`);
  console.log(`  TRUNCATE:              ${truncate.length}`);
  console.log(`  DELETE (rem<${MIN_CHUNK_LENGTH_AFTER_TRUNCATION}):    ${del.length}`);
  console.log(`\nPer-sentinel (which one fired earliest):`);
  for (const [s, n] of [...bySentinel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(5)}  ${s}`);
  }
  console.log(`\nChars removed:           ${totalCharsRemoved.toLocaleString()}`);
  console.log(`Voyage tokens estimate:  ${Math.round(tokenEstimate).toLocaleString()}`);
  console.log(`Voyage cost estimate:    $${costEstimate.toFixed(4)}  (model=${VOYAGE_MODEL}, $${VOYAGE_PRICE_PER_M_TOKENS}/M)`);

  printStratifiedSamples(candidates);
}

// ── Voyage embedding (batched) with rate-limit pool ─────────────────────────
async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  // Pool pause check
  const now = Date.now();
  if (now < globalPauseUntilMs) await sleep(globalPauseUntilMs - now + 50);

  let lastErr = "unknown";
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const t0 = Date.now();
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: VOYAGE_INPUT_TYPE }),
      });
      const ms = Date.now() - t0;
      if (ms > 2000) console.warn(`[phase1d] WARN slow Voyage call ${ms}ms (batch=${texts.length})`);

      if (res.status === 429) {
        const ra = parseInt(res.headers.get("retry-after") ?? "0", 10);
        const pauseMs = (Number.isFinite(ra) && ra > 0) ? ra * 1000 : Math.min(16000, 1000 * Math.pow(2, attempt));
        const wasPast = globalPauseUntilMs <= Date.now();
        const newPause = Date.now() + pauseMs;
        if (newPause > globalPauseUntilMs) {
          globalPauseUntilMs = newPause;
          if (wasPast) console.log(`[phase1d] Voyage rate-limited; pausing pool for ${Math.ceil(pauseMs/1000)}s`);
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
  console.warn(`[phase1d] Voyage batch failed after 6 attempts: ${lastErr}`);
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

// ── User-confirmation prompt (for backup INSERT step) ───────────────────────
function waitForEnter(message: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
  });
}

function buildBackupSql(candidateIds: string[]): string {
  const idList = candidateIds.map(id => `'${id}'`).join(",\n  ");
  return `INSERT INTO ${BACKUP_TABLE}\nSELECT * FROM knowledge_chunks\nWHERE id IN (\n  ${idList}\n);`;
}

// ── --execute / --resume path ────────────────────────────────────────────────
async function runExecute(supabase: SupabaseClient, args: CliArgs): Promise<void> {
  if (!SB_SERVICE) {
    throw new Error(
      "[phase1d] --execute requires SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
      "Get it from Vercel → Project → Settings → Environment Variables. " +
      "Add as: SUPABASE_SERVICE_ROLE_KEY=<key>"
    );
  }
  const sbWrite = createClient(SB_URL, SB_SERVICE);

  // Use service-role client for Phase A scan: anon's 8s statement_timeout is too short
  // for the ILIKE+ORDER BY scan over 63K rows. Service role has higher timeout.
  const candidates = await identifyCandidates(sbWrite, args);
  if (candidates.length === 0) {
    console.log("[phase1d] No candidates. Nothing to do.");
    return;
  }
  printSummary(candidates);

  // ── Backup prompt ────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`[phase1d] Backup INSERT — run this via MCP execute_sql before continuing.`);
  console.log(`[phase1d] Backup table ${BACKUP_TABLE} must already exist (LIKE knowledge_chunks INCLUDING ALL).`);
  const ids = candidates.map(c => c.id);
  if (ids.length <= 500) {
    const sql = buildBackupSql(ids);
    console.log(`\n${sql}\n`);
  } else {
    const sql = buildBackupSql(ids);
    writeFileSync(BACKUP_SQL_OUT, sql, "utf-8");
    console.log(`[phase1d] Candidate count ${ids.length} > 500. SQL written to ${BACKUP_SQL_OUT}.`);
    console.log(`[phase1d] Apply via: cat ${BACKUP_SQL_OUT} | <pipe to MCP execute_sql>`);
  }
  await waitForEnter(`\n[phase1d] Press Enter when backup is complete... `);

  // Verify backup
  const { count: backupCount, error: bErr } = await sbWrite
    .from(BACKUP_TABLE).select("id", { count: "exact", head: true });
  if (bErr) throw new Error(`Backup table check failed: ${bErr.message}`);
  if ((backupCount ?? 0) < candidates.length) {
    throw new Error(`Backup count ${backupCount} < candidates ${candidates.length}. Re-run backup INSERT.`);
  }
  console.log(`[phase1d] Backup verified: ${backupCount} rows ✓`);

  // Verify staging tables exist
  const { error: cErr } = await sbWrite.from(CANDIDATES_TABLE).select("chunk_id").limit(1);
  if (cErr) throw new Error(`${CANDIDATES_TABLE} missing or unreadable: ${cErr.message}`);
  const { error: fErr } = await sbWrite.from(FAILED_TABLE).select("chunk_id").limit(1);
  if (fErr) throw new Error(`${FAILED_TABLE} missing or unreadable: ${fErr.message}`);

  // Stage candidates
  console.log(`[phase1d] Staging ${candidates.length} candidates into ${CANDIDATES_TABLE}...`);
  const STAGE_BATCH = 500;
  for (let i = 0; i < candidates.length; i += STAGE_BATCH) {
    const slice = candidates.slice(i, i + STAGE_BATCH);
    const { error } = await sbWrite.from(CANDIDATES_TABLE).upsert(slice.map(c => ({
      chunk_id: c.id,
      source_url: c.source_url,
      original_length: c.original_length,
      sentinel_used: c.sentinel_used,
      truncation_position: c.truncation_position,
      action: c.action,
      planned_new_length: c.planned_new_length,
      planned_new_content: c.planned_new_content,
    })), { onConflict: "chunk_id" });
    if (error) throw new Error(`Stage insert failed at batch ${i}: ${error.message}`);
  }
  console.log(`[phase1d]   staged ${candidates.length} rows ✓`);

  // Phase C: TRUNCATE chunks
  const truncate = candidates.filter(c => c.action === 'TRUNCATE');
  console.log(`\n[phase1d] Phase C: truncate + re-embed ${truncate.length} chunks (batch=${VOYAGE_BATCH_SIZE}, concurrency=${args.concurrency})`);
  const batches: Candidate[][] = [];
  for (let i = 0; i < truncate.length; i += VOYAGE_BATCH_SIZE) {
    batches.push(truncate.slice(i, i + VOYAGE_BATCH_SIZE));
  }

  const t0 = Date.now();
  let processed = 0;
  let failed = 0;
  await runBatchedConcurrent(batches, args.concurrency, async (batch, batchIdx) => {
    const texts = batch.map(c => c.planned_new_content!);
    const embeddings = await embedBatch(texts);
    const updates: Array<{ id: string; content: string; embedding: number[]; re_embedded_at: string }> = [];
    const failedIds: Array<{ chunk_id: string; error_message: string }> = [];
    for (let i = 0; i < batch.length; i++) {
      const c = batch[i];
      const e = embeddings[i];
      if (!e) {
        failedIds.push({ chunk_id: c.id, error_message: "Voyage embedding returned null" });
      } else {
        updates.push({ id: c.id, content: c.planned_new_content!, embedding: e, re_embedded_at: new Date().toISOString() });
      }
    }
    if (updates.length > 0) {
      const { error } = await sbWrite.from("knowledge_chunks").upsert(updates, { onConflict: "id" });
      if (error) {
        for (const c of batch) failedIds.push({ chunk_id: c.id, error_message: `Supabase upsert failed: ${error.message}` });
      } else {
        const { error: pErr } = await sbWrite.from(CANDIDATES_TABLE)
          .update({ processed_at: new Date().toISOString() })
          .in("chunk_id", updates.map(u => u.id));
        if (pErr) console.warn(`[phase1d] processed_at mark failed: ${pErr.message}`);
      }
    }
    if (failedIds.length > 0) {
      const { error } = await sbWrite.from(FAILED_TABLE).upsert(failedIds, { onConflict: "chunk_id" });
      if (error) console.warn(`[phase1d] failed-table insert error: ${error.message}`);
      failed += failedIds.length;
    }
    processed += updates.length;
    if (batchIdx % 5 === 0 || batchIdx === batches.length - 1) {
      console.log(`[phase1d]   batch ${batchIdx + 1}/${batches.length}: processed=${processed} failed=${failed}`);
    }
  });

  // Phase D: DELETE thin remainders
  const del = candidates.filter(c => c.action === 'DELETE');
  console.log(`\n[phase1d] Phase D: deleting ${del.length} thin-remainder chunks`);
  if (del.length > 0) {
    for (let i = 0; i < del.length; i += STAGE_BATCH) {
      const ids = del.slice(i, i + STAGE_BATCH).map(c => c.id);
      const { error } = await sbWrite.from("knowledge_chunks").delete().in("id", ids);
      if (error) throw new Error(`Delete failed at batch ${i}: ${error.message}`);
      await sbWrite.from(CANDIDATES_TABLE).update({ processed_at: new Date().toISOString() }).in("chunk_id", ids);
    }
    console.log(`[phase1d]   deleted ${del.length} chunks ✓`);
  }

  // Phase E: report
  const wallMs = Date.now() - t0;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Phase 1d complete.`);
  console.log(`  Truncated + re-embedded: ${processed}`);
  console.log(`  Deleted:                 ${del.length}`);
  console.log(`  Failed (in ${FAILED_TABLE}): ${failed}`);
  console.log(`  Wall time:               ${(wallMs / 1000).toFixed(1)}s`);
  if (failed > 0) console.log(`  Run --resume to retry failed records.`);
}

// ── --dry-run path ───────────────────────────────────────────────────────────
async function runDryRun(supabase: SupabaseClient, args: CliArgs): Promise<void> {
  const candidates = await identifyCandidates(supabase, args);
  printSummary(candidates);
  writeFileSync(CANDIDATES_OUT, JSON.stringify(candidates, null, 2), "utf-8");
  console.log(`\n[phase1d] File written: ${CANDIDATES_OUT}`);
  console.log(`[phase1d] DRY RUN — no chunks touched, no API calls made.`);
}

// ── --report-only path ───────────────────────────────────────────────────────
function runReportOnly(): void {
  const candidates: Candidate[] = JSON.parse(readFileSync(CANDIDATES_OUT, "utf-8"));
  console.log(`[phase1d] Report from ${CANDIDATES_OUT}: ${candidates.length} records`);
  printSummary(candidates);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_ANON) throw new Error("Missing SUPABASE env vars");
  if (!VOYAGE) throw new Error("Missing VOYAGE_API_KEY");

  const args = parseArgs();
  const modeCount = [args.dryRun, args.execute, args.resume, args.reportOnly].filter(Boolean).length;
  if (modeCount === 0) {
    console.log("[phase1d] No mode flag. Use one of:");
    console.log("    --dry-run                    : preview, no DB writes, no API calls");
    console.log("    --execute --concurrency=4    : truncate + re-embed + UPDATE/DELETE");
    console.log("    --resume                     : continue from last partial run");
    console.log("    --report-only                : reprint summary from existing JSON");
    return;
  }
  if (modeCount > 1 && !(args.execute && args.resume)) {
    throw new Error("Pick one mode flag.");
  }

  const supabase = createClient(SB_URL, SB_ANON);

  if (args.reportOnly)            { runReportOnly(); return; }
  if (args.dryRun)                { await runDryRun(supabase, args); return; }
  if (args.execute || args.resume) await runExecute(supabase, args);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
