// scripts/phase1c-classify.ts
//
// Phase 1c — content_type reclassification.
// Step 1: ANTHROPIC_API_KEY resolver (verified working).
// Step 2: URL sampling + content extraction.
// Step 3: Haiku-driven reclassification with shared pool rate-limit coordination.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const KEY_NAME = "ANTHROPIC_API_KEY";
const KEY_FILE_PATH = homedir() + "/.anthropic_key";

/**
 * Resolve the Anthropic API key from, in order:
 *   1. process.env[KEY_NAME]
 *   2. Windows Credential Manager via the CredentialManager PowerShell module
 *   3. File at ~/.anthropic_key (cross-platform)
 *   4. Throw with an actionable error message
 *
 * The key is never logged. Callers should not log the return value either.
 */
function resolveAnthropicKey(): string {
  // 1. Environment variable.
  const fromEnv = process.env[KEY_NAME];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  // 2. Windows Credential Manager (Windows only).
  if (process.platform === "win32") {
    // KEY_NAME is a hardcoded constant, so interpolating it into the PS script
    // is safe (no user-controlled input is concatenated into the command).
    const psScript =
      "if (Get-Module -ListAvailable -Name CredentialManager) {" +
      `  $c = Get-StoredCredential -Target '${KEY_NAME}';` +
      "  if ($null -ne $c) { $c.GetNetworkCredential().Password }" +
      "} else {" +
      "  Write-Error 'CREDMAN_MODULE_MISSING'" +
      "}";

    try {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      ).trim();

      if (out.length > 0) {
        // SAFETY: returned directly to caller, never logged here.
        return out;
      }
      // Empty stdout + no throw == module present but no credential stored.
      // Fall through to the file-based fallback.
    } catch (err) {
      const stderr =
        (err as { stderr?: Buffer | string }).stderr?.toString() ?? "";

      if (stderr.includes("CREDMAN_MODULE_MISSING")) {
        // Module not installed. Use cmdkey to check whether a credential
        // at least exists, so we can give a more specific error if so.
        let credentialExists = false;
        try {
          const cmdkeyOut = execFileSync(
            "cmdkey.exe",
            [`/list:${KEY_NAME}`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
          );
          credentialExists = /Target:\s/i.test(cmdkeyOut);
        } catch {
          // cmdkey exits non-zero when no matching target exists.
        }

        if (credentialExists) {
          throw new Error(
            `[phase1c] ${KEY_NAME} is stored in Windows Credential Manager, ` +
              "but the CredentialManager PowerShell module is not installed, " +
              "so the value cannot be read back (cmdkey cannot print " +
              "passwords).\n\n" +
              "Install the module once:\n" +
              "  Install-Module CredentialManager -Scope CurrentUser\n\n" +
              `Or use the file fallback at ${KEY_FILE_PATH}, or set $env:${KEY_NAME}.`,
          );
        }
        // No credential AND no module: fall through to the file fallback.
      }
      // Any other PowerShell failure: fall through. We deliberately do not
      // surface stderr here in case it echoes any part of the command.
    }
  }

  // 3. File at ~/.anthropic_key (cross-platform).
  try {
    const fileContents = readFileSync(KEY_FILE_PATH, "utf8").trim();
    if (fileContents.length > 0) {
      // SAFETY: returned directly to caller, never logged here.
      return fileContents;
    }
    // Empty file: fall through silently to the final error.
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Permission error or similar — surface the path but NOT contents.
      throw new Error(
        `[phase1c] Key file at ${KEY_FILE_PATH} exists but could not be read ` +
          `(error code: ${code ?? "unknown"}). Check file permissions.`,
      );
    }
    // ENOENT: file doesn't exist — fall through silently to the final error.
  }

  // 4. Final, actionable failure.
  throw buildNotFoundError();
}

function buildNotFoundError(): Error {
  const isWin = process.platform === "win32";

  const triedLines = [
    `  1. process.env.${KEY_NAME} (not set)`,
    isWin
      ? "  2. Windows Credential Manager (not found or CredentialManager module missing)"
      : "  2. Windows Credential Manager (Windows only; skipped)",
    `  3. ${KEY_FILE_PATH} (not found or empty)`,
  ];

  const setupLines = [
    "Set up via any one of these:",
    "",
    "Environment variable:",
    `  PowerShell:  $env:${KEY_NAME} = '<your key>'`,
    `  bash:        export ${KEY_NAME}='<your key>'`,
    "",
    "File (cross-platform, simplest):",
    `  PowerShell:  '<your key>' | Out-File -Encoding ascii -NoNewline "$env:USERPROFILE\\.anthropic_key"`,
    "  bash:        echo '<your key>' > ~/.anthropic_key",
  ];

  if (isWin) {
    setupLines.push(
      "",
      "Windows Credential Manager (requires CredentialManager PS module):",
      "  Install-Module CredentialManager -Scope CurrentUser",
      `  cmdkey /generic:${KEY_NAME} /user:anthropic /pass:<your key>`,
    );
  }

  return new Error(
    `[phase1c] ${KEY_NAME} not found. Tried:\n` +
      triedLines.join("\n") +
      "\n\n" +
      setupLines.join("\n"),
  );
}

