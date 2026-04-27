/**
 * Ad-hoc qualitative test — 20 player questions, no ground truth needed.
 * Runs each question through the full retrieval pipeline then calls Claude Sonnet
 * (full tier) and prints: classifier label, top 3 source URLs, and Claude's answer.
 *
 * Usage:  npx tsx scripts/ad-hoc-test.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Env ───────────────────────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  try {
    const envPath = path.join(__dirname, "..", ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    content.split("\n").forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch { return {}; }
}
const env = loadEnv();
const SUPABASE_URL     = env.NEXT_PUBLIC_SUPABASE_URL    || process.env.NEXT_PUBLIC_SUPABASE_URL    || "";
const SUPABASE_KEY     = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const VOYAGE_API_KEY   = env.VOYAGE_API_KEY              || process.env.VOYAGE_API_KEY              || "";
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY          || process.env.ANTHROPIC_API_KEY           || "";

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing SUPABASE env vars"); process.exit(1); }
if (!VOYAGE_API_KEY)                { console.error("Missing VOYAGE_API_KEY");     process.exit(1); }
if (!ANTHROPIC_API_KEY)             { console.error("Missing ANTHROPIC_API_KEY");  process.exit(1); }

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Questions ─────────────────────────────────────────────────────────────────
const QUESTIONS = [
  // Bosses
  "How do I beat T'rukan the Ascended?",
  "How do I beat the Antumbra's Sword boss in the Sanctum of Absolution?",
  "What is the stun mechanic and how do I build up the stun meter?",
  // Puzzles / Sanctums
  "How do I solve the Sanctum of Revelation puzzle?",
  "How do I solve the Sanctum of Solace puzzle?",
  "How do I solve the Sanctum of Deliverance puzzle?",
  "How do I solve the Ancient Rift Maze Pillars puzzle?",
  "How do I solve the Spire of Ringing Truth puzzle?",
  // Locations
  "Where is Howling Hill Camp?",
  "Where is the blacksmith in Greymane Camp?",
  "How do I unlock fast travel locations?",
  // Mechanics
  "How does the Blinding Flash ability work?",
  "What do I lose when I die in Crimson Desert?",
  "Does equipment have a weight penalty?",
  // Crafting / Items
  "How do crafting manuals work?",
  "Where do I find refinement upgrade materials?",
  "What Abyss gear skills should I use?",
  // Economy / Progression
  "How do I make money in Crimson Desert?",
  "How does Private Storage work?",
  "What should I do first in the early game?",
];

// ── Classifier (copy from route.ts) ──────────────────────────────────────────
function classifyContentType(question: string): string | null {
  const q = question.toLowerCase();
  if (/\b(best build|optimal build|build for|builds for|what.*build|recommended build|endgame build)\b/.test(q)) return null;
  if (/\b(best (weapon|gear|armor|accessory|accessories|item|equipment) for (a ?)?(beginner|new player|early|starter)|starter (weapon|gear)|beginner (weapon|gear))\b/.test(q)) return null;
  if (/\b(what (weapons?|abilities|skills|classes|weapon types?) (can|does|do) \w+ use|what (weapons?|weapon types?) (are|is) (available|in the game))\b/.test(q)) return null;
  if (/\b(vs\.?|versus)\b|better than\b|compare.{0,30}(weapon|armor|skill|class)|(sword|spear|bow|axe|staff|dagger|ring|necklace|earring|armor|armour)\s+(or|vs)\s+\w|\bor\b.{0,30}\b(which (is |one )?(better|stronger|best|worse|worse))|which (is|one) (better|stronger|best)/.test(q)) return null;
  if (/\b(food (buff|bonus|effect|for|before|during|guide)|best food (for|to eat|before)|what (food|meal) (should|to|is good)|elixir (effect|buff|guide)|buff food|combat food|healing food|consumable (guide|tips?|buff|strategy)|what (to eat|should i eat|food (to use|gives))|food (that (gives|boosts?|increases?)|for (combat|fighting|bosses?|dungeons?)))\b/.test(q)) return null;

  const bossNames = ["kailok","hornsplitter","ludvig","gregor","fortain","gabriel","lucian","bastier","walter","lanford","master du","antumbra","crimson warden","crimson nightmare","hexe marie","trukan","saigord","staglord","saigord the staglord","reed devil","blinding flash","grave walker","icewalker","white horn","stoneback crab","queen stoneback crab","taming dragon","tenebrum","crowcaller","draven","cassius","kearush","myurdin","excavatron","priscus","muskan","cubewalker","lithus","black fang","hemon","beindel","gwen kraber","white bearclaw","queen spider","crookrock","desert marauder","rusten","abyss kutum","kutum","goyen","matthias","white bear","t'rukan","lava myurdin","ator","ator archon","marni's clockwork mantis","marni's excavatron","awakened lucian bastier","awakened ludvig","one armed ludvig","new moon reaper","full moon reaper","half moon reaper","beloth the darksworn","dreadnought","thunder tank","turbine","pororin forest guardians","fundamentalist goblins","golden star"];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some((n) => q.includes(n))) return "boss";

  if (/\b(puzzles?|strongbox|ancient ruins|sealed gate|disc puzzle|spire.{0,15}puzzle|sanctum.{0,15}puzzle|maze.{0,15}puzzle|ruins.{0,15}puzzle|how (do i|to) solve|puzzle solution)\b/.test(q)) return "puzzle";
  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge|cook|cooking)\b/.test(q)) return "recipe";
  if (/\b(new game\+?|ng\+|post.?game|after (beating|finishing|completing) the (game|story|main quest)|endgame (content|guide|tips?|activities?)|what (to do|is there) after (the )?(game|story|ending)|end game content|postgame|game\+)\b/.test(q)) return "mechanic";
  if (/\b(camp (management|system|upgrade|level|buildings?|feature|guide|expand|expansion)|greymane camp (guide|upgrade|system|how|expand)|faction (system|reputation|rank|guide|how)|how (do i|to) (upgrade|level up|build up|improve|expand|grow|develop) (my |the )?camp|base (building|management|upgrade|system)|camp (resources?|workers?|npc|unlock)|expand(ing)? (the |my |greymane )?camp|how (big|large) (can|does) (the |my )?camp (get|become|grow))\b/.test(q)) return "mechanic";
  if (/\b(mount(s)? (system|guide|tips?|unlock|how|work)|how (do i|to|do) (get|obtain|unlock|tame|ride|use) (a |the )?(mount|horse|pet|steed)|how do(es)? (mounts?|horses?|pets?) work|pet (system|guide|combat|unlock|how)|horse (guide|system|tips?|riding|unlock|taming)|riding (system|guide|tips?)|best (mount|horse|pet)\b)\b/.test(q)) return "mechanic";
  if (/\b(where is|how do i get to|how to reach|location of|find the area|map|region|dungeon|cave|castle|mine|fort|outpost|landmark|portal|entrance|how to enter|labyrinth|tower|temple|crypt|catacomb|sanctum|sanctorum|ranch|gate|basin|falls|grotto|ridge|beacon|ancient ruins$|ancient ruin$)\b/.test(q)) return "exploration";
  if (/\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list|what.{0,20}(good for|best for|work(s)? (well|good))|is .{3,30} (any )?good\b|which (weapon|sword|armor|gear|skill|accessory|build) (is|should|would|to))\b/.test(q)) return null;
  if (/\bbest\b.{1,25}\b(weapon|sword|bow|spear|axe|dagger|staff|armor|armour|headgear|helmet|gloves?|footwear|boots|cloak|ring|necklace|earring|accessory|accessories)\b/.test(q)) return null;
  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|equipment|item|artifact|drop|loot|reward|obtain|enhance)\b/;
  const getItemPhrases = /\b(where (do i|can i) (find|get|buy|farm|obtain)|how (do i|to) (acquire|obtain|get|find)|where to (find|get|buy|obtain)|how to get)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return "item";
  if (/\b(skill|ability|talent|passive|active|skill tree|mechanic|system|stamina|stat|attribute|combo|aerial|grapple|grappling|observation|abyss artifact|challenge|challenges|mastery|minigame|mini-game|fast travel|fast-travel|travel point|abyss nexus|traces of the abyss|how does the .+ work|how does .+ work|what does .+ do|refinement|refine|upgrade equipment|how to upgrade|how to heal|healing|potion|consumable|critical rate|critical chance)\b/.test(q)) return "mechanic";
  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter|talk to|deliver|collect for|bring to)\b/.test(q)) return "quest";
  if (/\b(who is|who are|character|npc|lore|backstory|relationship|faction|kliff|damiane|oongka|greymane|matthias|shakatu|myurdin|naira|yann|grundir)\b/.test(q)) return "character";
  return null;
}

// ── Voyage embedding ──────────────────────────────────────────────────────────
function embedQuery(question: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "voyage-3.5-lite", input: [question], input_type: "query" });
    const req = https.request(
      { hostname: "api.voyageai.com", path: "/v1/embeddings", method: "POST",
        headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => { try { resolve(JSON.parse(data).data?.[0]?.embedding ?? []); } catch (e) { reject(e); } });
      }
    );
    req.on("error", reject);
    req.write(body); req.end();
  });
}

// ── Retrieve (mirrors run-eval.ts) ────────────────────────────────────────────
interface Chunk { id: string; content: string; source_url: string; content_type: string; similarity: number; }

async function retrieve(question: string): Promise<{ chunks: Chunk[]; classifier: string | null }> {
  const contentTypeFilter = classifyContentType(question);
  const queryEmbedding = await embedQuery(question);

  const rpcParams: Record<string, unknown> = { query_embedding: queryEmbedding, match_threshold: 0.25, match_count: 18 };
  if (contentTypeFilter) rpcParams.content_type_filter = contentTypeFilter;

  let { data: chunks } = await supabase.rpc("match_knowledge_chunks", rpcParams) as { data: Chunk[] | null };

  if ((!chunks || chunks.length === 0) && contentTypeFilter) {
    const { data } = await supabase.rpc("match_knowledge_chunks", { query_embedding: queryEmbedding, match_threshold: 0.25, match_count: 14 }) as { data: Chunk[] | null };
    chunks = data;
  }

  // Keyword boost
  const stopWords = new Set(["how","what","where","when","why","who","which","does","the","and","for","are","but","not","you","this","that","with","have","from","they","will","just","than","then","here","some","there","about","into","can","could","would","should","did","find","get","give","buy","farm","craft","make","locate","obtain","show","tell","use","equip","upgrade","unlock"]);
  const boostKeywords = question.replace(/[^a-zA-Z0-9\s'-]/g, "").split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w.toLowerCase())).slice(0, 6);
  const quotedNames: string[] = question.match(/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g) || [];
  const cleaned = question.replace(/^(how (to|do i)|where (is|can i find)|what (is|are|does)|who is)\s+/i, "").replace(/^(the|a|an)\s+/i, "").replace(/\s+(quest|boss|fight|item|skill|location|guide|tips?)s?\s*$/i, "").trim();
  if (cleaned.split(/\s+/).length >= 2 && !quotedNames.some((n) => n.toLowerCase() === cleaned.toLowerCase())) quotedNames.push(cleaned);
  const allBoostTerms = [...new Set([...boostKeywords, ...quotedNames])];

  if (allBoostTerms.length > 0 && chunks) {
    const urlTerms = allBoostTerms.filter((t) => t.includes(" ")).map((t) => t.replace(/\s+/g, "+"));
    let kwChunks: Chunk[] = [];
    if (urlTerms.length > 0) {
      let q: any = supabase.from("knowledge_chunks").select("id,content,source_url,content_type").or(urlTerms.map((t) => `source_url.ilike.%${t}%`).join(","));
      if (contentTypeFilter) q = q.eq("content_type", contentTypeFilter);
      const { data } = await q.limit(10);
      if (data) kwChunks = data;
    }
    const existingIds = new Set(chunks.map((c) => c.id));
    for (const c of kwChunks) {
      if (!existingIds.has(c.id)) { chunks.push({ ...c, similarity: 0.88 }); existingIds.add(c.id); }
    }
    chunks = chunks.map((c) => {
      const content = (c.content || "").toLowerCase();
      let boost = 0;
      for (const t of allBoostTerms) { if (content.includes(t.toLowerCase())) boost += 0.04; }
      if (urlTerms.some((t) => (c.source_url || "").toLowerCase().includes(t.toLowerCase()))) boost += 0.08;
      return { ...c, similarity: (c.similarity || 0.3) + boost };
    });
    chunks.sort((a, b) => b.similarity - a.similarity);
  }

  return { chunks: (chunks || []).slice(0, 8), classifier: contentTypeFilter };
}

// ── Claude call ───────────────────────────────────────────────────────────────
async function callClaude(question: string, chunks: Chunk[]): Promise<string> {
  const context = chunks.map((c) => {
    const pageName = decodeURIComponent((c.source_url || "").split("/").pop() || "").replace(/\+/g, " ");
    return `[Source: ${pageName}]\n${c.content}`;
  }).join("\n\n---\n\n");

  const systemPrompt = `You are an expert companion AI for Crimson Desert. Answer based ONLY on the provided context. Format for quick scanning: short paragraphs, **bold key info**. If context doesn't cover the question, say so briefly.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }],
    }),
  });
  const data = await res.json() as any;
  return data.content?.[0]?.text || "(no response)";
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Ad-hoc qualitative test — ${QUESTIONS.length} questions`);
  console.log(`${"═".repeat(70)}\n`);

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    console.log(`\n${"─".repeat(70)}`);
    console.log(`[${i + 1}/${QUESTIONS.length}] ${q}`);

    try {
      const { chunks, classifier } = await retrieve(q);
      const urls = chunks.slice(0, 3).map((c) => {
        const name = decodeURIComponent((c.source_url || "").split("/").pop() || "").replace(/\+/g, " ");
        return `  • ${name} (${(c.similarity).toFixed(2)})`;
      });
      console.log(`Classifier: ${classifier ?? "none (full search)"}`);
      console.log(`Top sources:\n${urls.join("\n")}`);

      const answer = await callClaude(q, chunks);
      console.log(`\nAnswer:\n${answer}`);
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message}`);
    }

    await sleep(800); // rate-limit gap between Voyage calls
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("  Done.");
  console.log(`${"═".repeat(70)}\n`);
}

main().catch(console.error);
