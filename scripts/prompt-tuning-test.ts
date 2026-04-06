/**
 * Prompt tuning test — sends 10 diverse questions through the local pipeline
 * (Voyage embedding → Supabase vector search → context assembly)
 * and shows exactly what chunks Claude would receive + the raw response.
 *
 * Usage: npx tsx scripts/prompt-tuning-test.ts
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

const TEST_QUESTIONS = [
  // Boss
  { q: "Best strategy for Kailok the Hornsplitter?", expectedType: "boss" },
  { q: "How do I beat Reed Devil?", expectedType: "boss" },
  // Item/location
  { q: "Where is the Saint's Necklace?", expectedType: "item" },
  { q: "Where do I find the Hwando Sword?", expectedType: "item" },
  // Exploration
  { q: "How do I solve the Azure Moon Labyrinth?", expectedType: "exploration" },
  { q: "How do I get to Greymane Camp?", expectedType: "exploration" },
  // Mechanic
  { q: "How does the Abyss Artifact system work?", expectedType: "mechanic" },
  { q: "What does the Focused Shot skill do?", expectedType: "mechanic" },
  // NPC/character
  { q: "Who is Matthias?", expectedType: "character" },
  // Quest
  { q: "How do I complete the Embers of Return quest?", expectedType: "quest" },
];

async function getEmbedding(text: string): Promise<number[] | null> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5-lite", input: [text], input_type: "query" }),
  });
  if (!res.ok) {
    console.error("  Voyage error:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

// Simple classifier (mirrors route.ts logic)
function classifyContentType(q: string): string | null {
  const lower = q.toLowerCase();
  if (/boss|beat|defeat|kill|fight|strategy/.test(lower)) return "boss";
  if (/labyrinth|ruin|tower|dungeon|cave|solve/.test(lower)) return "exploration";
  if (/quest|mission|objective|complete/.test(lower)) return "quest";
  if (/who is|npc|character|merchant|vendor/.test(lower)) return "character";
  if (/where.*find|where.*get|where is|location of/.test(lower)) return "item";
  if (/how does|how do.*work|what does.*do|skill|mechanic|system|artifact/.test(lower)) return "mechanic";
  if (/craft|recipe|cook|brew/.test(lower)) return "recipe";
  if (/sword|armor|weapon|shield|ring|necklace|earring|bracelet/.test(lower)) return "item";
  return null;
}

async function testQuestion(question: string, expectedType: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Q: "${question}"`);
  console.log(`Expected type: ${expectedType}`);

  const classified = classifyContentType(question);
  console.log(`Classified as: ${classified ?? "null (no filter)"}`);

  const embedding = await getEmbedding(question);
  if (!embedding) {
    console.log("  FAILED — no embedding returned");
    return { question, status: "EMBED_FAIL", chunks: 0, classified };
  }

  // Vector search with filter
  const rpcParams: Record<string, unknown> = {
    query_embedding: embedding,
    match_threshold: 0.25,
    match_count: 7,
  };
  if (classified) rpcParams.content_type_filter = classified;

  const { data, error } = await supabase.rpc("match_knowledge_chunks", rpcParams);

  if (error) {
    console.log(`  RPC ERROR: ${error.message}`);
    return { question, status: "RPC_ERROR", chunks: 0, classified };
  }

  console.log(`  Vector results: ${data?.length ?? 0} chunks`);

  if (data && data.length > 0) {
    // Show top 5 chunks
    const top = data.slice(0, 5);
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const sim = Number(c.similarity).toFixed(3);
      const urlShort = String(c.source_url || "").split("/").pop() || "";
      const preview = String(c.content || "").replace(/\s+/g, " ").slice(0, 120);
      console.log(`  [${i + 1}] sim=${sim} type=${c.content_type} url=.../${urlShort}`);
      console.log(`      "${preview}..."`);
    }

    // Build context like route.ts does
    const context = data.slice(0, 3).map((c: any) => String(c.content || "")).join("\n\n---\n\n");
    const contextLen = context.length;
    console.log(`\n  Context sent to Claude: ${contextLen} chars from ${Math.min(data.length, 3)} chunks`);

    return { question, status: "OK", chunks: data.length, classified, topSim: Number(data[0].similarity).toFixed(3), contextLen };
  } else {
    // Try unfiltered fallback
    if (classified) {
      console.log("  Trying unfiltered fallback...");
      const { data: fallback } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: embedding,
        match_threshold: 0.25,
        match_count: 7,
      });
      console.log(`  Unfiltered results: ${fallback?.length ?? 0} chunks`);
      if (fallback && fallback.length > 0) {
        for (let i = 0; i < Math.min(fallback.length, 3); i++) {
          const c = fallback[i];
          console.log(`  [${i + 1}] sim=${Number(c.similarity).toFixed(3)} type=${c.content_type} url=.../${String(c.source_url || "").split("/").pop()}`);
        }
        return { question, status: "FALLBACK_OK", chunks: fallback.length, classified };
      }
    }
    console.log("  NO RESULTS — would show snarky no-info response");
    return { question, status: "NO_RESULTS", chunks: 0, classified };
  }
}

async function main() {
  console.log("Prompt Tuning Test — 10 diverse questions");
  console.log(`DB: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`Voyage model: voyage-3.5-lite, input_type: query`);

  const results = [];
  for (const t of TEST_QUESTIONS) {
    const r = await testQuestion(t.q, t.expectedType);
    results.push(r);
    // Rate limit courtesy
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(70)}`);
  for (const r of results) {
    const icon = r.status === "OK" ? "PASS" : r.status === "FALLBACK_OK" ? "FALL" : "FAIL";
    console.log(`  [${icon}] ${r.chunks} chunks, classified=${r.classified ?? "null"} | "${r.question}"`);
  }
  const passes = results.filter((r) => r.status === "OK" || r.status === "FALLBACK_OK").length;
  console.log(`\n  ${passes}/${results.length} questions returned results`);
}

main().catch(console.error);
