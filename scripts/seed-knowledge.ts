/**
 * Seed script: Chunks YouTube transcripts and inserts them into Supabase.
 *
 * Usage: npx tsx scripts/seed-knowledge.ts
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
 * Optional: OPENAI_API_KEY (for generating embeddings — without it, chunks are stored without embeddings)
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load env vars from .env.local
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

// ============ TRANSCRIPT DATA ============
// Each video is pre-tagged with metadata for the knowledge base

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
  {
    videoId: "5M32DoUDmWY",
    title: "How to Easily Beat KAILOK the Hornsplitter in Crimson Desert",
    channel: "Jay Dunna",
    url: "https://www.youtube.com/watch?v=5M32DoUDmWY",
    contentType: "boss",
    questName: "Kailok the Hornsplitter",
    character: "Kliff",
    transcript: `Kailok the Hornsplitter Boss Guide:

This boss is very challenging but beatable with the right strategy.

DODGING: Lock onto him with left bumper and press and hold the dodge button (circle/B). This gives you a huge dodge with a follow-up attack that knocks him down for a free attack. When you see his blade glowing blue, dodge through those attacks. When his blade glows red, press right stick to do the punch attack (force palm).

PARRYING: You can parry most of his other attacks. Use parry to interrupt his attack chains.

SHIELD STRATEGY: Press right back trigger to start with the shield. The second attack after that rushes forward with your shield, closing the gap quickly. The shield also has a good stun effect.

KNOCKDOWNS: Knocking him down is one of the easier ways to deal damage and interrupts his combos. You can sometimes combo him off walls.

POSTURE BREAK: You will break his posture at least once during the fight. When this happens, spam quick attacks (don't use shield - it's a DPS drop).

FOOD IS CRITICAL: Use food items for healing. Cook meals before the fight. You can also upgrade your weapon at the blacksmith and get better armor.

GENERAL TIPS: Play defensively. This fight punishes aggressive play. Focus on parrying and dodging. Bring at least 5 healing food items. Upgrade your weapon before attempting this fight.`,
  },
  {
    videoId: "m9RTnslu1tY",
    title: "How to Beat Excavatron Boss Guide",
    channel: "IGN",
    url: "https://www.youtube.com/watch?v=m9RTnslu1tY",
    contentType: "boss",
    questName: "Excavatron",
    region: "Karen Quarry",
    transcript: `Excavatron Boss Guide:

LOCATION: The Excavatron is found west of the Karen Quarry Hearth. It's part of the House Roberts faction quest "Estate and Dismay" — speak with the man near Bluemont Manor to start.

PREPARATION:
- Upgrade weapon to level 6 (mine copper and iron ore, find bloodstone veins for level 5-6 upgrades)
- Buy Bolton armor from the contribution shop in Hernand
- Invest skill points in health so you don't get one-shot
- Stock up on food: buy ingredients from the groceryer and meat from the butcher, cook everything
- Activate the Abyss Nexus south of the boss for fast travel

BASIC STRATEGY: When close, the Excavatron pulls back his arms and lunges forward to drill you. You have time for TWO strikes before he powers through to hit you. Do two hits, then use the right bumper + right trigger power attack (which has invincibility frames).

DODGE AFTER POWER ATTACK: His drill stays active after your power attack lands, so dodge immediately after.

UNDERGROUND PHASE: When you see a red flash, he's about to burrow. Hit him with Force Palm to stun him before he finishes drilling. If you miss, sprint around the area when he reemerges.

CONTINUOUS POP-UP ATTACK: When there's a red flash around his head and the screen darkens, he'll continuously pop up to attack. Sprint and roll to avoid — rolls have more invulnerability in the middle.

REWARD: Mining Knuckle Drill weapon and a map marking gold vein locations.`,
  },
  {
    videoId: "OvVibtM4i1o",
    title: "How to Defeat the Reed Devil EASILY",
    channel: "Gamer Guides",
    url: "https://www.youtube.com/watch?v=OvVibtM4i1o",
    contentType: "boss",
    questName: "Reed Devil",
    region: "Mountain of Frozen Souls",
    transcript: `Reed Devil Boss Guide (3+ phases):

LOCATION: Progress main story to "Dance with the Devil" objective. Head far south of the Howling Hills to find stairs going up into the Mountain of Frozen Souls.

PREPARATION:
- Mine ore and upgrade armor and weapon in Hernand
- Buy the K set from the blacksmith in Hernand
- Stock up heavily on food (hunt deer in the forest near Howling Hills)
- Invest at least one abyss artifact into stamina (needed for blocking fast attacks)
- Upgrade melee attacks fully

PRE-FIGHT TIP: You can ride your horse up the slope and skip the minion ambush entirely on the stairs. Highly recommended.

PHASE 1: Stay close and bait "attack combo one" — a flurry of attacks that are easy to parry by spamming the block button. This builds stun. If he does "attack combo two" (attacks then vanishes in smoke, attacks from above), dodge away instead of parrying. Watch for Swift Stab (dodge left/right) and thrown kunai (strafe or block). Fill the yellow stagger meter, then unleash heavy attacks for massive damage.

PHASE 2 (MOST ANNOYING): Reed Devil summons 5 totems you must destroy while he summons clones. Rush the totems and smash them. Use food to survive. Watch your stamina. After totems are down, he has very low HP — one hit triggers phase 3.

PHASE 3: Similar to phase 1 but with energy wave attacks. Stay as close as possible — he won't use energy waves if you're in his face. Parry and punish like phase 1. You can still stagger him with enough parries. Keep food supply up.`,
  },
  {
    videoId: "VHPSTLjIUmI",
    title: "12 Things to Do FIRST in Crimson Desert",
    channel: "IGN",
    url: "https://www.youtube.com/watch?v=VHPSTLjIUmI",
    contentType: "general",
    region: "Hernand",
    transcript: `12 Things to Do First in Crimson Desert:

1. GRAB THE FREE SHIELD AND SEALED ABYSS ARTIFACT: At the altar northeast of the stables north of Hernand. The shield has better stats than the starting Greywolf wooden shield. The sealed abyss artifact gives you a mastery challenge for skill points.

2. COMPLETE CHAPTER 1 FIRST: Finishing chapter 1 unlocks Axiom Force (telekinesis grab), Force Palm (powerful punch), and Flight (gliding). These are only available through the quest, not purchasable.

3. EXPAND YOUR INVENTORY: Complete the three "Tales of Hernand Merchant" quests from Rhett, Turnali, and Renee for 12 extra inventory slots. Renee's quest requires cooking "Modest Fish Porridge" (not regular). Buy additional slots from vendors.

4. GET A MASK FOR CRIMES: Buy from the back alley merchant southeast of Hernand, south of the church. Remove the mask when exploring to avoid being accused of crimes.

5. BUY KEYS: From the back alley merchant. Hundreds of locked doors throughout the game. Keys are consumed automatically when walking through locked doors.

6. ROB THE HERNAND BANK: With mask and key, enter the bank on the north side of Hernand, go through the left door. Loot strongboxes and chests. Wait for theft meter to drop, remove mask, exit. Minor contribution hit, easily recovered through quests. Bank restocks after a few in-game days.

7. RING THE BELL TOWERS: Climb the tower in center of Hernand (bell icon on minimap). Ringing the bell populates the map with icons and information. Do this in every major city.

8. ACTIVATE ABYSS NEXUS (FAST TRAVEL): Look for "mysterious energy" on the map. Stand on square pads to activate. Some are behind Abyss Crescent puzzles that also reward abyss artifacts.

9. INVEST IN STAMINA TO 200: Lets you use aerial maneuver and aerial swing (Spider-Man traversal). Put at least 4 points in stamina node in the blue skill tree branch.

10. LEVEL UP YOUR HORSE: Ride everywhere to gain horse XP. Level 2 unlocks dashing. Buy saddle and horseshoes from stables north of Hernand. Buy hay and sugar cubes for horse healing.

11. COLLECT RECIPES: Look for scroll icons on minimap. Cooked meals with multiple ingredients are the best healing items. You can sell recipe pages after learning them.

12. GET A PET: Pet stray animals in Hernand 5 times per day (+25 trust). Feed raw meat (+10 trust per item). At 100 trust, the animal becomes your pet and will loot fallen enemies during combat.`,
  },
  {
    videoId: "rTjtEIQ_I_0",
    title: "Tips And Tricks I Wish I Knew Earlier",
    channel: "JorRaptor",
    url: "https://www.youtube.com/watch?v=rTjtEIQ_I_0",
    contentType: "mechanic",
    transcript: `Crimson Desert Tips and Tricks:

FAST TRAVEL POINTS: Use Blinding Flash (L1+R1, hold R1) from high places to reveal glowing objects — these are often fast travel points. Question marks on the map can be fast travel points or puzzles for abyss artifacts.

ABYSS ARTIFACTS: Kill enemies to fill the yellow bar next to minimap for artifacts. Find Sealed Abyss Artifacts (purple icon on map, usually near roads). Complete their challenges for skill points. Check the dedicated challenges menu to see if you can complete old ones.

GEAR UPGRADES: Upgrade items at the blacksmith in Hernand to at least rank 4 (cheap, no abyss artifacts needed). Weapons need ore, some armor needs ore, other armor needs leather, accessories need small bones. Buy crafting resources from every vendor you visit — they're cheap and restock daily.

BOUNTY POSTERS: Pick up and inspect bounty posters to add quests to your map. Pro tip: Load one target on your horse, then carry a second target yourself to complete two bounties in one trip.

WEAPON REINFORCEMENT: Use the grindstone next to the blacksmith to sharpen weapons for extra damage. Make this part of your routine.

PETS: Pet dogs 5 times per in-game day (+25 trust). At 100 trust, they follow you and loot enemies. Pets may not always be at their location — return next in-game day.

INVENTORY TIPS: Sell completed bounty posters (10 copper each). Buy small backpacks from vendors (one-time purchase). Complete NPC requests for medium backpack (+3 slots, also gives +50 trust). Use "group items" to organize inventory.

VENDOR TRUST: Reaching 100 trust with vendors unlocks special items. Equipment shop at 100 trust sells a special kite shield with reduced guard stamina cost, plus craftng resources that restock daily.

FOOD STRATEGY: Buy food from the inn in Hernand (restocks daily). Clear soup recipe (available at start of Act 3) gives 180 health: just buy water, oats, barley from grocer shop + cheapest meat from meat vendor. These restock daily — make tons of soup.

RECIPES: Pick up recipe scrolls. After learning them, sell the scroll for cash.`,
  },
  {
    videoId: "B_jih_GZZ1w",
    title: "How To Unlock Elements Flame & Frost Magic - Full Abyss Puzzle Guide",
    channel: "Arekkz Gaming",
    url: "https://www.youtube.com/watch?v=B_jih_GZZ1w",
    contentType: "puzzle",
    region: "Hernand",
    transcript: `How to Unlock Flame & Frost Elemental Magic — Full Abyss Puzzle Guide:

OVERVIEW: The Frost and Flame elemental powers are NOT part of the main story — you can miss them entirely. This guide walks you through every puzzle and location needed to unlock both elements.

PREPARATION - ICE RESISTANCE GEAR:
Before starting, get the Reindeer Cloak for ice resistance. Head to the map location shown early in the guide — there's a hidden breakable wall. Use the Focused Force Palm punch (wait for the glowing tint of the orb) to break it. Inside the cave is a chest with the Reindeer Cloak. This is critical for later puzzles that require gliding over long frost-debuff distances where your stamina drains too quickly without it.

FLAME ELEMENT PUZZLES:
The Flame element requires solving a series of Abyss Crescent puzzles. Key puzzle types include:
- Rotating pillar puzzles: Use sprint + heavy attack to rotate stone pillars. Align symbols to match what statues are pointing at.
- Light beam puzzles: Use your sword's light ability to redirect beams to targets.
- Pressure plate puzzles: Step on plates in the correct sequence, watching for visual cues.
- Go board puzzle: Move white stones on a grid. Some positions are blocked by hermit crabs disguised as green bushes — hit them to clear the way. Align five white stones vertically to solve.

FROST ELEMENT PUZZLES:
The Frost element has its own chain of puzzles in colder regions:
- Gliding challenges: Requires ice resistance (Reindeer Cloak) to maintain stamina while gliding through frost debuff areas.
- Force Palm target puzzles: Hit specific targets with Force Palm — timing and positioning matter.
- Crystal alignment puzzles: Rotate crystals until light beams connect properly.

GENERAL TIPS:
- Some puzzles require abilities unlocked through main story progression (Force Palm, Axiom Force, gliding).
- Fast travel points (Abyss Nexus) are often near or part of these puzzle chains.
- Solving Abyss Crescent puzzles rewards Abyss Artifacts (skill points) AND unlocks fast travel.
- Several puzzles have environmental tricks: hidden walls, disguised obstacles (hermit crabs), vine barriers you can burn with sword light.`,
  },
  {
    videoId: "rLspeBvb1uc",
    title: "All Abyss Nexus & Abyss Cressets in Hernand + Puzzle Solutions",
    channel: "RatForge",
    url: "https://www.youtube.com/watch?v=rLspeBvb1uc",
    contentType: "puzzle",
    region: "Hernand",
    transcript: `All Abyss Nexus & Abyss Cressets in Hernand — Complete Guide:

OVERVIEW: Doing these early is a great way to get lots of skill points and move around the map much faster via fast travel. The guide covers all TP (teleport/fast travel) points and puzzle solutions in the Hernand region.

HANAN CITY STARTING POINTS:
- Main TP point is right in the center of Hanan City. Stand on it for a moment to activate.
- Northwest TP is tied to a quest — you may already have it.
- Southwest TP is at the end of a road.

GO BOARD PUZZLE (near southwest TP):
There's one movable white stone at the top. Two key positions are blocked by green bushes — these are actually hermit crabs. Hit them and they go away. Take the white stone and place it on the western side of the board, lining up five white stones vertically. This completes the capture and solves the puzzle. Reward: Abyss Crescent.

WATER DEVICE PUZZLE (west of city):
Learn the specific skill and use it on spinning devices. They're raised to remove the water. Positioning can be awkward — one planet is half submerged, stand at the exact right spot. Once done, the Abyss Crescent opens.

DARK MAZE (north from "D" in Hernand):
Jump down the hole and work through the maze. It's dark — use your lantern.

FOUNTAIN PILLAR PUZZLE (east of maze):
Use sprint + heavy attack to move fountain pillars. Make all the sprites face into the fountain to open the Abyss Crescent.

ANCIENT RIFT PUZZLES:
Inside the ancient rift, find puzzles where you shine the light from your sword to move objects. All need to be aligned at the top. Once opened, use Force Push on a plate on the floor to get an item. Two more items found by climbing up — one visible from the broken bridge, one reachable by gliding down.

RED LIGHT / GREEN LIGHT PUZZLE (east of ancient rift):
Stand on the pressure plate and move forward without the statue at the end seeing you. Red light, green light style. Jogging works best instead of sprinting.

BLOCK PATTERN PUZZLE:
Use sprint + heavy attack to slowly move blocks into the correct pattern. The puzzle speeds up — slow it down if needed.

ROTATING PILLAR NUMBER PUZZLE:
Sprint heavy attack on a pillar. Rotate until 2, 3, and 4 glow. Raise them halfway off the top of the left pillar block. Then do 3, 4, and 5. Raise 3 and 4 to match left pillar. Finally find 2 and 5 and balance everything out. Remember this for a later puzzle.

SYMBOL MATCHING PUZZLE (east of Hanan city):
Use sprint + heavy attack to move the pillar across symbols. Statues beam pointing to symbols. Match them based on what they're holding (horse, shield, etc.).

VINE BURNING PUZZLES (south of city):
Drop into holes, burn the vines using your sword's light. Use your vision to watch the memory and push the door open. Move the circles into the exact pattern to open the crescent. Multiple locations use the same mechanic.

TRAP SHACK PUZZLE:
Push through traps, pull the lever. Interact with walls: force push 2 and 3 on the left. On the right, force push 1, 3, and 4.

TILE STEPPING PUZZLE (southeast below river):
Take it slow — you can't step on the same tile twice. Match the symbols correctly.

STATUE ROTATION PUZZLE (south):
Rotate all statues to face the center. They need to be precise — you'll get a clear sign when correct.

MUSIC PUZZLE:
Read the board and input notes using arrows. Solution: 1 2 3 4 5 6 4 3 2 1 (may vary).

TOTAL: This covers all TP points and Abyss Cressets in the Hernand region.`,
  },
  {
    videoId: "LJPOqTyJa98",
    title: "All Strongbox Puzzle Locations and Solutions for Hernandian",
    channel: "Dan Allen Gaming",
    url: "https://www.youtube.com/watch?v=LJPOqTyJa98",
    contentType: "puzzle",
    region: "Hernand",
    transcript: `All Strongbox Puzzle Locations and Solutions — Hernandian:

PREPARATION: Bring a mask (buy from the guy who sells keys) and keys. Some strongbox items require stealing (crime), which needs a mask equipped. You lose -5 reputation with the faction, but it recovers. Stay in the room until the crime alert timer goes down.

STRONGBOX 1 — OWL PUZZLE (in town):
The easiest one. Follow the owl symbol prompts on each tile. After solving, equip your mask to steal the reward from the strongbox.

STRONGBOX 2 — SPINNING DIAL PUZZLE:
This is the one players struggle with most. Solution: 5 spins on the first dial, 2 spins on the second, 4 spins on the third, 3 spins on the fourth, 5 spins on the fifth. IMPORTANT: There's a button on the right side that reveals what you've done. Press it to check your progress — this is where most people get confused. Nothing visually moves until you press that reveal button to see alignment.

STRONGBOX 3 — CASTLE MUSICAL PUZZLE:
Located in the castle — you need a key to access. Go upstairs all the way to the room with the musical strongbox. Solution: Press keys in order 1, 7, 6, 7, 3, 4, 3. It plays a tune when correct.

STRONGBOX 4 — HILLSIDE MANOR PUZZLE:
Just outside the castle at the Hillside Manor. Enter through the window. Solution: 2 on the first, 3 on the second, 4 on the third, 5 on the fourth, 5 on the fifth.

STRONGBOX 5 — PICTURE PUZZLE:
Straightforward picture maneuvering/sliding puzzle. Self-explanatory once you see the interface.`,
  },
  {
    videoId: "llTHpApxKxY",
    title: "Azure Moon Labyrinth Puzzle Solution",
    channel: "GosuNoob",
    url: "https://www.youtube.com/watch?v=llTHpApxKxY",
    contentType: "puzzle",
    region: "Porean Forest",
    questName: "Azure Moon Labyrinth",
    transcript: `Azure Moon Labyrinth — Complete Puzzle Solution:

FINDING THE ENTRANCE:
If you've been wandering around the Witch's House and noticed the "mysterious energy" question mark nearby, you've probably ended up in a cave wondering where the Azour Moon Labyrinth is. The actual entrance is further away at the Fonial Ranch. Find the basement entrance there and descend.

GETTING PAST THE FIRE TRAPS:
The corridor has fire-spewing mechanisms. After many attempts, the best method is to hang on the walls as high as possible and shimmy across. If you catch the ceiling and can't move forward, get back on the sidewall. There are rest points between the fire traps.

THE MURAL MAP:
At the first rest point and in an alcove past the second fire trap, you'll see murals on the walls. These are maps with five red check marks. The map points to Porean Forest.

FINDING THE FIVE RUNES:
Using the mural as a guide, travel to Porean Forest and find five runes carved on trees at the locations shown on the mural map. You can overlap the in-game map with the mural to find precise locations. Write down each rune symbol — you'll need them for the final puzzle.

SOLVING THE PUZZLE:
Return to the Azure Moon Labyrinth. In the puzzle room, there are eight buttons with different runes. Press the five buttons matching the runes you found in Porean Forest. The order of the five rune locations corresponds to specific buttons.

REWARD: Unlocks the Azure Moon Labyrinth area with additional loot and exploration.

TIP: You don't need to discover the mural clues yourself — you can skip straight to finding the runes if you know the locations, or skip to pressing the correct buttons if you already know the solution.`,
  },
  {
    videoId: "GSQqNPqjOXQ",
    title: "Crimson Desert Beginners Guide & Early Tips & Tricks",
    channel: "LastKnownMeal",
    url: "https://www.youtube.com/watch?v=GSQqNPqjOXQ",
    contentType: "mechanic",
    transcript: `Crimson Desert Beginners Guide — Early Tips & Tricks:

CONTROLS & PACING:
Don't skip tutorial messages — everything tells you something incredibly relevant for controls. Do NOT rush into further parts of the map — enemy difficulty increases by location. The first town is the most important — it has the most tutorials. Do all starting missions (main story + faction quests).

FIRST TOWN PRIORITIES:
1. Visit notice boards (appear in most places) — they give you quests
2. Ring the bell in each city to reveal the map
3. Do ALL quests from factions (houses, requests, commissions, politics)
4. Complete main quest in starting city — it unlocks essential abilities

INVENTORY MANAGEMENT:
- Inspect lock boxes and enemy pouches to open them (contain silver and valuables)
- Items with a house symbol are decorations — sell them for good money early on
- Money is divided into bronze, silver, and gold denominations
- Buy bags (inventory expansions) from traders — inventory is very important

GATHERING & CRAFTING:
- Quests give tutorials for gathering wood and mining ores
- Ores are found at the foot of hills and mountainous areas
- Mining with pickaxe gives most yield; Force Push mining gives less but reaches high places
- No weight system — gather freely
- Ore veins respawn after about a week

EQUIPMENT:
- Switch between weapon types freely (dual wield, two-hander, sword & shield, spear, hammer)
- Don't over-refine starting gear — it's weak with no bonuses
- After beating Matias (first tutorial boss), buy gear from the trader outside the blacksmith
- Refine that gear to level 3 — enough for first region including starting bosses
- Higher refinement needs more rare ores found later in the game

SKILLS:
- Three skill trees: Red (health), Green (spirit), Blue (stamina)
- Invest in stamina first — it affects flying, running, fighting duration
- Some skills learned by watching enemies (taught in early missions)
- Skills can be inspected at level 3+ for bonus sub-upgrades
- Upgrade skills with Abyss Stones (found, earned from challenges, or from filling the XP bar)
- Locked Abyss Stones require specific challenges (e.g., "defeat 3 enemies with a sword within 30 seconds")
- Skills can be reset; plenty of Abyss Artifacts available

FOOD & HEALING:
- Food is your healing system — better food gives better healing plus bonuses (stamina, defense, attack)
- Cook in pots using recipes (scroll icons on minimap)
- Sell recipes after learning them
- Easy early food: hunt deer, skin them, cook meat (or use Reflect ability to cook with light)
- Fish in rivers/lakes — counter the fish direction, reel when tired, no bait needed
- Save high-tier food for boss fights; use low-tier for regular fights
- Always stock up on water (needed for cooking) — buy from traders daily

STEALING & BOUNTIES:
- Need a thief mask (dropped by bandits or from first bounty reward)
- Only steal when no one watches — bounty goes up, leads to jail and money loss
- Bounty posters (purple icons): capture targets alive (don't kill — reward halved), tie them up, carry on horse
- Fence (goblin near the mill) buys stolen goods, sells keys and outfits
- Keys open locked doors (consumed on approach — be careful)
- Most houses have accessible windows instead

PETS:
- Pet stray dogs and cats to increase trust
- Drop food in front of them for extra trust
- After a few days at max trust, they follow you and gather items

COMBAT:
- No difficulty options — fights are challenging
- Keep distance, prioritize archers first
- Shield enemies: use spin or stab attack to remove shield
- Parry with weapons or shield (control button)
- Enemies with star icons are stronger; dodge/parry red-glowing attacks
- Hold attack button for continuous attacks

MISCELLANEOUS:
- Liberate enemy-controlled locations for XP and loot (they become friendly afterward)
- Puzzles may require abilities unlocked later — come back when ready
- The game is a sandbox — don't rush, explore every nook and cranny
- Settlements give bonuses; missions increase storage space
- Contribution shop in castle sells gear for contribution points (earned from regional quests)`,
  },
  {
    videoId: "lc8XENwAzGw",
    title: "Ultimate Beginners Guide, Tips & Tricks",
    channel: "Arekkz Gaming",
    url: "https://www.youtube.com/watch?v=lc8XENwAzGw",
    contentType: "mechanic",
    transcript: `Crimson Desert Ultimate Beginner's Guide:

THREE QUICK TIPS:
1. Unlock every fast travel point (square pads on the floor). While gliding, pull out lantern to see fast travel points and points of interest.
2. Always carry a stack of food — food acts as potions in combat. Clear soup recipe (from Greymane camp) is cheap and effective.
3. Fully explore Hernand before moving to other regions. Enemies don't scale to your level — they're based on map location. Going too far too early = enemies way stronger than you.

QUEST STRUCTURE: Main story quests lead through the narrative. Faction quests are huge side content (helping NPCs, noble house quest lines, bounty posters, random encounters). Greymane faction quests introduce camp mechanics.

PACING TIP: Do main story until it sends you to unexplored areas, then pause and do faction missions in your current region first. Collect better gear, materials, and skill points before moving on.

INVENTORY: Faction quests reward inventory expansions. Vendors sell one-time bag upgrades (cheap, buy at every new town). Sell learned recipe items and weak early gear drops. Keep an axe and pickaxe in inventory at all times.

CONTRIBUTION VENDOR IN HERNAND: Located by the castle gate. Sells strong armor in exchange for contribution points (earned from quests/bounties in the region). These armor sets carry through mid-game. This is one of the best early gear sources.

GEAR UPGRADES: Get all gear to level 4 first (only needs basic materials). After level 4, upgrades require abyss artifacts — save those for skill points early on. Buy iron and copper ore from the equipment vendor outside the smithy (restocks daily).

RECOMMENDED EARLY SKILLS:
- Armed Combat: increases melee damage, adds combat moves
- Keen Sense + Evasive Roll: MUST PICKS — unlocks dodging and countering
- Forward Slash + Turning Slash: backbone of basic combat
- Nature's Echo (unlocked after maxing Forward Slash): adds echo damage
- Stamina upgrades: more climbing, sprinting, blocking
- Health upgrades: prevents one-shots from bosses
- Blinding Flash Finisher: powerful crowd control in slow motion
- Double Jump + Swift Flight: much better traversal

SKY ISLAND TRICK: Press R3 on the map to view sky islands. Fast travel to the one above Hernand, then jump off and glide toward your objective for quick traversal.

ABYSS CRESCENTS: Small puzzles that give abyss artifacts AND double as fast travel points. Always do them.

CAMP: Unlocks a few hours into the story. Deeper mechanics come from Greymane faction quests. Even after 20-30 hours, camp keeps expanding.

SETTINGS: Lower camera shake and particles. Set blur intensity to zero. Disable depth of field for sharper image.`,
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

  // Split by double newlines into logical sections
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
      spoiler_level: 2, // Guide level by default
    });
  }

  // Also add the full transcript as a higher-spoiler chunk
  chunks.push({
    content: `[FULL GUIDE: ${video.title} - ${video.channel}]\n\n${video.transcript}`,
    source_url: video.url,
    source_type: "youtube",
    chapter: video.chapter || null,
    region: video.region || null,
    quest_name: video.questName || null,
    content_type: video.contentType,
    character: video.character || null,
    spoiler_level: 3, // Full solution level
  });

  return chunks;
}

// ============ EMBEDDING ============

async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!VOYAGE_KEY || VOYAGE_KEY === "your-voyage-api-key-here") {
    return texts.map(() => null);
  }

  const results: (number[] | null)[] = [];
  // Batch into groups of 3 to stay under 10K TPM with 3 RPM limit
  const batchSize = 10;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 3000)); // ~3K chars ≈ ~750 tokens per text
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

    // Wait 21s between batches to respect 3 RPM
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

// ============ MAIN ============

async function main() {
  console.log("🎮 Crimson Desert Knowledge Base Seeder");
  console.log("========================================\n");

  // Clear existing data for a clean re-seed
  console.log("🗑️  Clearing existing knowledge chunks...");
  const { error: deleteError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all rows
  if (deleteError) console.error("Delete error:", deleteError.message);
  else console.log("   Cleared.\n");

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

  // Generate embeddings in batches
  console.log("\n🧠 Generating embeddings...");
  const embeddings = await generateEmbeddingsBatch(allChunks.map(c => c.content));
  const embedded = embeddings.filter(e => e !== null).length;
  console.log(`   Generated ${embedded}/${allChunks.length} embeddings`);

  // Insert chunks with embeddings
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

  if (!VOYAGE_KEY || VOYAGE_KEY === "your-voyage-api-key-here") {
    console.log("\n⚠️  No Voyage AI API key found. Chunks stored WITHOUT embeddings.");
    console.log("   Get a free key at https://dash.voyageai.com/");
    console.log("   Add VOYAGE_API_KEY to .env.local and re-run to generate embeddings.");
  }

  console.log("\n🎉 Seeding complete!");
}

main().catch(console.error);
