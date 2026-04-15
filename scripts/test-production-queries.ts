import https from 'https';

const PROD_URL = 'https://crimson-guide.vercel.app/api/chat';

const queries = [
  // Previously failing
  { q: 'how does grappling work', tier: 'nudge' },
  { q: 'how do i unlock fast travel', tier: 'nudge' },
  { q: 'how do i get gold bars', tier: 'nudge' },
  { q: 'best armor for early game', tier: 'nudge' },
  { q: 'what does blinding flash do', tier: 'nudge' },
  // Previously passing
  { q: 'how do i beat lucian bastier', tier: 'nudge' },
  { q: 'where is the reed devil boss', tier: 'nudge' },
  { q: 'how do i get the abyss artifact', tier: 'nudge' },
  // New tests
  { q: 'how do i get more inventory slots', tier: 'nudge' },
  { q: 'what is new game plus', tier: 'nudge' },
  { q: 'how do i do the feather of the earth challenge', tier: 'nudge' },
  { q: 'what skills does kliff have for grappling', tier: 'nudge' },
];

async function testQuery(q: string, tier: string): Promise<{ pass: boolean; response: string; note: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ question: q, spoilerTier: tier });
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
          const response: string = json.response || json.error || data;
          const lower = response.toLowerCase();
          const isNoInfo = lower.includes("don't have") || lower.includes("not sure") || 
                           lower.includes("can't find") || lower.includes("what i'm built for") ||
                           lower.includes("no information") || lower.includes("i don't know") ||
                           lower.includes("built for");
          const pass = !isNoInfo && response.length > 50;
          const note = isNoInfo ? 'NO-INFO fallback' : (response.length < 50 ? 'Too short' : 'OK');
          resolve({ pass, response: response.substring(0, 200), note });
        } catch {
          resolve({ pass: false, response: data.substring(0, 100), note: 'Parse error' });
        }
      });
    });
    req.on('error', (e) => resolve({ pass: false, response: e.message, note: 'Network error' }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ pass: false, response: '', note: 'Timeout' }); });
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log(`Testing ${queries.length} queries against production...\n`);
  let passed = 0;
  for (const { q, tier } of queries) {
    const result = await testQuery(q, tier);
    const icon = result.pass ? '✅' : '❌';
    console.log(`${icon} [${tier}] "${q}"`);
    console.log(`   ${result.note}: ${result.response.replace(/\n/g, ' ').substring(0, 150)}`);
    console.log();
    if (result.pass) passed++;
    await new Promise(r => setTimeout(r, 800)); // be polite to prod
  }
  console.log(`\nResult: ${passed}/${queries.length} passed`);
}

run();
