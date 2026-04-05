/**
 * Focused debug for the Azure Moon Labyrinth question.
 * The filtered vector search is timing out — find out why.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const env: Record<string, string> = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n").forEach((l) => {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
  // 1) How many chunks per content_type?
  console.log("Chunks per content_type:");
  for (const t of ["boss", "item", "quest", "exploration", "mechanic", "recipe", "character"]) {
    const { count } = await s.from("knowledge_chunks").select("*", { count: "exact", head: true }).eq("content_type", t);
    console.log(`  ${t}: ${count}`);
  }

  // 2) What content_type is the Azure Moon Labyrinth page?
  const { data: azure } = await s
    .from("knowledge_chunks")
    .select("source_url, content_type, content")
    .ilike("source_url", "%Azure+Moon+Labyrinth%")
    .limit(5);
  console.log("\nAzure Moon Labyrinth chunks:");
  for (const r of azure || []) {
    console.log(`  type=${r.content_type}  content: "${String(r.content).slice(0, 100).replace(/\n/g, " ")}"`);
  }

  // 3) Embed the question and test filtered vs unfiltered vector search timing
  const VOYAGE_KEY = env.VOYAGE_API_KEY || "";
  const embRes = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5-lite", input: ["How do I solve the Azure Moon Labyrinth?"], input_type: "document" }),
  });
  const embJ = await embRes.json();
  const emb = embJ.data?.[0]?.embedding;
  console.log("\nEmbedding generated:", !!emb);

  console.log("\n-- Unfiltered vector search --");
  const t1 = Date.now();
  const r1 = await s.rpc("match_knowledge_chunks", { query_embedding: emb, match_threshold: 0.25, match_count: 8 });
  console.log(`  took ${Date.now() - t1}ms, results=${r1.data?.length || 0}, err=${r1.error?.message || "none"}`);
  for (const c of (r1.data || []).slice(0, 5)) {
    console.log(`    sim=${Number(c.similarity).toFixed(3)} type=${c.content_type} url=${c.source_url?.slice(-55)}`);
  }

  console.log("\n-- Filtered (exploration) vector search --");
  const t2 = Date.now();
  const r2 = await s.rpc("match_knowledge_chunks", {
    query_embedding: emb, match_threshold: 0.25, match_count: 8, content_type_filter: "exploration",
  });
  console.log(`  took ${Date.now() - t2}ms, results=${r2.data?.length || 0}, err=${r2.error?.message || "none"}`);
  for (const c of (r2.data || []).slice(0, 5)) {
    console.log(`    sim=${Number(c.similarity).toFixed(3)} url=${c.source_url?.slice(-55)}`);
  }

  console.log("\n-- Filtered (mechanic) vector search --");
  const t3 = Date.now();
  const r3 = await s.rpc("match_knowledge_chunks", {
    query_embedding: emb, match_threshold: 0.25, match_count: 8, content_type_filter: "mechanic",
  });
  console.log(`  took ${Date.now() - t3}ms, results=${r3.data?.length || 0}, err=${r3.error?.message || "none"}`);
})();