// ── Step 2: URL sampling + content extraction ───────────────────────────────

// Distribution from PROJECT_STATUS post-Phase-1b corpus (fextralife only).
const TARGET_DIST: Record<string, number> = {
  item: 19565,
  character: 11265,
  mechanic: 6710,
  quest: 6596,
  recipe: 3021,
  boss: 1090,
  exploration: 1033,
};

interface SampledRecord {
  source_url: string;
  old_content_type: string;
  content_head: string;
  is_tier_list_candidate: boolean;
  content_length: number;
  page_name: string;
}

interface CliArgs {
  dryRun: boolean;
  classify: boolean;
  classifyFailedOnly: boolean;
  reportOnly: boolean;
  eyeball: boolean;
  corpus: boolean;
  n: number;
  concurrency: number;
  out: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (prefix: string) =>
    argv.find((a) => a.startsWith(prefix))?.split("=")[1];
  const n = parseInt(get("--n=") ?? "100", 10);
  // Default 4 — Anthropic's burst tolerance is tighter than expected for
  // Haiku on this workspace. 4 stays well under the per-minute limit at
  // sustained load.
  const concurrency = parseInt(get("--concurrency=") ?? "4", 10);
  const out = get("--out=") ?? "./phase1c-sampled-urls.json";
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --n=${n}`);
  if (!Number.isFinite(concurrency) || concurrency <= 0)
    throw new Error(`Invalid --concurrency=${concurrency}`);
  return {
    dryRun: argv.includes("--dry-run"),
    classify: argv.includes("--classify"),
    classifyFailedOnly: argv.includes("--classify-failed-only"),
    reportOnly: argv.includes("--report-only"),
    eyeball: argv.includes("--eyeball"),
    corpus: argv.includes("--corpus"),
    n,
    concurrency,
    out,
  };
}

// Mirrors run-eval.ts loadEnv() exactly.
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
  } catch {
    return {};
  }
}

function getSupabaseClient(): SupabaseClient {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  if (!url || !key) throw new Error("[phase1c] Missing SUPABASE env vars");
  return createClient(url, key);
}

/** Round each bucket proportionally; absorb leftover into the largest bucket. */
function allocate(total: number, dist: Record<string, number>): Record<string, number> {
  const sum = Object.values(dist).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(dist)) out[k] = Math.round((v / sum) * total);
  const allocated = Object.values(out).reduce((a, b) => a + b, 0);
  const diff = total - allocated;
  if (diff !== 0) {
    const largest = Object.entries(out).sort((a, b) => b[1] - a[1])[0][0];
    out[largest] += diff;
  }
  return out;
}

/** Fisher-Yates in place. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pull DISTINCT fextralife source_urls for one content_type, paginated.
 * Shuffle in JS (supabase-js has no ORDER BY random()), slice N.
 */
async function sampleUrlsForType(
  supabase: SupabaseClient,
  contentType: string,
  n: number,
): Promise<string[]> {
  const seen = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  // Loop bounded by row count; safety cap at 200 pages (200k rows).
  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabase
      .from("knowledge_chunks")
      .select("source_url")
      .eq("content_type", contentType)
      .ilike("source_url", "%fextralife%")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`[phase1c] Supabase error (${contentType}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) seen.add(row.source_url);
    if (data.length < PAGE) break;
    offset += PAGE;
    if (page === 199) {
      console.warn(`[phase1c] WARN: hit pagination safety cap for ${contentType}`);
    }
  }
  const urls = shuffle([...seen]);
  return urls.slice(0, n);
}

/** Fetch all chunks for the given URLs in batches; pick longest content per URL. */
async function fetchLongestContent(
  supabase: SupabaseClient,
  urls: string[],
): Promise<Map<string, string>> {
  const longest = new Map<string, string>();
  const BATCH = 50;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("knowledge_chunks")
      .select("source_url, content")
      .in("source_url", batch);
    if (error) throw new Error(`[phase1c] Supabase error (content fetch): ${error.message}`);
    for (const row of data ?? []) {
      const prev = longest.get(row.source_url);
      if (!prev || (row.content?.length ?? 0) > prev.length) {
        longest.set(row.source_url, row.content ?? "");
      }
    }
  }
  return longest;
}

function isTierListCandidate(url: string, contentHead: string): boolean {
  const u = url.toLowerCase();
  if (/(tier-?list|tier\+list|best-(weapons|armor|build|skills|items|early|late|one[-+]?handed|body[-+]?armor))/.test(u)) return true;
  const head = contentHead.substring(0, 200).toLowerCase();
  if (head.includes("tier list")) return true;
  return false;
}

function extractPageName(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter((s) => s.length > 0).pop() ?? "";
    return decodeURIComponent(seg.replace(/\+/g, " "));
  } catch {
    return url;
  }
}

