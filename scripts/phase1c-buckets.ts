// scripts/phase1c-buckets.ts
//
// Phase 1c — bucket analysis + 30-row spot-check.
// Read-only: reads phase1c-corpus-classifications.json and
// phase1c-corpus-urls.json, prints bucket counts and a stratified spot-check.
// No DB writes, no API calls.

import { readFileSync, writeFileSync } from "node:fs";

const CLASS_PATH = "./phase1c-corpus-classifications.json";
const URLS_PATH = "./phase1c-corpus-urls.json";
const SPOTCHECK_OUT = "./phase1c-bucket-a-spotcheck.csv";

const VALID_TYPES = new Set([
  "boss", "quest", "character", "exploration", "recipe", "item", "puzzle", "mechanic",
]);
const NAV_ONLY_REASON_RE = /nav-only|category|enumeration|table|index|listing|subcontent/i;

interface ClassRecord {
  source_url: string;
  old_content_type: string;
  new_content_type: string;
  haiku_reason: string | null;
  is_tier_list_candidate: boolean;
  latency_ms: number;
  page_name: string;
}

interface SampleRecord {
  source_url: string;
  content_head: string;
}

function csvEscape(value: string): string {
  if (/[,"\n\r]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function main() {
  const records: ClassRecord[] = JSON.parse(readFileSync(CLASS_PATH, "utf-8"));
  const samples: SampleRecord[] = JSON.parse(readFileSync(URLS_PATH, "utf-8"));
  const headByUrl = new Map(samples.map((s) => [s.source_url, s.content_head]));

  // ── Bucketing ─────────────────────────────────────────────────────────────
  const bucketA: ClassRecord[] = [];   // UPDATE
  const bucketB: ClassRecord[] = [];   // Phase 1e DELETE candidate (nav-only)
  const bucketC: ClassRecord[] = [];   // Manual review
  const bucketD: ClassRecord[] = [];   // No-op
  const stillFailed: ClassRecord[] = [];

  for (const r of records) {
    if (r.new_content_type.startsWith("<")) {
      stillFailed.push(r);
      continue;
    }
    if (r.new_content_type === "uncertain") {
      const reason = r.haiku_reason ?? "";
      if (NAV_ONLY_REASON_RE.test(reason)) bucketB.push(r);
      else bucketC.push(r);
      continue;
    }
    if (VALID_TYPES.has(r.new_content_type) && r.new_content_type !== r.old_content_type) {
      bucketA.push(r);
    } else {
      bucketD.push(r);
    }
  }

  console.log("─".repeat(60));
  console.log("Phase 1c — Bucket Analysis");
  console.log("─".repeat(60));
  console.log(`Total records:            ${records.length}`);
  console.log(`Bucket A (UPDATE):        ${bucketA.length}`);
  console.log(`Bucket B (nav-only del):  ${bucketB.length}`);
  console.log(`Bucket C (manual review): ${bucketC.length}`);
  console.log(`Bucket D (no-op):         ${bucketD.length}`);
  console.log(`Still-failed:             ${stillFailed.length}`);
  console.log();

  // ── Bucket A breakdown ────────────────────────────────────────────────────
  const pairCounts = new Map<string, ClassRecord[]>();
  for (const r of bucketA) {
    const key = `${r.old_content_type} → ${r.new_content_type}`;
    let arr = pairCounts.get(key);
    if (!arr) { arr = []; pairCounts.set(key, arr); }
    arr.push(r);
  }
  const sortedPairs = [...pairCounts.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log("Bucket A — UPDATE breakdown by old → new pair:");
  for (const [pair, arr] of sortedPairs) {
    console.log(`  ${pair.padEnd(35)} ${arr.length}`);
  }
  console.log();

  // ── 30-row stratified spot-check ──────────────────────────────────────────
  // Strategy: pick proportionally across pairs so big buckets dominate but
  // every pair gets at least 1 row when total pairs <= 30.
  const totalA = bucketA.length;
  const target = 30;
  const allocations: Array<{ pair: string; n: number; arr: ClassRecord[] }> = [];
  let remaining = target;
  for (const [pair, arr] of sortedPairs) {
    const proportional = Math.max(1, Math.round((arr.length / totalA) * target));
    const take = Math.min(proportional, arr.length, remaining);
    allocations.push({ pair, n: take, arr });
    remaining -= take;
    if (remaining <= 0) break;
  }
  // If any leftover (rounding), top up the largest pair.
  if (remaining > 0 && allocations[0]) {
    allocations[0].n = Math.min(allocations[0].n + remaining, allocations[0].arr.length);
  }

  const spotCheck: ClassRecord[] = [];
  for (const { n, arr } of allocations) {
    spotCheck.push(...shuffle([...arr]).slice(0, n));
  }

  console.log("─".repeat(60));
  console.log(`Bucket A — 30-row spot-check (stratified by old → new):`);
  console.log("─".repeat(60));
  for (const r of spotCheck) {
    const head = (headByUrl.get(r.source_url) ?? "").substring(0, 100).replace(/\n/g, " ");
    console.log(`  ${r.old_content_type} → ${r.new_content_type}: ${r.page_name}`);
    console.log(`    "${head}…"`);
  }
  console.log();

  // Also write the spot-check to CSV for Excel review.
  const header = ["pair", "page_name", "old", "new", "content_head_first_200", "source_url"];
  const rows = [header.map(csvEscape).join(",")];
  for (const r of spotCheck) {
    const head = (headByUrl.get(r.source_url) ?? "").substring(0, 200).replace(/[\r\n]+/g, " ");
    rows.push([
      `${r.old_content_type} → ${r.new_content_type}`,
      r.page_name,
      r.old_content_type,
      r.new_content_type,
      head,
      r.source_url,
    ].map(csvEscape).join(","));
  }
  writeFileSync(SPOTCHECK_OUT, rows.join("\r\n") + "\r\n", "utf-8");
  console.log(`Spot-check CSV: ${SPOTCHECK_OUT}`);

  // ── Cardinality summary for Bucket B/C ────────────────────────────────────
  console.log();
  console.log("─".repeat(60));
  console.log(`Bucket B — Phase 1e nav-only DELETE candidates: ${bucketB.length}`);
  console.log("Top 10 sample pages:");
  for (const r of bucketB.slice(0, 10)) {
    console.log(`  ${r.page_name.padEnd(40)} reason: ${r.haiku_reason ?? ""}`);
  }
  console.log();
  console.log(`Bucket C — manual review queue: ${bucketC.length}`);
  for (const r of bucketC.slice(0, 10)) {
    console.log(`  ${r.page_name.padEnd(40)} reason: ${r.haiku_reason ?? ""}`);
  }
}

main();
