// scripts/probe-tier-list-retrieval.ts
//
// One-off retrieval probe for the tier-list queries.
// Embeds the query via Voyage (input_type='query'), calls match_knowledge_chunks
// with content_type_filter=NULL, match_threshold=0.25, match_count=10, and prints
// the top-10 chunks for inspection.
//
// Used to diagnose why the title-fix (Phase 1f) didn't improve tier-list recall.

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
const SB_URL  = env.NEXT_PUBLIC_SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const SB_SVC  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const VOYAGE  = env.VOYAGE_API_KEY            || process.env.VOYAGE_API_KEY            || "";

const QUERIES = [
  "what are the best one-handed weapons?",
  "what is the best body armor?",
];

const EXPECTED: Record<string, string[]> = {
  "what are the best one-handed weapons?": [
    "fa85ee79-1e19-4852-a738-2052a134b7a9",
    "4bad19ac-a944-4157-b00c-eeb7a2ca3ef5",
    "e5b04a96-b88d-4114-8e09-96bf470ea6df",
  ],
  "what is the best body armor?": [
    "25ac6d8d-c309-43ec-a7dd-ce3754a28433",
    "044597b3-3cf5-4e14-9829-c0e6ccfa9d19",
    "4996070d-5be9-42a5-a04c-8e8583699af0",
  ],
};

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "voyage-3.5-lite",
      input: [text],
      input_type: "query",
    }),
  });
  if (!res.ok) throw new Error(`Voyage HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function main() {
  if (!SB_URL || !SB_SVC) throw new Error("Missing SUPABASE env vars");
  if (!VOYAGE) throw new Error("Missing VOYAGE_API_KEY");
  const supabase = createClient(SB_URL, SB_SVC);

  for (const q of QUERIES) {
    console.log("\n" + "═".repeat(80));
    console.log(`Query: ${q}`);
    const expected = new Set(EXPECTED[q]);
    console.log(`Expected (top-K should contain): ${[...expected].map(id => id.slice(0, 8)).join(", ")}`);

    const emb = await embedQuery(q);

    // Match call mirrors src/app/api/chat/route.ts unfiltered branch
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: emb,
      match_threshold: 0.25,
      match_count: 10,
    });
    if (error) { console.error("rpc error:", error); continue; }

    console.log(`\nTop-${data.length}:`);
    console.log("rank  sim    in_pool? chunk_id          archive/page                                                          head_120");
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      const archive = c.source_url?.includes("game8.co") ? c.source_url.split("archives/")[1] : c.source_url?.replace(/^https?:\/\/[^/]+\//, "").slice(0, 50);
      const inPool = expected.has(c.id) ? "✓" : " ";
      const head = (c.content || "").substring(0, 120).replace(/\n/g, "\\n");
      console.log(`${(i+1).toString().padStart(2)}    ${Number(c.similarity).toFixed(3)}  ${inPool}        ${c.id.slice(0, 8)}  ${(archive || "").padEnd(60)}  ${head}`);
    }

    // Also report similarity of expected chunks specifically (in case they're below rank-10)
    if (expected.size > 0) {
      const inTop10 = (data as { id: string }[]).filter(c => expected.has(c.id)).length;
      console.log(`\nExpected in top-10: ${inTop10} / ${expected.size}`);

      // Probe expected chunks individually with a wider net
      const { data: wide, error: wideErr } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: emb,
        match_threshold: 0.0,
        match_count: 100,
      });
      if (!wideErr && wide) {
        for (const expId of expected) {
          const found = (wide as { id: string; similarity: number }[]).findIndex(c => c.id === expId);
          if (found >= 0) {
            console.log(`  expected ${expId.slice(0, 8)}: rank ${found + 1} in top-100, sim=${Number(wide[found].similarity).toFixed(3)}`);
          } else {
            console.log(`  expected ${expId.slice(0, 8)}: NOT in top-100`);
          }
        }
      }
    }
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