async function runCorpusSample(args: CliArgs): Promise<void> {
  void args.concurrency;
  const supabase = getSupabaseClient();

  console.log("[phase1c] Corpus mode: fetching ALL distinct fextralife URLs…");

  // Pull every (source_url, content_type) pair, paginated. Aggregate in JS
  // because supabase-js can't issue GROUP BY without an RPC.
  const typeCountsByUrl = new Map<string, Record<string, number>>();
  const PAGE = 1000;
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabase
      .from("knowledge_chunks")
      .select("source_url, content_type")
      .ilike("source_url", "%fextralife%")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`[phase1c] Supabase error: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      let counts = typeCountsByUrl.get(row.source_url);
      if (!counts) { counts = {}; typeCountsByUrl.set(row.source_url, counts); }
      counts[row.content_type] = (counts[row.content_type] ?? 0) + 1;
    }
    if (data.length < PAGE) break;
    offset += PAGE;
    if (page === 199) {
      console.warn("[phase1c] WARN: hit pagination safety cap (corpus sample)");
    }
  }

  const allUrls = [...typeCountsByUrl.keys()];
  console.log(`[phase1c] Found ${allUrls.length} distinct fextralife URLs`);

  // Pick canonical type per URL: max count; ties → alphabetical for determinism.
  const canonicalType = new Map<string, string>();
  for (const [url, counts] of typeCountsByUrl) {
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    canonicalType.set(url, top);
  }

  const perType: Record<string, number> = {};
  for (const t of canonicalType.values()) perType[t] = (perType[t] ?? 0) + 1;
  console.log("[phase1c] Distinct URLs by canonical content_type:");
  for (const [t, n] of Object.entries(perType).sort((a, b) => b[1] - a[1])) {
    console.log(`         ${t.padEnd(12)} ${n}`);
  }

  console.log(`\n[phase1c] Fetching longest content for ${allUrls.length} URLs…`);
  const longest = await fetchLongestContent(supabase, allUrls);

  const records: SampledRecord[] = allUrls.map((url) => {
    const fullContent = longest.get(url) ?? "";
    const head = fullContent.substring(0, 800);
    return {
      source_url: url,
      old_content_type: canonicalType.get(url)!,
      content_head: head,
      is_tier_list_candidate: isTierListCandidate(url, head),
      content_length: fullContent.length,
      page_name: extractPageName(url),
    };
  });

  writeFileSync(CORPUS_URLS_OUT, JSON.stringify(records, null, 2), "utf-8");
  console.log(`[phase1c] File written: ${CORPUS_URLS_OUT}`);

  // Smoke check
  const roundtrip = JSON.parse(readFileSync(CORPUS_URLS_OUT, "utf-8"));
  if (!Array.isArray(roundtrip)) throw new Error("Smoke check: not an array");
  if (roundtrip.length !== records.length)
    throw new Error(`Smoke check: count mismatch (${roundtrip.length} vs ${records.length})`);
  const thinPages = records.filter((r) => r.content_length < 200);
  console.log(`[phase1c] Thin pages (longest chunk < 200 chars): ${thinPages.length}`);
  console.log(`[phase1c] Smoke check: ✅ ${roundtrip.length} records.`);

  // Cost preview for next step
  const estCallCost = 0.0008; // observed avg from N=100 run
  console.log(`\n[phase1c] Estimated --classify cost: $${(records.length * estCallCost).toFixed(2)} (${records.length} calls × $${estCallCost} avg)`);
}

async function runDryRun(args: CliArgs): Promise<void> {
  if (args.corpus) {
    return runCorpusSample(args);
  }
  void args.concurrency; // reserved for step 3
  const supabase = getSupabaseClient();
  const alloc = allocate(args.n, TARGET_DIST);

  console.log(`[phase1c] Sampling ${args.n} URLs across content_types:`);
  for (const [t, k] of Object.entries(alloc)) console.log(`         ${t.padEnd(12)} ${k}`);
  console.log();

  const allUrls: { url: string; type: string }[] = [];
  for (const [type, count] of Object.entries(alloc)) {
    if (count <= 0) continue;
    process.stdout.write(`  ${type.padEnd(12)} fetching distinct URLs… `);
    const urls = await sampleUrlsForType(supabase, type, count);
    console.log(`got ${urls.length}`);
    for (const u of urls) allUrls.push({ url: u, type });
  }

  console.log(`\n[phase1c] Fetching longest content for ${allUrls.length} URLs…`);
  const longest = await fetchLongestContent(supabase, allUrls.map((x) => x.url));

  const records: SampledRecord[] = allUrls.map(({ url, type }) => {
    const fullContent = longest.get(url) ?? "";
    const head = fullContent.substring(0, 800);
    return {
      source_url: url,
      old_content_type: type,
      content_head: head,
      is_tier_list_candidate: isTierListCandidate(url, head),
      content_length: fullContent.length,
      page_name: extractPageName(url),
    };
  });

  writeFileSync(args.out, JSON.stringify(records, null, 2), "utf-8");

  // ── Summary ──────────────────────────────────────────────────────────────
  const perType: Record<string, number> = {};
  for (const r of records) perType[r.old_content_type] = (perType[r.old_content_type] ?? 0) + 1;
  const tierCandidates = records.filter((r) => r.is_tier_list_candidate);
  const thinPages = records.filter((r) => r.content_length < 200);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Total sampled:   ${records.length}`);
  console.log("Per content_type:");
  for (const [t, k] of Object.entries(perType)) {
    console.log(`  ${t.padEnd(12)} ${k}  (target ${alloc[t]})`);
  }
  console.log(`Tier-list candidates: ${tierCandidates.length}`);
  for (const r of tierCandidates.slice(0, 5)) console.log(`  - ${r.page_name}  (${r.source_url})`);
  console.log(`Thin pages (longest chunk < 200 chars): ${thinPages.length}`);
  for (const r of thinPages.slice(0, 5)) console.log(`  - ${r.page_name}  (len=${r.content_length})`);
  console.log(`File written: ${args.out}`);

  // ── Smoke check ──────────────────────────────────────────────────────────
  const roundtrip = JSON.parse(readFileSync(args.out, "utf-8"));
  if (!Array.isArray(roundtrip)) throw new Error("Smoke check: not a JSON array");
  if (roundtrip.length !== records.length)
    throw new Error(`Smoke check: count mismatch (${roundtrip.length} vs ${records.length})`);
  const expectedKeys = ["source_url","old_content_type","content_head","is_tier_list_candidate","content_length","page_name"];
  for (const k of expectedKeys) if (roundtrip[0] && !(k in roundtrip[0]))
    throw new Error(`Smoke check: missing key '${k}' in first record`);
  console.log(`Smoke check: ✅ valid JSON, schema OK, ${roundtrip.length} records.`);
}

