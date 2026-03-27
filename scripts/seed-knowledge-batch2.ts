/**
 * Seed script batch 2: Boss guides + Item locations
 *
 * Usage: npx tsx scripts/seed-knowledge-batch2.ts
 *
 * This APPENDS to the existing knowledge base (does not clear).
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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const VOYAGE_KEY = env.VOYAGE_API_KEY;

interface VideoSource {
  videoId: string;
  title: string;
  channel: string;
  url: string;
  contentType: string;
  chapter?: string;
  region?: string;
  questName?: string;
  character?: string;
  transcript: string;
}

const videos: VideoSource[] = [
  // ===== BOSS GUIDES =====
  {
    videoId: "Xp0QiuCtN40",
    title: "How To Beat Beloth The Darksworn",
    channel: "Gaming Merchant 2",
    url: "https://www.youtube.com/watch?v=Xp0QiuCtN40",
    contentType: "boss",
    questName: "Beloth the Darksworn",
    region: "Hernand",
    transcript: `Beloth the Darksworn Boss Guide:

REWARD: One of the coolest armor sets in Crimson Desert.

PREREQUISITES: The boss won't spawn until you've completed 100% of Chapter 6 and started Chapter 7. No side quest required — just go to the location.

LOCATION: North of the H in Hernand on the map. Look for Hoenark Ruins. There's an Abyss Nexus (fast travel point) slightly north — activate it first in case you need to retry or adjust your build.

BUILD & PREPARATION:
- Use a two-handed weapon (Huando recommended — available anytime, many tutorials online)
- Get ice resistance gear: Hernand contribution store cloak (ice resistance level 3), Caner Plate Helm from smithy in Hernand Castle
- Optional: Equip Crow's Pursuit abyss core (from Toria Curved Sword in Chapter 5) for homing crow attacks that chip away at the boss
- Bring as much food as humanly possible — the area has constant cold damage ticking your health down
- Bring Palmer Pills for extra lives

ICE & FREEZE MECHANIC:
You're constantly taking cold damage (unless you have exceptional ice resistance). Your stamina bar gradually freezes over. When fully frozen, spam the sprint/A button to break free. Always do this behind cover — you're very vulnerable while frozen.

BOSS ATTACK PATTERNS:
1. Flurry Combo → Ice Slam: Multiple hits ending with an ice slam that can freeze you. The ice slam CAN go through pillars.
2. Flurry Combo → Spear Throw: Similar start but ends with a thrown spear that one-shots you. The spear CANNOT go through pillars.
3. Teleport Attack: If you get too far away, he teleports on top of you and one-shots you. Shoot with bow to trigger him to teleport close without the one-shot combo.

STRATEGY — PILLAR CHEESE:
1. At fight start, roll toward one of the stone pillars
2. Bait him into attacking near the pillar to destroy the surrounding ice, giving you room to move
3. Hug the pillar and circle around it
4. When he gets close, peek out with a two-handed R2/right trigger attack (long range), then immediately roll back behind the pillar
5. When he does his combos, stay behind cover until they finish, then counter-attack
6. After the SPEAR THROW (safe combo) — you can hit him 4-5 times before rolling back
7. After the ICE SLAM (dangerous combo) — only hit him 1-2 times, as he often teleports and counterattacks after
8. Use crow attacks (abyss core) when he stands far from the pillar in a standoff
9. Don't hug the pillar too tightly — attacks can clip through edges. Stay a few steps back.
10. If you build his yellow stagger bar, he gets dazed — unload heavy attacks. Make sure to clear your freeze debuff first so you don't waste the opening.

Rinse and repeat. Play very safely.`,
  },
  {
    videoId: "rKxwu5TtvV4",
    title: "How to Beat Kearush the Slayer",
    channel: "Fervor",
    url: "https://www.youtube.com/watch?v=rKxwu5TtvV4",
    contentType: "boss",
    questName: "Kearush the Slayer",
    transcript: `Kearush the Slayer Boss Guide:

OVERVIEW: This boss (the "monkey") is poorly balanced and will be a massive problem for many players. It's a war of attrition fight with three phases.

PREPARATION:
- Pop a defense pill, attack pill, and attack speed pill before the fight
- Bring lots of food and as many Palmer Pills as possible
- It's easier to spread the fight across multiple lives

STRATEGY — WALL CHEESE:
The key is to play around wall obstacles in the arena:
1. Position yourself behind walls and corners
2. When Kearush moves around the wall to reach you, that movement creates attack windows
3. Dodge behind walls to avoid his big attacks
4. Get hits in while he's walking around obstacles

KEY WARNINGS:
- Do NOT get caught in his attack strings — he does massive damage
- He has three phases — each gets more aggressive
- Between phases, do NOT fast forward through his animations — this can bug out and cause him to immediately hit you
- Phase 3: He instantly launches into his most powerful attack. Be ready to run to the nearest wall immediately and spam healing.
- After his big attacks in Phase 3, get a backflip hit in, then back into cover

GENERAL TIPS:
- Use lots of healing throughout
- Use wall obstacles constantly — this is the primary survival mechanic
- It's a patience fight — don't get greedy with attacks`,
  },
  {
    videoId: "Ba3oooMSaWw",
    title: "How to Beat Crimson Nightmare Boss",
    channel: "IGN",
    url: "https://www.youtube.com/watch?v=Ba3oooMSaWw",
    contentType: "boss",
    questName: "Crimson Nightmare",
    transcript: `Crimson Nightmare Boss Guide:

THE MAIN PROBLEM: The boss constantly emits poisonous red gas that inflicts damage over time when you get close, even if you dodge all attacks.

SOLUTION — GET A GAS MASK FIRST:
Before the fight, kill enemies around the fort where the boss resides. They can drop the Scarlet Blade Gas Mask. You may already have one in your inventory. Equip it to completely negate the poison gas DOT.

COMBAT STRATEGY:
1. Wait for a clear shot at the boss's CORE (the glowing center inside the crimson cloud)
2. Use Axiom Force Claw (telekinesis grab) to grab the core
3. Hold left trigger + pull left stick back to YANK the core out of the cloud
4. While the core is exposed and vulnerable, unleash your most powerful attacks:
   - Turning Slash
   - Blinding Flash Finisher
   - Any high-damage combos
5. Repeat this process

DEFENSE:
- His attacks are finicky to dodge — don't rely on dodging
- Instead: bring lots of health, good healing items, and hold up your shield to tank hits
- With gas mask equipped, his damage is actually quite manageable

DEALING WITH ADDS:
- Swarms of enemies surround the boss — ignore them
- Focus entirely on the boss core
- Once the boss dies, all surrounding enemies disappear and scatter

Should take about 3-4 pulls to defeat.`,
  },

  // ===== ITEM LOCATIONS =====
  {
    videoId: "j0lLIPSJlPM",
    title: "8 Unique Gear Locations (Hwando, Oath of Darkness, Knuckledrill)",
    channel: "LunarGaming",
    url: "https://www.youtube.com/watch?v=j0lLIPSJlPM",
    contentType: "item",
    region: "Hernand",
    transcript: `8 Unique Gear Locations in Crimson Desert:

OVERVIEW: Unique items have special abyss cores with unique abilities. You can remove these cores and add them to your favorite gear. Works for weapons, armor, and accessories.

1. OATH OF DARKNESS (Earring):
Location: Lock box in Bluemont Manor. Has defensive stats. Provides HP regen when refined to level 2+.

2. REFINED GOLD NECKLACE:
Location: Lock box in a different building at Bluemont Manor.

3. SAINT'S NECKLACE:
Location: Lock box in Hillside Manor. Has vitality ability and high defense stats. Gives stamina boost.

4. HUANDO (Unique Two-Handed Sword):
Location: Side building of Lion Crest Manor. Comes with Insight One abyss core. One of the best early game heavy weapons with high base damage.

5. ENGRAVED GOLD EARRING:
Location: Lock box in Lrest Gold Manor. Has +1 movement speed. Not technically unique as you can get a second from a quest.

6. ROIDED LARGE SHIELD:
Location: Chest inside Lancress Manor.

7. BRASS WARDEN PLATE GLOVES:
Location: Second chest inside Lancress Manor. Has 10% chance for additional timber (useful for bow upgrades).

8. MINING KNUCKLE DRILL (Weapon):
Location: Dropped by Marne the Excavatron boss during the "Stolen Quarry" quest for House Roberts.
TIP: Upgrade Force Palm to level 3 first — this unlocks the ability to stun enemies after 3 hits, making the Excavatron fight much easier.`,
  },
  {
    videoId: "Na3gJJhcWTQ",
    title: "How To Get A Katana Early + First City Hidden Secrets",
    channel: "KhrazeGaming",
    url: "https://www.youtube.com/watch?v=Na3gJJhcWTQ",
    contentType: "item",
    region: "Hernand",
    transcript: `How To Get A Katana Early + First City All Major Secrets:

HILLSIDE MANOR — SAINT'S NECKLACE:
Approach from the side (guards block the front). Look for openable windows — angle camera from below to make the button pressable. Inside, find the puzzle box. Solution: Line up the creases/dents on each knob to the bottom of the picture. Use the button on the right to test positions. Reward: Saint's Necklace (vitality ability, +stamina boost, high defense).

BLUEMONT MANOR — CRITICAL NECKLACE:
Enter through windows or door. Go to upper bedroom with balcony. Solve the puzzle box (same mechanic as before). Reward: Necklace with +1 critical rate — one of the few early items with this stat.

HOUSE ROBERTS — OATH OF DARKNESS:
Just outside Bluemont's courtyard. Upper office has an adjacent room with a puzzle box. Reward: Oath of Darkness earring (defenses, HP regen at level 2+ refinement).

LION CREST MANOR — HUANDO KATANA + MORE:
This manor has multiple treasures:
- Main building, first room: Puzzle box → Engraved Gold Earring (+1 movement speed)
- Adjacent office: Bookshelf → "Two-Handed Weapons of the World Vol. 2" (learn recipes for halberd, spear)
- Opposite side workshop: Treasure chest → Palmer Pill + shield
- First floor tunnel (opposite staircase, immediate right): Chest → Brass Warden's Plate Gloves (10% bonus timber)
- Barracks/guest house (adjacent building, left side): Climb upper window → War room chest → HUANDO KATANA
  - Two-handed weapon with high rod damage
  - Pre-equipped: Stamina Siphon Level 1, extra attack, extra critical rate
  - Stamina Siphon gives back stamina on hits — lets you spam abilities like Stab more often

DARK RINGLEADER ARMOR SET (Movement Speed Build):
Full set gives lots of movement speed (nearly as fast as a horse). All pieces found behind waterfalls — use Stab ability to lunge through:
- GLOVES: Cloud Mist Cave (southwest of city, behind waterfall midpoint)
- HELMET: Shadow Heart Grotto (further west, entrance at bottom of waterfall)
- CHEST PIECE: Blade Cavern (north of Shadow Heart, bottom of waterfall, right side). Has damage reduction that stacks with other damage reduction gear.
- CLOAK: Echoing Tunnel near Fort Perwin (behind waterfall, right side). Movement speed + ice resistance.

HOW TO ROB A BANK:
Banks exist in every major town. Requirements: mask + keys (buy from back alley shop outside city).
- Upper floor: Steal from strongboxes between bookshelves when no one watches (1-3 silver each)
- Lower floor: Use a key to unlock. Filled with treasure chests and strongboxes with crafting mats.
- -5 reputation per theft (easily recoverable from one mission giving +100)
- If caught: hard save first, or visit church to pay fine and erase bounty
- Yields 70-100 silver total per bank robbery`,
  },
  {
    videoId: "vq7nbXhBbqU",
    title: "5 Best Early Weapons You Need to Find",
    channel: "IGN",
    url: "https://www.youtube.com/watch?v=vq7nbXhBbqU",
    contentType: "item",
    region: "Hernand",
    transcript: `5 Best Early Weapons in Crimson Desert:

1. LEGIONARIES GLADIUS (Short Sword):
Perfect for players who prefer agility over reach. Location: North of Hernand Castle, cross the large bridge going northeast, turn left to the cliffs at Three Saints Falls. Find the Statue of Justice near a closed iron gate. Light the candles in the statue's hands → gate opens → chest with Gladius inside.

2. WAR SPIKE SPEAR (Secondary Weapon):
Superior reach for safe poking. Heavy attack combo clears small groups. Location: Southeast of Hernand where the river forks, west of Anvil Hill. Find the wooden Greymane shrine by the river — the spear is leaning on the side. Picking it up is NOT stealing.

3. HUANDO (Two-Handed Heavy Weapon):
Best early game heavy weapon. Even at level 1, base damage outclasses most merchant claymores. Pre-socketed with critical rate and stamina siphon cores. Location: Need a key + thief's mask (buy from back alley merchant near windmill, southeast Hernand). Go to Lion Crest Manor (north Hernand). Enter small stone building west of main manor through second floor window. Unlock store room door with key → glowing chest on floor.

4. SWORD OF THE LORD (One-Handed Magic Sword):
Unique enchantment sends out waves of force. Requires progressing the main story. Reward for beating the Chapter 2 boss (Hornsplitter/Kailok). You get the sword he was using during the fight.

5. SHIELD OF CONVICTION (Tower Shield):
Massive tower shield trading movement speed for incredible survivability. Built-in damage reduction + reduced stamina when blocking. Location: Ride north to Calfade sub-region (northwest of Hernand Castle over Haunted Hill, or across Roa's Will past Hook Rapids to Deep Frog Basin). In the town west of Calfade castle, find the Church of Calfade on the north side. Climb the bell tower, enter through the broken window on the west side → treasure chest inside. Ring the bell while you're up there to unlock the region on your map.

TIP: Visit a blacksmith after acquiring these — they can be refined to stay viable well into mid-game.`,
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
      chapter: video.chapter || null,
      region: video.region || null,
      quest_name: video.questName || null,
      content_type: video.contentType,
      character: video.character || null,
      spoiler_level: 2,
    });
  }

  chunks.push({
    content: `[FULL GUIDE: ${video.title} - ${video.channel}]\n\n${video.transcript}`,
    source_url: video.url,
    source_type: "youtube",
    chapter: video.chapter || null,
    region: video.region || null,
    quest_name: video.questName || null,
    content_type: video.contentType,
    character: video.character || null,
    spoiler_level: 3,
  });

  return chunks;
}

// ============ EMBEDDING ============

async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!VOYAGE_KEY || VOYAGE_KEY === "your-voyage-api-key-here") {
    return texts.map(() => null);
  }

  const results: (number[] | null)[] = [];
  const batchSize = 10;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 3000));
    console.log(`   Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (${batch.length} texts)...`);

    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VOYAGE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3.5-lite",
          input: batch,
          input_type: "document",
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`   Voyage API ${res.status}: ${errText.slice(0, 200)}`);
        results.push(...batch.map(() => null));
      } else {
        const data = await res.json();
        for (let j = 0; j < batch.length; j++) {
          results.push(data.data?.[j]?.embedding || null);
        }
      }
    } catch (e) {
      console.error("   Embedding error:", e);
      results.push(...batch.map(() => null));
    }

    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

// ============ MAIN ============

async function main() {
  console.log("🎮 Crimson Desert KB — Batch 2 (Boss Guides + Item Locations)");
  console.log("=============================================================\n");

  const allChunks: Chunk[] = [];

  for (const video of videos) {
    const chunks = chunkTranscript(video);
    allChunks.push(...chunks);
    console.log(`📺 ${video.title}: ${chunks.length} chunks`);
  }

  console.log(`\n📊 Total chunks to insert: ${allChunks.length}`);

  // Track sources
  for (const video of videos) {
    const { error } = await supabase.from("sources").upsert(
      {
        url: video.url,
        source_type: "youtube",
        title: video.title,
        last_ingested: new Date().toISOString(),
        chunk_count: chunkTranscript(video).length,
      },
      { onConflict: "url" }
    );
    if (error) console.error(`Source error for ${video.title}:`, error.message);
  }

  // Generate embeddings
  console.log("\n🧠 Generating embeddings...");
  const embeddings = await generateEmbeddingsBatch(allChunks.map(c => c.content));
  const embedded = embeddings.filter(e => e !== null).length;
  console.log(`   Generated ${embedded}/${allChunks.length} embeddings`);

  // Insert chunks
  let inserted = 0;
  for (let i = 0; i < allChunks.length; i++) {
    const { error } = await supabase.from("knowledge_chunks").insert({
      ...allChunks[i],
      embedding: embeddings[i],
    });

    if (error) {
      console.error(`Insert error:`, error.message);
    } else {
      inserted++;
    }
  }

  console.log(`\n✅ Inserted ${inserted}/${allChunks.length} chunks`);
  console.log("\n🎉 Batch 2 seeding complete!");
}

main().catch(console.error);
