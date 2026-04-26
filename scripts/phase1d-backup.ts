// One-off: backup the 3,662 Phase 1d candidate chunks using SUPABASE_SERVICE_ROLE_KEY.
// Reads chunk IDs from phase1d-candidates.json, copies full rows into
// knowledge_chunks_backup_phase1d_20260426 in batches of 500.

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SB_URL || !SB_SERVICE) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const sb = createClient(SB_URL, SB_SERVICE);

interface C { id: string }
const all: C[] = JSON.parse(fs.readFileSync("./phase1d-candidates.json", "utf-8"));
const ids = all.map(c => c.id);
console.log(`Backing up ${ids.length} chunks...`);

const BATCH = 100;
let totalInserted = 0;

(async () => {
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    // Pull rows
    const { data, error: selErr } = await sb.from("knowledge_chunks").select("*").in("id", slice);
    if (selErr) throw new Error(`SELECT batch ${i}: ${selErr.message}`);
    if (!data || data.length === 0) {
      console.log(`  batch ${i / BATCH + 1}: 0 rows fetched`);
      continue;
    }
    // Insert into backup; on conflict do nothing (re-run safe)
    const { error: insErr } = await sb.from("knowledge_chunks_backup_phase1d_20260426").upsert(data, { onConflict: "id", ignoreDuplicates: true });
    if (insErr) throw new Error(`INSERT batch ${i}: ${insErr.message}`);
    totalInserted += data.length;
    console.log(`  batch ${i / BATCH + 1}: ${data.length} rows inserted (cumulative ${totalInserted})`);
  }
  console.log(`\nTotal inserted: ${totalInserted}`);
})().catch(err => { console.error(err.message); process.exitCode = 1; });
