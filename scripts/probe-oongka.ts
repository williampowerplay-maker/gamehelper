// One-off diagnostic for the Oongka regression. Read-only.
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
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
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const VOYAGE = env.VOYAGE_API_KEY || process.env.VOYAGE_API_KEY || "";

const sb = createClient(SB_URL, SB_KEY);

function embed(q: string): Promise<number[]> {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ model: "voyage-3.5-lite", input: [q], input_type: "query" });
    const req = https.request({
      hostname: "api.voyageai.com", path: "/v1/embeddings", method: "POST",
      headers: { "Authorization": `Bearer ${VOYAGE}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (r) => { let d=""; r.on("data", x=>d+=x); r.on("end", ()=>res(JSON.parse(d).data?.[0]?.embedding ?? [])); });
    req.on("error", rej); req.write(body); req.end();
  });
}

(async () => {
  const e = await embed("who is Oongka?");
  console.log(`Embedding dim: ${e.length}\n`);
  // Repeat the exact eval call 5 times to see if it's nondeterministic
  console.log("=== 5x repeat of exact eval call (mc=20, t=0.25, filter=character) ===");
  for (let i = 1; i <= 5; i++) {
    const params: Record<string, unknown> = {
      query_embedding: e,
      match_threshold: 0.25,
      match_count: 20,
      content_type_filter: "character",
    };
    const { data, error } = await sb.rpc("match_knowledge_chunks", params);
    if (error) { console.log(`run${i}: ERROR ${error.message}`); continue; }
    const oongkaCount = (data || []).filter((c: { source_url: string }) => c.source_url.toLowerCase().includes("oongka")).length;
    console.log(`run${i}: total=${data?.length ?? 0}  oongka=${oongkaCount}  top_sim=${(data?.[0] as { similarity?: number })?.similarity?.toFixed(3) ?? "n/a"}`);
  }

  // Now — same call but WITHOUT setting filter. Eval's fallback path.
  console.log("\n=== Unfiltered call (eval fallback path) ===");
  for (let i = 1; i <= 3; i++) {
    const { data } = await sb.rpc("match_knowledge_chunks", {
      query_embedding: e,
      match_threshold: 0.25,
      match_count: 14, // K + 4 from eval
    });
    const types = new Map<string, number>();
    (data || []).forEach((c: { content_type: string }) => types.set(c.content_type, (types.get(c.content_type) ?? 0) + 1));
    console.log(`run${i}: total=${data?.length ?? 0}  byType=${JSON.stringify(Object.fromEntries(types))}  top_sim=${(data?.[0] as { similarity?: number })?.similarity?.toFixed(3) ?? "n/a"}`);
  }
})().catch(console.error);
