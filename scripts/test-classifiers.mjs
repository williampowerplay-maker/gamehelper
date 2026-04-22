// Classifier unit tests — run with: node scripts/test-classifiers.mjs

function classifyContentType(question) {
  const q = question.toLowerCase();

  if (/\b(best build|optimal build|build for|builds for|what.*build|recommended build|endgame build)\b/.test(q)) return null;
  if (/\b(best (weapon|gear|armor|accessory|accessories|item|equipment) for (a ?)?(beginner|new player|early|starter)|starter (weapon|gear)|beginner (weapon|gear))\b/.test(q)) return null;
  if (/\b(what (weapons?|abilities|skills|classes|weapon types?) (can|does|do) \w+ use|what (weapons?|weapon types?) (are|is) (available|in the game))\b/.test(q)) return null;

  // VERSUS
  if (/\b(vs\.?|versus)\b|better than\b|compare.{0,30}(weapon|armor|skill|class)|(sword|spear|bow|axe|staff|dagger|ring|necklace|earring|armor|armour)\s+(or|vs)\s+\w|\bor\b.{0,30}\b(which (is |one )?(better|stronger|best|worse))|which (is|one) (better|stronger|best)/.test(q)) return null;

  // FOOD — must come BEFORE boss so "food before a boss fight" → null, not "boss"
  if (/\b(food (buff|bonus|effect|for|before|during|guide)|best food (for|to eat|before)|what (food|meal) (should|to|is good)|elixir (effect|buff|guide)|buff food|combat food|healing food|consumable (guide|tips?|buff|strategy)|what (to eat|should i eat|food (to use|gives))|food (that (gives|boosts?|increases?)|for (combat|fighting|bosses?|dungeons?)))\b/.test(q)) return null;

  const bossNames = ['kailok','hornsplitter','kearush','reed devil','kutum','goyen','matthias'];
  const bossVerbs = /\b(beat|defeat|kill|fight|fighting|phase|weak ?point|cheese|stagger|parry|dodge)\b/;
  if (bossVerbs.test(q) || bossNames.some(n => q.includes(n))) return 'boss';

  if (/\b(puzzles?|strongbox|ancient ruins|sealed gate|disc puzzle|how (do i|to) solve|puzzle solution)\b/.test(q)) return 'puzzle';

  if (/\b(craft|crafting|recipe|how to make|how do i make|ingredients?|materials? needed|forge|cook|cooking)\b/.test(q)) return 'recipe';

  if (/\b(new game\+?|ng\+|post.?game|after (beating|finishing|completing) the (game|story|main quest)|endgame (content|guide|tips?|activities?)|end game content|postgame)\b/.test(q)) return 'mechanic';

  if (/\b(camp (management|system|upgrade|level|buildings?|feature|guide)|greymane camp (guide|upgrade|system|how)|faction (system|reputation|rank|guide|how)|how (do i|to) (upgrade|level up|build up|improve) (my |the )?camp|base (building|management|upgrade|system))\b/.test(q)) return 'mechanic';

  if (/\b(mount(s)? (system|guide|tips?|unlock|how|work)|how (do i|to|do) (get|obtain|unlock|tame|ride|use) (a |the )?(mount|horse|pet|steed)|how do(es)? (mounts?|horses?|pets?) work|pet (system|guide|combat|unlock|how)|horse (guide|system|tips?|riding|unlock|taming)|riding (system|guide|tips?)|best (mount|horse|pet)\b)\b/.test(q)) return 'mechanic';

  if (/\b(skill|ability|talent|passive|active|skill tree|mechanic|system|stamina|stat|attribute|combo|grapple|grappling|abyss artifact|challenge|mastery|fast travel|how does .+ work|what does .+ do|refinement|refine|potion|consumable|critical rate)\b/.test(q)) return 'mechanic';

  if (/\b(what (are|is) (some |the |any )?(good|great|best|op|strong|powerful|recommended)\b|best (sword|weapon|bow|spear|axe|dagger|staff|armor|armour|helmet|boots|gloves|ring|necklace|earring|accessory|gear|loadout|skill)s?\b|recommend(ed)? (weapon|armor|armour|gear|build|loadout|skill)|what should i (use|equip|get|pick|choose)|worth (getting|using|buying|farming)\b|tier list)\b/.test(q)) return null;

  const itemKeywords = /\b(weapon|sword|bow|staff|spear|axe|dagger|gun|shield|armor|armour|helmet|boots|gloves|cloak|ring|earring|necklace|abyss gear|abyss-gear|accessory|accessories|equipment|item|drop|loot|reward|obtain|enhance)\b/;
  const getItemPhrases = /\b(where (do i|can i) (find|get|buy|farm|obtain)|how (do i|to) (acquire|obtain|get|find)|where to (find|get|buy|obtain)|where (is|are) the|how to get)\b/;
  if (itemKeywords.test(q) || getItemPhrases.test(q)) return 'item';

  if (/\b(where is|how do i get to|how to reach|location of|map|region|dungeon|cave|castle|mine|fort|landmark|portal|entrance|labyrinth|tower|temple)\b/.test(q)) return 'exploration';

  if (/\b(quest|mission|objective|side quest|main quest|storyline|story|chapter)\b/.test(q)) return 'quest';

  if (/\b(who is|character|npc|lore|backstory|faction|kliff|damiane|greymane|matthias)\b/.test(q)) return 'character';

  return null;
}

