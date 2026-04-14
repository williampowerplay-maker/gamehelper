import https from 'https';

const PROD_URL = 'https://crimson-guide.vercel.app/api/chat';

const queries = [
  // Boss questions
  { q: 'how do i beat tenebrum', tag: 'boss' },
  { q: 'how do i beat crowcaller', tag: 'boss' },
  { q: 'how do i beat abyss kutum', tag: 'boss' },
  { q: 'what is the best strategy for boss fights', tag: 'boss' },
  { q: 'how much food should i bring to boss fights', tag: 'boss' },
  // Puzzle questions
  { q: 'how do i solve the ancient ruins puzzles', tag: 'puzzle' },
  { q: 'what abyss abilities do i need for puzzles', tag: 'puzzle' },
  { q: 'how do i solve the strongbox puzzle', tag: 'puzzle' },
  { q: 'how do disc puzzles work', tag: 'puzzle' },
  { q: 'how do i open the ancient sealed gate', tag: 'puzzle' },
  // Item questions
  { q: 'where do i get the white lion necklace', tag: 'item' },
  { q: 'how do i upgrade my weapons', tag: 'item' },
  { q: 'are there healing potions in crimson desert', tag: 'item' },
  { q: 'how do i cook grilled meat', tag: 'item' },
  { q: 'what is the critical rate build', tag: 'item' },
];

async function testQuery(q: string): Promise<{ pass: boolean; snippet: string; note: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ question: q, spoilerTier: 'nudge' });
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(PROD_URL, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // API returns { answer: "..." } or { response: "..." }
          const answer: string = json.answer || json.response || data;
          const lower = answer.toLowerCase();
          const isNoInfo =
            lower.includes("don't have") ||
            lower.includes("not sure") ||
            lower.includes("can't find") ||
            lower.includes("no information") ||
            lower.includes("i don't know") ||
            lower.includes("built for") ||
            lower.includes("i don't see") ||
            lower.includes("not available") ||
            lower.includes("couldn't find");
          const pass = !isNoInfo && answer.length > 60;
          const note = isNoInfo ? 'NO-INFO' : (answer.length < 60 ? 'TOO SHORT' : 'OK');
          resolve({ pass, snippet: answer.replace(/\n/g, ' ').substring(0, 180), note });
        } catch {
          resolve({ pass: false, snippet: data.substring(0, 80), note: 'PARSE ERR' });
        }
      });
    });
    req.on('error', (e) => resolve({ pass: false, snippet: e.message, note: 'NET ERR' }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ pass: false, snippet: '', note: 'TIMEOUT' }); });
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log(`\nRunning ${queries.length} queries (boss / puzzle / item)...\n`);
  const results: Record<string, { pass: number; fail: number }> = {};
  let totalPass = 0;

  for (const { q, tag } of queries) {
    if (!results[tag]) results[tag] = { pass: 0, fail: 0 };
    const r = await testQuery(q);
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} [${tag}] "${q}"`);
    console.log(`   ${r.note}: ${r.snippet}`);
    console.log();
    if (r.pass) { results[tag].pass++; totalPass++; }
    else results[tag].fail++;
    await new Promise(res => setTimeout(res, 900));
  }

  console.log('─'.repeat(60));
  for (const [tag, { pass, fail }] of Object.entries(results)) {
    const total = pass + fail;
    console.log(`  ${tag.padEnd(8)}: ${pass}/${total} passed`);
  }
  console.log(`  TOTAL   : ${totalPass}/${queries.length} passed`);
}

run();