// ── Step 3: Haiku classification ────────────────────────────────────────────

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_PRICE_INPUT_PER_M = 0.80;
const HAIKU_PRICE_OUTPUT_PER_M = 4.00;
const ALLOWED_LABELS = new Set([
  "boss", "quest", "character", "exploration", "recipe", "item", "puzzle", "mechanic", "uncertain",
]);
const CLASSIFICATIONS_OUT = "./phase1c-classifications.json";
const EYEBALL_OUT = "./phase1c-eyeball.csv";
// --corpus mode swaps these in:
const CORPUS_URLS_OUT = "./phase1c-corpus-urls.json";
const CORPUS_CLASSIFICATIONS_OUT = "./phase1c-corpus-classifications.json";
const CORPUS_EYEBALL_OUT = "./phase1c-corpus-eyeball.csv";

function getUrlsPath(args: CliArgs): string {
  return args.corpus ? CORPUS_URLS_OUT : args.out;
}
function getClassPath(args: CliArgs): string {
  return args.corpus ? CORPUS_CLASSIFICATIONS_OUT : CLASSIFICATIONS_OUT;
}
function getEyeballPath(args: CliArgs): string {
  return args.corpus ? CORPUS_EYEBALL_OUT : EYEBALL_OUT;
}

// Reasons that indicate "page is not really about anything specific" — these
// are delete candidates rather than reclassification failures.
const NAV_ONLY_REASON_RE = /nav-only|category|index|enumeration|table|listing/i;

const SYSTEM_PROMPT = `You are a content classifier for a Crimson Desert game wiki. Given a
page's title (URL) and content excerpt, output exactly ONE of these
labels: boss, quest, character, exploration, recipe, item, puzzle,
mechanic, uncertain.

Output the label on its own line. If and only if the label is
"uncertain", follow with a second line beginning "reason:" and a brief
explanation (< 50 chars). Otherwise output only the label.

Label definitions:
- boss: the page's primary purpose is explaining how to defeat a
  specific named enemy (strategy, phases, attack patterns, HP,
  weaknesses). When a page is a boss whose strategy mentions drops,
  it is still boss.
- quest: the page documents a specific quest or mission — objectives,
  steps, rewards, story progression. "Toll of Hernand" the quest is
  quest even if Hernand the NPC is mentioned.
- character: the page is about a named NPC — bio, role, dialogue,
  relationships, lore. If the page is primarily "who is X", it is
  character.
- exploration: the page is about a location, region, zone, camp,
  landmark, dungeon, cave, or point of interest — how to reach it
  and what is there.
- recipe: the page is about a specific cookable/craftable food or
  potion with ingredients and effects. Generic "cooking system" is
  mechanic, not recipe.
- item: weapons, armor, accessories, consumables, materials,
  equipment drops. Tier lists and "best X" ranking pages are also
  item, but these will be flagged separately. When a page is an item
  that happens to be a boss drop, label item.
- puzzle: a specific puzzle and its solution (strongbox, disc puzzle,
  sealed gate, spire puzzle).
- mechanic: game systems that are NOT tied to one specific boss,
  item, quest, location, character, or recipe. Examples: stamina
  system, parrying mechanic, NG+ system, camp management system,
  mount commands, skill upgrade system. If the page is about a
  specific named thing, prefer that thing's category. Mechanic is a
  last resort after ruling out the other seven types.
- uncertain: use when the excerpt is so thin or mixed you genuinely
  cannot tell.

Disambiguation rules:
- NPC who is fought: if dominant content is fight strategy (attacks,
  phases, weaknesses), label boss. If dominant content is
  lore/dialogue/relationships, label character. The test is what the
  page is ABOUT, not what it mentions.
- Item that is a boss drop: label item. The test is what the page is
  ABOUT, not what it mentions.
- Nav-only pages: if the excerpt is primarily navigation text (lists
  of other page names, "Equipment > Weapons > Swords" breadcrumbs,
  category listings) without substantive information about a
  specific subject, label uncertain with reason "nav-only".

Decide by asking: "What would a player searching for this page expect
to find?"`;