function isListQuery(q) {
  q = q.toLowerCase();
  return /\b(list (all|every)|all (the )?(bosses?|weapons?|armou?rs?|skills?|quests?|accessories|items?|locations?|enemies?|recipes?)|every (weapon|boss|skill|armou?r|item|accessory|enemy|quest)|complete list|full list of|how many (bosses?|weapons?|skills?|quests?|items?))\b/.test(q);
}

function isOffTopic(q) {
  q = q.toLowerCase();
  const hasGameContext = /\b(crimson desert|kliff|greymane|pywel|abyss|pailune|hernand|delesyia|demeniss|nexus|boss|bosses|weapon|armor|armour|skill|quest|dungeon|grapple|mount|horse|camp|faction|crafting|silver|gold bar)\b/.test(q);
  if (hasGameContext) return false;
  return /\b(weather forecast|homework|recipe for (pizza|pasta|cake|bread|cookies)|who is the president|capital city of|stock (market|price|ticker)|sports? score|football|basketball|soccer score|movie review|celebrity|latest news|politics|election result|translate (this|to)|convert \d|math (problem|equation)|solve for x)\b/.test(q);
}

// ── test cases: [question, expectedClassify, expectedList, expectedOffTopic] ──
// expectedClassify: string | null (null = any null return)
// expectedList: true if isListQuery should fire
// expectedOffTopic: true if isOffTopic should fire
const tests = [
  // Versus / comparison → null
  ["Hwando vs Sielos Longsword",                  null,       false, false],
  ["spear vs sword which is better",              null,       false, false],
  ["is the Sielos better than the Hwando sword",  null,       false, false],
  ["sword or spear which is better",              null,       false, false],

  // Food / consumable → null
  ["what food should I eat before a boss fight",  null,       false, false],
  ["best food for combat",                        null,       false, false],
  ["what food is good for fighting bosses",       null,       false, false],

  // Camp / faction → mechanic
  ["how does camp management work",               "mechanic", false, false],
  ["how do I upgrade my camp",                    "mechanic", false, false],
  ["how does faction reputation work",            "mechanic", false, false],

  // Mount / pet → mechanic
  ["how do I get a horse",                        "mechanic", false, false],
  ["how do mounts work",                          "mechanic", false, false],
  ["best mount in the game",                      "mechanic", false, false],

  // Endgame / NG+ → mechanic
  ["what do I do after beating the game",         "mechanic", false, false],
  ["is there new game+",                          "mechanic", false, false],
  ["endgame content guide",                       "mechanic", false, false],

  // List queries → null + isListQuery=true
  ["list all bosses",                             null,       true,  false],
  ["how many weapons are there",                  null,       true,  false],
  ["every boss in the game",                      null,       true,  false],
  ["complete list of skills",                     null,       true,  false],

  // Off-topic detection (classify result irrelevant — isOffTopic fires first in real code)
  // Use "*" as a wildcard meaning "don't check classify for these"
  ["what is the weather forecast today",          "*",        false, true],
  ["who is the president",                        "*",        false, true],
  ["recipe for pizza",                            "*",        false, true],
  // NOT off-topic (game context overrides)
  ["how do I beat the boss",                      "boss",     false, false],
  ["where can I find armor",                      "item",     false, false],

  // Existing classifiers unchanged
  ["how do I beat Kearush",                       "boss",     false, false],
  ["where do I find the Hwando sword",            "item",     false, false],
  ["how does the grappling system work",          "mechanic", false, false],
  ["how do I solve this puzzle",                  "puzzle",   false, false],
  ["what are some good swords",                   null,       false, false],
  ["best weapons in the game",                    null,       false, false],
  ["how do I craft a potion",                     "recipe",   false, false],
  ["what is the Delesyia region",                 "exploration", false, false],
  ["who is Kliff",                                "character", false, false],
];

let pass = 0, fail = 0;
for (const [q, expClassify, expList, expOffTopic] of tests) {
  const gotClassify   = classifyContentType(q);
  const gotList       = isListQuery(q);
  const gotOffTopic   = isOffTopic(q);

  const okClassify   = expClassify === "*" ? true : gotClassify === expClassify;
  const okList       = gotList       === expList;
  const okOffTopic   = gotOffTopic   === expOffTopic;
  const ok           = okClassify && okList && okOffTopic;

  const issues = [];
  if (!okClassify)  issues.push(`classify: got "${gotClassify}" expected "${expClassify}"`);
  if (!okList)      issues.push(`list: got ${gotList} expected ${expList}`);
  if (!okOffTopic)  issues.push(`offTopic: got ${gotOffTopic} expected ${expOffTopic}`);

  console.log(`${ok ? "✅" : "❌"} "${q}"${ok ? "" : "\n   → " + issues.join(" | ")}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass}/${pass+fail} tests passed`);
if (fail > 0) process.exit(1);
