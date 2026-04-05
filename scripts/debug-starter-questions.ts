/**
 * Debug why the homepage starter questions aren't returning results.
 * Runs each question through the full RAG pipeline (classify → embed → vector search →
 * keyword fallback) and prints what we get at each step.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const env: Record<string, string> = {};
try {
  fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}
const get = (k: string) => process.env[k] || env[k] || "";

const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
const VOYAGE_KEY = get("VOYAGE_API_KEY");

const STARTERS = [
  "How do I solve the Azure Moon Labyrinth?",
  "Best strategy for Kailok the Hornsplitter?",
  "Where is the Saint's Necklace?",
  "How does the Abyss Artifact system work?",
];

// Mirror of classifyContentType in route.ts (abridged)
function classifyContentType(question: string): string | null {
  const q = question.toLowerCase();
  const bossNames = ["kailok", "hornsplitter", "hernand", "ludvig", "reed devil"];
  if (/\b(beat|defeat|kill|fight|phase|weak ?point|strategy)\b/.test(q) || bossNames.some((n) => q.includes(n))) return "boss";
  if (/\b(craft|recipe|how to make|ingredients?|forge)\b/.test(q)) return "recipe";
  if (/\b(weapon|sword|bow|armor|ring|necklace|gear|item|drop|loot|obtain)\b/.test(q) || /\b(where (do i|can i) (find|get))\b/.test(q)) return "item";
  if (/\b(quest|mission|objective|storyline|story|chapter)\b/.test(q)) return "quest";
  if (/\b(where is|how do i get to|location of|region|dungeon|cave|labyrinth)\b/.test(q)) return "exploration";
  if (/\b(skill|ability|mechanic|system|stat|artifact)\b/.test(q)) return "mechanic";
  if (/\b(who is|character|npc|lore)\b/.test(q)) return "character";
  return null;
}

async function embed(text: string): Promise<number[] | null> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5-lite", input: [text], input_type: "document" }),
  });
  if (!res.ok) { console.error("voyage err", res.status, await res.text()); return null; }
  const j = await res.json();
  return j.data?.[0]?.embedding || null;
}

(async () => {
  for (const q of STARTERS) {
    console.log("\n================================================================");
    console.log("Q:", q);
    console.log("================================================================");

    const cls = classifyContentType(q);
    console.log("classified as:", cls);

    // 1) Direct keyword probe — does any chunk even contain the key noun?
    const keyTerms: Record<string, string[]> = {
      "How do I solve the Azure Moon Labyrinth?": ["Azure Moon", "Labyrinth"],
      "Best strategy for Kailok the Hornsplitter?": ["Kailok", "Hornsplitter"],
      "Where is the Saint's Necklace?": ["Saint's Necklace", "Saint"],
      "How does the Abyss Artifact system work?": ["Abyss Artifact", "Artifact"],
    };
    const terms = keyTerms[q] || [];
    for (const t of terms) {
      const { count: contentCount } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
        .ilike("content", `%${t}%`);
      const { count: urlCount } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
        .ilike("source_url", `%${t.replace(/\s+/g, "+")}%`);
      console.log(`  term "${t}": content=${contentCount}, url=${urlCount}`);
    }

    // 2) Embed + vector search via RPC
    const emb = await embed(q);
    if (!emb) { console.log("  (skipping vector search — embedding failed)"); continue; }

    const rpcParams: Record<string, unknown> = {
      query_embedding: emb,
      match_threshold: 0.25,
      match_count: 8,
    };
    if (cls) rpcParams.content_type_filter = cls;
    const { data: vecData, error: vecErr } = await supabase.rpc("match_knowledge_chunks", rpcParams);
    console.log(`  vector (filter=${cls}): ${vecData?.length || 0} results${vecErr ? " ERR:" + vecErr.message : ""}`);
    if (vecData && vecData.length > 0) {
      for (const c of vecData.slice(0, 3)) {
        console.log(`    sim=${Number(c.similarity).toFixed(3)} url=${c.source_url?.slice(-60)}`);
        console.log(`      "${String(c.content).slice(0, 120).replace(/\n/g, " ")}"`);
      }
    }

    // 3) Unfiltered fallback
    if ((!vecData || vecData.length === 0) && cls) {
      const { data: unf } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: emb, match_threshold: 0.25, match_count: 8,
      });
      console.log(`  vector (no filter): ${unf?.length || 0} results`);
      if (unf && unf.length > 0) {
        for (const c of unf.slice(0, 3)) {
          console.log(`    sim=${Number(c.similarity).toFixed(3)} url=${c.source_url?.slice(-60)}`);
        }
      }
    }
  }
})();