interface ClassificationResult {
  source_url: string;
  old_content_type: string;
  new_content_type: string;
  haiku_reason: string | null;
  is_tier_list_candidate: boolean;
  latency_ms: number;
  page_name: string;
  input_tokens: number;
  output_tokens: number;
}

type ClassificationOutputRecord = Omit<ClassificationResult, "input_tokens" | "output_tokens">;

// Shared rate-limit coordination: every worker checks this before issuing a
// request, and updates it on 429 so the entire pool pauses together.
let globalPauseUntilMs = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Single Haiku call.
 * - Honors Retry-After header (integer seconds) on 429.
 * - Falls back to exponential backoff (1s/2s/4s/8s/16s) when no header.
 * - Updates a shared globalPauseUntilMs so the whole concurrent pool pauses
 *   together; logs only on transition (was past, now future).
 * - Per-call retry budget: 5 retries.
 */
async function callHaiku(apiKey: string, rec: SampledRecord): Promise<{
  rawText: string; latencyMs: number; inputTokens: number; outputTokens: number;
}> {
  const userMsg = `URL: ${rec.source_url}\nContent excerpt (first 800 chars):\n${rec.content_head}`;
  const body = JSON.stringify({
    model: HAIKU_MODEL,
    max_tokens: 80,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  // SAFETY: apiKey is only used as a header value, never logged.
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body).toString(),
  };

  let lastErrMsg = "unknown error";
  for (let attempt = 0; attempt < 6; attempt++) {
    // Pool-wide pause check (every iteration including attempt 0).
    const checkNow = Date.now();
    if (checkNow < globalPauseUntilMs) {
      await sleep(globalPauseUntilMs - checkNow + 50); // 50ms jitter
    }

    const t0 = Date.now();
    try {
      const result = await new Promise<{
        status: number;
        headers: Record<string, string | string[] | undefined>;
        body: string;
      }>((resolve, reject) => {
        const req = https.request(
          { hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers },
          (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: d,
            }));
          },
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });
      const latencyMs = Date.now() - t0;

      if (result.status === 429) {
        lastErrMsg = "HTTP 429";
        // Honor Retry-After header (integer seconds per HTTP spec).
        const raHeader = String(result.headers["retry-after"] ?? "").trim();
        const raSec = parseInt(raHeader, 10);
        const pauseMs =
          Number.isFinite(raSec) && raSec > 0
            ? raSec * 1000
            : Math.min(16000, 1000 * Math.pow(2, attempt));
        // Update shared pool pause; log only on transition (was past → future).
        const beforeWasInPast = globalPauseUntilMs <= Date.now();
        const newPauseUntil = Date.now() + pauseMs;
        if (newPauseUntil > globalPauseUntilMs) {
          globalPauseUntilMs = newPauseUntil;
          if (beforeWasInPast) {
            console.log(`[phase1c] Rate-limited; pausing pool for ${Math.ceil(pauseMs / 1000)}s`);
          }
        }
        continue; // top-of-loop pool-pause-check will sleep us
      }
      if (result.status !== 200) {
        // SAFETY: do not include result.body verbatim — may echo headers.
        throw new Error(`HTTP ${result.status}`);
      }
      const parsed = JSON.parse(result.body);
      return {
        rawText: parsed.content?.[0]?.text ?? "",
        latencyMs,
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      };
    } catch (err) {
      lastErrMsg = err instanceof Error ? err.message : String(err);
      if (attempt === 5) break;
      // Brief LOCAL backoff for non-429 errors (network glitches etc.).
      // Don't touch the pool pause — that's reserved for actual rate limits.
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw new Error(lastErrMsg);
}

function parseHaikuResponse(rawText: string): { label: string; reason: string | null } | null {
  const lines = rawText.trim().split(/\r?\n/);
  const first = (lines[0] ?? "").toLowerCase().trim();
  if (!first || !ALLOWED_LABELS.has(first)) return null;
  let reason: string | null = null;
  if (first === "uncertain") {
    const second = (lines[1] ?? "").trim();
    if (second.toLowerCase().startsWith("reason:")) {
      reason = second.substring(second.indexOf(":") + 1).trim() || null;
    }
  }
  return { label: first, reason };
}

