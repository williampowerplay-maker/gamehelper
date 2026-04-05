/**
 * Run the 4 homepage starter questions through an exact mirror of the route.ts
 * retrieval pipeline (classify → vector → URL boost → rerank → relevance gate)
 * and report what the user actually sees.
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
const VOYAGE = env.VOYAGE_API_KEY;

// Exact copy of classifyContentType from route.ts (post-fix ordering + labyrinth handling)
function classifyContentType(question: string): string | null {
  const q = question.toLowerCase();
  const bossNames = [
    "kailok", "hornsplitter", "hernand", "ludvig", "gregor", "fortain",
    "gabriel", "lucian", "bastier", "walter", "lanford", "master du",
    "antumbra", "crimson warden", "crimson nightmare", "hexe marie",
    "demeniss", "trukan", "delesyia", "pailune", "saigord", "staglord",
    "reed devil", "blinding flash", "grave walker", "icewalker",
  ];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge)\b/.test(q)) return "recipe";
  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|gear|equipment|item|drop|loot|reward|obtain|upgrade|enhance)\b/;
  const getItemPhrases = /\b(how (do i|to) get|where (do i|can i) (find|get|buy|farm)|how (do i|to) unlock|how (do i|to) acquire)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return "item";
  if (/\b(where is|how do i get to|how to reach|how do i (solve|complete|clear|finish)|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|ruin|ruins|tower|temple|crypt|catacomb|sanctum)\b/.test(q)) return "exploration";
  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";
  if (/\b(skill|ability|talent|passive|active|skill tree|upgrade|mechanic|system|stamina|stat|attribute|combo|aerial|mount|how does the .+ work|how does .+ work)\b/.test(q)) return "mechanic";
  if (/\b(who is|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane)\b/.test(q)) return "character";
  return null;
}

async function embed(text: string): Promise<number[]> {
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5-lite", input: [text], input_type: "document" }),
  });
  const j = await r.json();
  return j.data[0].embedding;
}

async function runPipeline(question: string) {
  console.log("\n================================================================");
  console.log("Q:", question);
  console.log("================================================================");

  const cls = classifyContentType(question);
  console.log("classifier →", cls);

  const emb = await embed(question);

  // Vector search
  const rpcParams: Record<string, unknown> = { query_embedding: emb, match_threshold: 0.25, match_count: 12 };
  if (cls) rpcParams.content_type_filter = cls;
  const { data: vecData, error: vecErr } = await s.rpc("match_knowledge_chunks", rpcParams);
  console.log(`vector (${cls || "unfiltered"}): ${vecData?.length || 0} results${vecErr ? " ERR: " + vecErr.message.slice(0, 100) : ""}`);

  let chunks: any[] = vecData || [];

  // Unfiltered fallback
  if (chunks.length === 0 && cls) {
    console.log("  → unfiltered retry");
    const r2 = await s.rpc("match_knowledge_chunks", { query_embedding: emb, match_threshold: 0.25, match_count: 12 });
    console.log(`  unfiltered: ${r2.data?.length || 0} results${r2.error ? " ERR: " + r2.error.message.slice(0, 100) : ""}`);
    chunks = r2.data || [];
  }

  // URL-match boost (replica of route.ts)
  const boostKeywords = question
    .replace(/[^a-zA-Z0-9\s'-]/g, "")
    .split(/\s+/)
    .filter((w: string) => w.length > 3 && w[0] === w[0].toUpperCase())
    .slice(0, 4);
  const quotedNames = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
  const allBoostTerms = [...new Set([...boostKeywords, ...quotedNames])];
  console.log("boost terms:", allBoostTerms);
  const urlTerms = allBoostTerms.filter((t: string) => t.includes(" ")).map((t: string) => t.replace(/\s+/g, "+"));
  console.log("url terms:", urlTerms);

  if (urlTerms.length > 0) {
    const { data: urlMatches } = await s
      .from("knowledge_chunks")
      .select("id, content, source_url, content_type")
      .or(urlTerms.map((t: string) => `source_url.ilike.%${t}%`).join(","))
      .limit(10);
    console.log(`url-match boost: ${urlMatches?.length || 0} chunks`);
    const existingIds = new Set(chunks.map((c: any) => c.id));
    for (const c of urlMatches || []) {
      if (!existingIds.has(c.id)) chunks.push({ ...c, similarity: 0.88, keywordBoost: true });
    }
  }

  // Rerank: boost URL-match sources
  const urlTermsLower = allBoostTerms.map((t: string) => t.replace(/\s+/g, "+").toLowerCase());
  chunks = chunks.map((c: any) => {
    const url = String(c.source_url || "").toLowerCase();
    let boost = 0;
    if (urlTermsLower.some((t: string) => url.includes(t))) boost += 0.25;
    return { ...c, similarity: Number(c.similarity || 0.3) + boost };
  });
  chunks.sort((a: any, b: any) => Number(b.similarity) - Number(a.similarity));
  chunks = chunks.slice(0, 8);

  console.log("FINAL top 5 chunks:");
  for (const c of chunks.slice(0, 5)) {
    console.log(`  sim=${Number(c.similarity).toFixed(3)} type=${c.content_type} url=${String(c.source_url || "").slice(-55)}`);
  }

  // Relevance gate
  const hasRelevant = chunks.length > 0 && Number(chunks[0]?.similarity) > 0.3;
  console.log(`relevance gate: ${hasRelevant ? "PASS (Claude would be called)" : "FAIL (user sees snarky+explainer)"}`);
}

(async () => {
  for (const q of [
    "How do I solve the Azure Moon Labyrinth?",
    "Best strategy for Kailok the Hornsplitter?",
    "Where is the Saint's Necklace?",
    "How does the Abyss Artifact system work?",
  ]) {
    await runPipeline(q);
  }
})();
