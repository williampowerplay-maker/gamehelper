/**
 * Seed script batch 3: Advanced secrets & tips
 * Usage: npx tsx scripts/seed-knowledge-batch3.ts
 * APPENDS to existing knowledge base.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
envContent.split("\n").forEach((line) => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const VOYAGE_KEY = env.VOYAGE_API_KEY;

interface VideoSource {
  videoId: string;
  title: string;
  channel: string;
  url: string;
  contentType: string;
  region?: string;
  questName?: string;
  transcript: string;
}

const videos: VideoSource[] = [
  {
    videoId: "jbV19PCWy_4",
    title: "Iconic Armor, Unlimited Gold Bars & Advanced Secrets",
    channel: "KhrazeGaming",
    url: "https://www.youtube.com/watch?v=jbV19PCWy_4",
    contentType: "mechanic",
    transcript: `Crimson Desert — Iconic Armor, Unlimited Gold Bars & Advanced Secrets:

FREE SKILLS FROM OBSERVING NPCS (8 total, saves Abyss Cores):
Available from Chapter 1 in Hernand. Watch NPCs perform combat moves to learn them for free:
1. Charge Shot: Observe the archer in Lion Crest Manor's main courtyard
2. Counter: Observe two soldiers training behind Lion Crest Manor
3. Spinning Slash proficiency: Observe first soldier at training grounds (up stairs, right side of manor)
4. R2 Heavy Attack proficiency: Observe soldier next to him at same training grounds
5. Spinning Kick (Damiane only): Observe last soldier at arena training grounds
6. Counter (alternate): Spear soldier at start of arena
7. Fisted Combat proficiency: Observe children training at second training grounds south of Hernand
8. Focus mechanic: During the Nature's Grasp quest, pull out your lantern inside the location and observe
These save 8 abyss cores you can invest elsewhere. Even if you reset skills later, you keep these free abilities.

AERIAL STAB TRAVERSAL TRICK:
Upgrade Stab ability to the third level (Aerial Stab). After a double jump with sword and shield, press R1+Triangle to perform aerial stab in any direction — including straight up. Spam it for as long as you have stamina to gain massive height. Much more efficient than grab-jump for climbing castles, walls, and mountains. Costs way less stamina per vertical meter.

GREYWOLF ARMOR SET (Cover Art / Trailer Armor):
Unlocked during the quest "The Wolf's Ballad" which opens as you progress Greymane faction missions (recruitment chain). Travel to Damis region, east of Damus, north of Delasia. Help the Drake (former Greymane).
BOSS: Queen Stone Back Crab. Strategy:
- Use heavy attacks on its back to reveal green weak points (3-4 of them)
- Latch onto green weak points, use R2/stab for massive damage
- Repeat until blue HP bar collapses
- Once only red HP remains, climb on back and use any heavy attack for huge damage
After the quest, Dedrick appears at your Greymane camp selling both the default Greymane armor and the upgraded Greywolf Leather Armor Set. Every piece has lightning resistance — very useful for certain boss fights.

DEEP RED DYE (Closest to Black):
Location: Ford Cabin, northeast of Hernand. Clear enemies inside, go to second floor. Find the small red bottle on the table (or ground if destroyed). Need a mask to steal it even though no one is around. Consume from inventory, then use at the dye specialist. The darkest version is very close to black. Change the material on item parts for a deep black with no red tint.

UNLIMITED GOLD BARS — PICKPOCKET FARM:
Location: Wildlife Park, south of Deminous City. NPCs in bunny hats roam the area.
Method:
1. Equip mask
2. Use lantern to scan NPCs — look for ones carrying gold bars (not regular goods bags)
3. Bump into target while holding/spamming square to pickpocket
4. Run a few meters outside the heat radius to lose aggro
5. Repeat with other NPCs
Each NPC carries 1-5 gold bars per pickpocket. Multiple levels to the park with more NPCs. If an NPC only has regular loot, leave and return to re-roll.
Gold bar value: 190 silver if sold to vendors, but 500 silver if exchanged at a bank. Always use the bank.
Bank investment: Available but not recommended — only 2% return on high-risk strategy after 22 hours. Not worth it.

UNLOCKING DU HAVEN FACTION & CHAINSAW (Flawless Timber):
Travel to Dellayia region. Soldiers are hostile even if you help liberate castles.
Workaround: Defeat soldiers on roads until the Du Haven disguise drops (chest piece + helmet). Equip both. If castle soldiers still attack, teleport away and back to reset the zone.
Inside the castle, find the Researcher NPC. Get the second research in the first row for the Chainsaw.
Requirements: First research needs 1 diamond (found in cave south of Greymane camp in same Creas area).
Complete follow-up missions in Dellayia, then craft the chainsaw at Steel Spike Armory (north of castle). Send Greymanes to craft it, then collect from camp stash.
CRITICAL: Upgrade chainsaw to level 6 to unlock Expert Logging — doubles timber yield (20% bonus + flawless timber drops). Add gem slots for even more. 5-10 trees = ~40 flawless timber.

GHILLIE SUIT (Stealth Hunting & Mount Taming):
Requires: Complete first research mission for Porin (give 5 lavender). Learn the recipe.
Materials: Flawless timber (from chainsaw above) + Palmer Leaves (found around large tree in Pin village alcove, near water).
Benefits: Animals no longer run from you (easier hunting). Legendary horses no longer scared (easier taming, no stamina wasted chasing). Bears still hostile.

VENDOR PERMITS (Camp Stash Trick):
Reach 100 trust with any vendor → they sell a permit → activate from inventory → their inventory appears at your Greymane camp merchant. Works for blacksmiths (armor/weapons), innkeepers (food/recipes), and others. Best use: Get 100 trust with innkeepers in every town so your camp cook sells all their recipes/food. Trust building: Give vendors items they want (crafting materials, gold bags at +5 trust each for innkeepers).`,
  },
];

// ============ CHUNKING ============
interface Chunk {
  content: string;
  source_url: string;
  source_type: string;
  chapter: string | null;
  region: string | null;
  quest_name: string | null;
  content_type: string;
  character: string | null;
  spoiler_level: number;
}

function chunkTranscript(video: VideoSource): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = video.transcript.split(/\n\n+/).filter(s => s.trim().length > 50);
  for (const section of sections) {
    chunks.push({
      content: `[${video.title} - ${video.channel}]\n\n${section.trim()}`,
      source_url: video.url,
      source_type: "youtube",
      chapter: null,
      region: video.region || null,
      quest_name: video.questName || null,
      content_type: video.contentType,
      character: null,
      spoiler_level: 2,
    });
  }
  chunks.push({
    content: `[FULL GUIDE: ${video.title} - ${video.channel}]\n\n${video.transcript}`,
    source_url: video.url,
    source_type: "youtube",
    chapter: null,
    region: video.region || null,
    quest_name: video.questName || null,
    content_type: video.contentType,
    character: null,
    spoiler_level: 3,
  });
  return chunks;
}

// ============ EMBEDDING ============
async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!VOYAGE_KEY || VOYAGE_KEY === "your-voyage-api-key-here") return texts.map(() => null);
  const results: (number[] | null)[] = [];
  const batchSize = 10;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 3000));
    console.log(`   Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}...`);
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3.5-lite", input: batch, input_type: "document" }),
      });
      if (!res.ok) { results.push(...batch.map(() => null)); }
      else {
        const data = await res.json();
        for (let j = 0; j < batch.length; j++) results.push(data.data?.[j]?.embedding || null);
      }
    } catch { results.push(...batch.map(() => null)); }
    if (i + batchSize < texts.length) await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

// ============ MAIN ============
async function main() {
  console.log("🎮 Batch 3 — Advanced Secrets\n");
  const allChunks: Chunk[] = [];
  for (const video of videos) {
    const chunks = chunkTranscript(video);
    allChunks.push(...chunks);
    console.log(`📺 ${video.title}: ${chunks.length} chunks`);
  }
  console.log(`\n📊 Total: ${allChunks.length} chunks`);

  console.log("\n🧠 Generating embeddings...");
  const embeddings = await generateEmbeddingsBatch(allChunks.map(c => c.content));
  console.log(`   ${embeddings.filter(e => e !== null).length}/${allChunks.length} embedded`);

  let inserted = 0;
  for (let i = 0; i < allChunks.length; i++) {
    const { error } = await supabase.from("knowledge_chunks").insert({ ...allChunks[i], embedding: embeddings[i] });
    if (!error) inserted++;
    else console.error("Insert error:", error.message);
  }
  console.log(`\n✅ ${inserted}/${allChunks.length} inserted\n🎉 Done!`);
}

main().catch(console.error);