async function classifyOne(apiKey: string, rec: SampledRecord): Promise<ClassificationResult> {
  const base = {
    source_url: rec.source_url,
    old_content_type: rec.old_content_type,
    is_tier_list_candidate: rec.is_tier_list_candidate,
    page_name: rec.page_name,
  };
  try {
    const { rawText, latencyMs, inputTokens, outputTokens } = await callHaiku(apiKey, rec);
    if (latencyMs > 2000) console.warn(`[phase1c] WARN slow ${latencyMs}ms: ${rec.page_name}`);
    const parsed = parseHaikuResponse(rawText);
    if (!parsed) {
      console.warn(`[phase1c] unparseable: ${rec.page_name}`);
      return {
        ...base,
        new_content_type: "<unparseable>",
        haiku_reason: null,
        latency_ms: latencyMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      };
    }
    return {
      ...base,
      new_content_type: parsed.label,
      haiku_reason: parsed.reason,
      latency_ms: latencyMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[phase1c] FAILED ${rec.page_name}: ${msg}`);
    return {
      ...base,
      new_content_type: "<failed>",
      haiku_reason: null,
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
  }
}

/** Pull-based concurrency: N workers each take the next index. No deps. */
async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (t: T) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const take = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
      done++;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, take));
  return results;
}

/** Periodic progress logger: every 100 done, plus the final count. */
function progressLogger(done: number, total: number): void {
  if (done % 100 === 0 || done === total) {
    console.log(`[phase1c] Progress: ${done}/${total}`);
  }
}

// ── Shared summary output (used by --classify and --report-only) ────────────

function printClassificationSummary(
  results: ClassificationOutputRecord[],
  samples: SampledRecord[],
  cost?: { totalIn: number; totalOut: number; totalMs: number },
  classPathOverride?: string,
): void {
  const classPath = classPathOverride ?? CLASSIFICATIONS_OUT;
  const failed      = results.filter((r) => r.new_content_type === "<failed>").length;
  const unparseable = results.filter((r) => r.new_content_type === "<unparseable>").length;
  const successful  = results.filter((r) => !r.new_content_type.startsWith("<"));
  const changes     = successful.filter((r) => r.new_content_type !== r.old_content_type);
  const uncertains  = successful.filter((r) => r.new_content_type === "uncertain");
  const navOnly = uncertains.filter(
    (r) => r.haiku_reason && NAV_ONLY_REASON_RE.test(r.haiku_reason),
  );
  const genuinelyUncertain = uncertains.filter(
    (r) => !(r.haiku_reason && NAV_ONLY_REASON_RE.test(r.haiku_reason)),
  );

  const distribution: Record<string, number> = {};
  for (const r of results) distribution[r.new_content_type] = (distribution[r.new_content_type] ?? 0) + 1;

  const pairCounts: Record<string, number> = {};
  for (const r of changes) {
    const key = `${r.old_content_type} → ${r.new_content_type}`;
    pairCounts[key] = (pairCounts[key] ?? 0) + 1;
  }
  const sortedPairs = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]);

  const samplesByUrl = new Map(samples.map((s) => [s.source_url, s]));
  const sampleDisagreements = shuffle([...changes]).slice(0, 15);

  const changeRate             = successful.length ? changes.length / successful.length : 0;
  const navOnlyRate            = successful.length ? navOnly.length / successful.length : 0;
  const genuinelyUncertainRate = successful.length ? genuinelyUncertain.length / successful.length : 0;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Total classified:    ${successful.length}`);
  console.log(`Failed:              ${failed}`);
  console.log(`Unparseable:         ${unparseable}`);
  console.log(`\nDistribution (new_content_type):`);
  for (const [k, v] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }
  console.log(`\nChange rate:                                ${(changeRate * 100).toFixed(1)}% (${changes.length}/${successful.length})`);
  console.log(`Uncertain (nav-only, delete candidates):    ${navOnly.length} (${(navOnlyRate * 100).toFixed(1)}%)`);
  console.log(`Uncertain (genuinely thin/mixed, manual):   ${genuinelyUncertain.length} (${(genuinelyUncertainRate * 100).toFixed(1)}%)`);
  console.log(`\nDisagreement breakdown (sorted desc):`);
  for (const [pair, n] of sortedPairs) console.log(`  ${pair.padEnd(30)} ${n}`);
  console.log(`\n15 random disagreement samples:`);
  for (const r of sampleDisagreements) {
    const head100 = (samplesByUrl.get(r.source_url)?.content_head ?? "")
      .substring(0, 100)
      .replace(/\n/g, " ");
    const reasonStr =
      r.new_content_type === "uncertain" && r.haiku_reason ? ` [reason: ${r.haiku_reason}]` : "";
    console.log(`  - ${r.page_name}`);
    console.log(`      ${r.old_content_type} → ${r.new_content_type}${reasonStr}`);
    console.log(`      "${head100}…"`);
  }

  if (cost) {
    const dollars =
      (cost.totalIn / 1_000_000) * HAIKU_PRICE_INPUT_PER_M +
      (cost.totalOut / 1_000_000) * HAIKU_PRICE_OUTPUT_PER_M;
    console.log(`\nTokens:              input=${cost.totalIn}, output=${cost.totalOut}`);
    console.log(`Estimated cost:      $${dollars.toFixed(4)}`);
    console.log(`Total wall time:     ${(cost.totalMs / 1000).toFixed(1)}s`);
  }
  console.log(`File written:        ${classPath}`);

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    genuinelyUncertainRate < 0.05
      ? `Genuinely-uncertain rate: PASS (${(genuinelyUncertainRate * 100).toFixed(1)}%)`
      : genuinelyUncertainRate <= 0.10
      ? `Genuinely-uncertain rate: INVESTIGATE (${(genuinelyUncertainRate * 100).toFixed(1)}%)`
      : `Genuinely-uncertain rate: FAIL (${(genuinelyUncertainRate * 100).toFixed(1)}%)`,
  );
  console.log(
    changeRate >= 0.20 && changeRate <= 0.80
      ? `Change rate: PASS (${(changeRate * 100).toFixed(1)}%)`
      : `Change rate: INVESTIGATE (${(changeRate * 100).toFixed(1)}%)`,
  );
  console.log(`Haiku-wrong rate: review 15 disagreement samples manually`);
}

