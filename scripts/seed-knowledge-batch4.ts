/**
 * Seed script batch 4: XP/Gold/Abyss Gear farming & Witch locations
 * Usage: npx tsx scripts/seed-knowledge-batch4.ts
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

interface VideoSource { videoId: string; title: string; channel: string; url: string; contentType: string; region?: string; transcript: string; }

const videos: VideoSource[] = [
  {
    videoId: "bkuGbYgtj6U",
    title: "Infinite XP, Gold, Abyss Gear — How To Get Overpowered",
    channel: "TagBackTV",
    url: "https://www.youtube.com/watch?v=bkuGbYgtj6U",
    contentType: "mechanic",
    transcript: `How To Get Overpowered in Crimson Desert — XP, Gold, Abyss Gear & Mining:

ABYSS GEAR SYSTEM EXPLAINED:
Base weapon stats are mostly the same — what makes weapons different is the abyss gears socketed into them (attack speed, attack increases, crow's pursuit, wind slash, etc.). Each witch sells different abyss gear recipes: attack, critical rate, attack speed, defense, damage reduction, and more.

CRAFTING & UPGRADING ABYSS GEARS:
- Craft level 1 versions at any witch
- Synthesize: 2x level 1 = 1x level 2. 2x level 2 = 1x level 3
- Extract base abyss gears from existing equipment to fuse into stronger versions — go to any witch and extract all base versions, then upgrade them
- Example: Just from free collected items, you can get Destruction Level 3 (+3 attack) and Fortification 1 (+3 defense)

ABYSS GEAR SOCKETING RULES (IMPORTANT):
- Attack/crit rate/attack speed abyss gears ONLY apply to the weapon currently in your hands
- One-handed weapon bonuses do NOT apply when using two-handed, and vice versa
- Armor should ONLY have defense-oriented abyss gears (defense, damage reduction, fortitude)
- Glove attack bonuses only apply to unarmed/punching combat
- Boot attack bonuses only apply to kicking combat
- Focus socketing into your main weapon first
- Unlocking 5 gear slots costs 105 silver per weapon

SPECIAL SYNTHESIS (GAMBLING):
Use tier 1 abyss gears as materials for special synthesis. Results are random: tier 1, tier 2, or greater abyss gear (4% chance). Save scum by saving before synthesizing — reload if you don't get what you want. Can chain: roll tier 1 → tier 2 → tier 3 with successive gambles.

BEST MINING LOCATION:
Location: Menace region, near the legendary horse spawn. Fast travel point right next to it.
Resources: Epidote, copper, azurite, skolite, 4x garnet nodes (needed for abyss gear crafting), iron ore.
IMPORTANT: Use pickaxe, NOT heavy attacks or Force Palm. Pickaxe gives 2x resources per node; Force Palm/heavy attacks only give 1x. Half the resources for slightly faster speed is not worth it.

BEST XP FARM #1 — DRAKE'S FALL CASTLE (Abyss Gear + XP + Money):
Location: Drake's Fall Castle (has teleporter nearby).
What: Farm bismuth crabs that drop abyss gears, abyss cells, and give XP. Fill the yellow XP bar on minimap to earn abyss artifacts.
CRITICAL WARNING: Do NOT kill the large crabs — they are spawners. If you kill them, the small crabs stop spawning and you permanently lock yourself out of this farm. Do NOT use AoE builds here.
This farm provides: XP (abyss artifacts), abyss gear drops (insight, attack, destruction cores), abyss cells, and money from selling drops.

BEST XP FARM #2 — ELITE POT ENEMIES:
Location: South of Drake's Fall Castle, near a mysterious energy point (do NOT solve the puzzle — it may lock the farm).
What: High concentration of elite "pot" enemies that pop out of the ground. Very easy to kill with heavy attacks. Drop epidote, garnets, abyss cells, abyss gears. Massive XP gain.
Less effective for abyss gear drops than Drake's Fall, but better pure XP farm.

ABYSS CELLS & FARMING:
Open abyss cells in your inventory to obtain seeds. Plant seeds at your farm (unlocked through story). Takes a few in-game days to grow. Worthwhile investment for abyss gear materials.

UNLIMITED GOLD BARS:
Location: Animal Wildlife Park, south of Demenace. Nobles in bunny hats.
Method: Use lantern to scan for nobles carrying gold bars. Equip mask only when targeting. Bump into target while spamming square to pickpocket. Sprint out of the zone before theft meter expires. Remove mask, repeat.
Gold bars: 190 silver at vendors, 500 silver at banks. Always sell at banks.
Tip: Don't wear mask while scouting. Only equip when ready to pickpocket. Put weapons away for better pickpocket success.

ALL WITCH LOCATIONS (Abyss Gear Recipes):
All witches can be found from the beginning of the game.

1. ELOIN (Witchwoods) — First witch, met entering Chapter 3. Easiest to access. Use her for all crafting since she's closest.

2. BARI (Witch of Kindness) — Paleon Mountain, in the snow. Light the brazier in front of her to warm her up. Her shop is a bit north of where you find her. Sells: Ancient Shell Ring (stamina regen 2%, attack speed, attack), abyss artifacts, faded abyss artifacts. Gear blueprints: Swift (attack speed), Ascent (climb speed), Haste (movement speed) — great for exploration builds.

3. WITCH OF HUMILITY — North in Menace region, hanging from a bridge in a small town. Help her down. Her shop is far south in Serpent Marsh (fast travel point on nearby cliff, then through a cave, turn left). Blueprints: Fortification (+3 defense, for armor/shields), Aegis (damage reduction 1.0), Fortitude (guard stamina cost -3%). Best for tanky builds.

4. WITCH OF STRENGTH — North, below Tash Calp on the map. Find a beggar boy and give him one copper. IMPORTANT: She only appears at her home after you complete all sanctum cleansing quests for the other three witches. Has the best offensive abyss gear: attack, crit rate, attack speed blueprints.`,
  },
];

interface Chunk { content: string; source_url: string; source_type: string; chapter: string | null; region: string | null; quest_name: string | null; content_type: string; character: string | null; spoiler_level: number; }

function chunkTranscript(video: VideoSource): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = video.transcript.split(/\n\n+/).filter(s => s.trim().length > 50);
  for (const section of sections) {
    chunks.push({ content: `[${video.title} - ${video.channel}]\n\n${section.trim()}`, source_url: video.url, source_type: "youtube", chapter: null, region: video.region || null, quest_name: null, content_type: video.contentType, character: null, spoiler_level: 2 });
  }
  chunks.push({ content: `[FULL GUIDE: ${video.title} - ${video.channel}]\n\n${video.transcript}`, source_url: video.url, source_type: "youtube", chapter: null, region: video.region || null, quest_name: null, content_type: video.contentType, character: null, spoiler_level: 3 });
  return chunks;
}

async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!VOYAGE_KEY || VOYAGE_KEY === "your-voyage-api-key-here") return texts.map(() => null);
  const results: (number[] | null)[] = [];
  const batchSize = 10;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 3000));
    console.log(`   Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}...`);
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "voyage-3.5-lite", input: batch, input_type: "document" }) });
      if (!res.ok) results.push(...batch.map(() => null));
      else { const data = await res.json(); for (let j = 0; j < batch.length; j++) results.push(data.data?.[j]?.embedding || null); }
    } catch { results.push(...batch.map(() => null)); }
    if (i + batchSize < texts.length) await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

async function main() {
  console.log("🎮 Batch 4 — XP/Gold/Abyss Gear Farming\n");
  const allChunks: Chunk[] = [];
  for (const video of videos) { const chunks = chunkTranscript(video); allChunks.push(...chunks); console.log(`📺 ${video.title}: ${chunks.length} chunks`); }
  console.log(`\n📊 Total: ${allChunks.length} chunks`);
  console.log("\n🧠 Generating embeddings...");
  const embeddings = await generateEmbeddingsBatch(allChunks.map(c => c.content));
  console.log(`   ${embeddings.filter(e => e !== null).length}/${allChunks.length} embedded`);
  let inserted = 0;
  for (let i = 0; i < allChunks.length; i++) { const { error } = await supabase.from("knowledge_chunks").insert({ ...allChunks[i], embedding: embeddings[i] }); if (!error) inserted++; else console.error("Insert error:", error.message); }
  console.log(`\n✅ ${inserted}/${allChunks.length} inserted\n🎉 Done!`);
}
main().catch(console.error);