async function runClassify(args: CliArgs): Promise<void> {
  const apiKey = resolveAnthropicKey();
  void apiKey; // length already logged in main()

  const urlsPath = getUrlsPath(args);
  const classPath = getClassPath(args);

  const records: SampledRecord[] = JSON.parse(readFileSync(urlsPath, "utf-8"));
  console.log(`[phase1c] Loaded ${records.length} records from ${urlsPath}`);
  console.log(`[phase1c] Classifying with concurrency=${args.concurrency}…`);

  const t0 = Date.now();
  const results = await runConcurrent(
    records,
    args.concurrency,
    (r) => classifyOne(apiKey, r),
    progressLogger,
  );
  const totalMs = Date.now() - t0;

  const outputRecords: ClassificationOutputRecord[] = results.map(
    ({ input_tokens, output_tokens, ...r }) => {
      void input_tokens; void output_tokens;
      return r;
    },
  );
  writeFileSync(classPath, JSON.stringify(outputRecords, null, 2), "utf-8");

  const totalIn = results.reduce((s, r) => s + r.input_tokens, 0);
  const totalOut = results.reduce((s, r) => s + r.output_tokens, 0);
  printClassificationSummary(outputRecords, records, { totalIn, totalOut, totalMs }, classPath);
}

// ── --classify-failed-only ──────────────────────────────────────────────────

async function runClassifyFailedOnly(args: CliArgs): Promise<void> {
  const apiKey = resolveAnthropicKey();

  const urlsPath = getUrlsPath(args);
  const classPath = getClassPath(args);

  const existing: ClassificationOutputRecord[] = JSON.parse(readFileSync(classPath, "utf-8"));
  const samples: SampledRecord[] = JSON.parse(readFileSync(urlsPath, "utf-8"));
  const samplesByUrl = new Map(samples.map((s) => [s.source_url, s]));

  // Bracketed sentinels: <failed>, <unparseable>, anything new we add later.
  const failedIdx: number[] = [];
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].new_content_type.startsWith("<")) failedIdx.push(i);
  }

  if (failedIdx.length === 0) {
    console.log("[phase1c] No failed records to retry.");
    return;
  }
  console.log(`[phase1c] Re-classifying ${failedIdx.length} failed records`);
  console.log(`[phase1c] Concurrency=${args.concurrency}…`);

  const failedSamples: SampledRecord[] = [];
  for (const i of failedIdx) {
    const s = samplesByUrl.get(existing[i].source_url);
    if (s) failedSamples.push(s);
    else console.warn(`[phase1c] no sample data for ${existing[i].source_url}`);
  }

  const t0 = Date.now();
  const results = await runConcurrent(
    failedSamples,
    args.concurrency,
    (r) => classifyOne(apiKey, r),
    progressLogger,
  );
  const totalMs = Date.now() - t0;

  // Capture per-record outcomes BEFORE mutating existing[i].
  interface RetryOutcome {
    page_name: string;
    recovered: boolean;
    old_type: string;
    new_type: string;
    haiku_reason: string | null;
  }
  const outcomes: RetryOutcome[] = [];

  const resultsByUrl = new Map(results.map((r) => [r.source_url, r]));
  let recovered = 0;
  for (let i = 0; i < existing.length; i++) {
    const fresh = resultsByUrl.get(existing[i].source_url);
    if (!fresh) continue;
    const wasFailed = existing[i].new_content_type.startsWith("<");
    if (!wasFailed) continue; // safety: shouldn't happen since we only retried failed ones
    const { input_tokens, output_tokens, ...stripped } = fresh;
    void input_tokens; void output_tokens;
    const recoveredFlag = !stripped.new_content_type.startsWith("<");
    outcomes.push({
      page_name: stripped.page_name,
      recovered: recoveredFlag,
      old_type: existing[i].old_content_type,
      new_type: stripped.new_content_type,
      haiku_reason: stripped.haiku_reason,
    });
    if (recoveredFlag) recovered++;
    existing[i] = stripped;
  }

  writeFileSync(classPath, JSON.stringify(existing, null, 2), "utf-8");

  console.log(`\n[phase1c] Recovered ${recovered} of ${failedIdx.length}`);
  console.log(`[phase1c] Wall time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`[phase1c] File written: ${classPath}`);

  console.log(`\n[phase1c] Per-record retry outcomes:`);
  for (const o of outcomes) {
    if (o.recovered) {
      const reasonStr =
        o.new_type === "uncertain" && o.haiku_reason ? ` [reason: ${o.haiku_reason}]` : "";
      console.log(`  ✓ ${o.page_name.padEnd(30)}  ${o.old_type} → ${o.new_type}${reasonStr}`);
    } else {
      console.log(`  ✗ ${o.page_name.padEnd(30)}  still failed: ${o.new_type}`);
    }
  }
}

// ── --report-only ───────────────────────────────────────────────────────────

function runReportOnly(args: CliArgs): void {
  const urlsPath = getUrlsPath(args);
  const classPath = getClassPath(args);
  const records: ClassificationOutputRecord[] = JSON.parse(readFileSync(classPath, "utf-8"));
  const samples: SampledRecord[] = JSON.parse(readFileSync(urlsPath, "utf-8"));
  console.log(`[phase1c] Report-only: ${records.length} records from ${classPath}`);
  printClassificationSummary(records, samples, undefined, classPath);
}

// ── --eyeball: write CSV for manual review in Excel ─────────────────────────

/** RFC 4180-ish CSV escaping. Wraps in quotes if cell contains , " \n \r. */
function csvEscape(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function runEyeball(args: CliArgs): void {
  const urlsPath = getUrlsPath(args);
  const classPath = getClassPath(args);
  const eyeballPath = getEyeballPath(args);
  const records: ClassificationOutputRecord[] =
    JSON.parse(readFileSync(classPath, "utf-8"));
  const samples: SampledRecord[] = JSON.parse(readFileSync(urlsPath, "utf-8"));
  const samplesByUrl = new Map(samples.map((s) => [s.source_url, s]));

  const header = [
    "page_name", "old", "new", "reason", "changed", "is_nav_only", "content_head_first_200",
  ];
  const rows: string[] = [header.map(csvEscape).join(",")];

  for (const r of records) {
    const head = (samplesByUrl.get(r.source_url)?.content_head ?? "")
      .substring(0, 200)
      .replace(/[\r\n]+/g, " "); // single-line for the cell
    const changed =
      !r.new_content_type.startsWith("<") &&
      r.new_content_type !== r.old_content_type;
    const isNavOnly =
      !!r.haiku_reason && NAV_ONLY_REASON_RE.test(r.haiku_reason);
    const cells = [
      r.page_name,
      r.old_content_type,
      r.new_content_type,
      r.haiku_reason ?? "",
      changed ? "TRUE" : "FALSE",
      isNavOnly ? "TRUE" : "FALSE",
      head,
    ];
    rows.push(cells.map(csvEscape).join(","));
  }

  // CRLF line endings for max Excel compatibility, plus trailing newline.
  writeFileSync(eyeballPath, rows.join("\r\n") + "\r\n", "utf-8");

  console.log(`File written to ${eyeballPath}`);
  console.log(
    `Reminder: open in Excel, sort by changed/is_nav_only/old/new to scan systematically.`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  // Skip key resolution for --report-only and --eyeball (no API calls needed).
  if (!args.reportOnly && !args.eyeball) {
    const apiKey = resolveAnthropicKey();
    // SECURITY: never log the key, even partially. Length is a safe sanity probe.
    console.log(`[phase1c] Anthropic key resolved (length=${apiKey.length}).`);
    void apiKey;
  }

  if (args.dryRun) await runDryRun(args);
  if (args.classifyFailedOnly) {
    await runClassifyFailedOnly(args);
  } else if (args.classify) {
    await runClassify(args);
  }
  if (args.reportOnly) runReportOnly(args);
  if (args.eyeball) runEyeball(args);

  if (!args.dryRun && !args.classify && !args.classifyFailedOnly && !args.reportOnly && !args.eyeball) {
    console.log("[phase1c] No mode flag passed. Use one of:");
    console.log("             --dry-run --n=100               # sample URLs");
    console.log("             --classify --concurrency=4      # classify (default conc=4 for rate-limit safety)");
    console.log("             --classify-failed-only          # retry only failed records");
    console.log("             --report-only                   # print summary from existing JSON, no API calls");
    console.log("             --eyeball                       # write phase1c-eyeball.csv for manual review");
    console.log("             --dry-run --classify --n=100    # combined sample + classify");
    console.log("             --corpus                        # modifier: use all fextralife URLs (with --dry-run/--classify/...)");
  }
}

main().catch((err) => {
  // Print only the message — some error objects carry stderr or request
  // payloads on `.cause`, which could include the key if a future caller
  // ever passed it in headers.
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
