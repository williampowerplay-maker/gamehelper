# Learnings & Notes

Things discovered during development that are worth remembering across sessions.

---

## RAG: Chunk Splitting & Overlap

- **Target chunk size ~500 chars for voyage-3.5-lite**: Larger chunks (>800 chars) dilute the embedding signal — the vector tries to represent too many concepts at once. Splitting into 500-char sub-chunks gives each embedding a focused meaning.
- **Intra-section overlap (150 chars)**: When a long section splits, carry the last 150 chars forward as the start of the next sub-chunk. This ensures facts that span the split boundary appear in at least one chunk that contains both sides.
- **Inter-section overlap (120 chars)**: Prepend the tail of the previous `### Section` to the next section's first chunk. This captures cross-boundary facts — e.g. an item's effect described at the end of "Overview" and referenced in "Stats".
- **Break at natural boundaries**: When splitting, try paragraph break (`\n\n`) first, then sentence end (`.!?`), then line break (`\n`), then word boundary (` `). Never cut mid-word.
- **Item pages are the main chunking problem**: avg 666 chars, 303 over 1500 chars. Other content types (boss, quest, exploration) are already short enough at 250-300 avg chars.
- **Dry-run validate before re-ingesting**: Use `--dry-run --category <name>` to verify chunk counts and sample content before burning Voyage API credits on a full re-ingest.

## RAG: Metadata Pre-filtering

- **Content type filter pattern**: Add an optional `content_type_filter TEXT DEFAULT NULL` to the RPC. When set, it narrows the cosine similarity search to a single content type — boss questions only scan ~400 chunks instead of 6000+. pgvector's IVFFlat index still applies within the filtered set.
- **Always add an unfiltered fallback**: If the filtered RPC returns 0 results, retry without the filter before giving up. Some items live in unexpected categories (e.g. Crow's Pursuit is `abyss-gear` not generic `item`).
- **Classifier ordering matters — specific before generic**: Check boss names/verbs first (very specific), then recipe (before item, since "how to craft" could match item too), then item, then quest, etc. First match wins — ambiguous questions should return `null`. **Specifically: put exploration ABOVE mechanic.** A bare `\bhow do\b` in the mechanic regex will happily match "How do I solve the Azure Moon Labyrinth?" and misroute to mechanic. Either put exploration first so `labyrinth` catches it, or remove the bare catch-alls from mechanic and keep only specific phrasings like `how does .+ work`.
- **Beware catch-all verb phrases in specific regexes**: A `/how do/` or `/how does/` token inside a topic-specific regex will swallow questions that are about specific items/locations/bosses. Prefer specific companion terms (`how does the .+ work`, `how do i (solve|get|reach)`) over bare verb fragments.
- **`character` is a reserved word in PostgreSQL**: Quoting as `"character"` is required in both the RETURNS TABLE and SELECT inside the function body.
- **Don't create overloaded RPC functions via `CREATE OR REPLACE FUNCTION` with different signatures**: Supabase's `CREATE OR REPLACE` only replaces the exact signature — if you add a new parameter, the old version stays in the DB as a second function. PostgREST then can't decide which to call when the caller passes N arguments and errors: `Could not choose the best candidate function`. Fix: explicitly `DROP FUNCTION ... (old signature)` before creating the new signature.

## RAG: URL-Match Keyword Boost

- **When the user names a page, that page should dominate**: The URL-match boost finds chunks whose `source_url` contains a multi-word proper noun from the question (e.g. "Azure Moon Labyrinth" → `ilike %Azure+Moon+Labyrinth%`). Baseline similarity for URL matches must be high enough to beat typical filtered-vector scores on unrelated-but-semantically-near pages. Previous values (0.55 baseline + 0.15 rerank boost = 0.70 final) lost to 0.78–0.90 filtered vector results about wrong pages. Bumped to 0.88 baseline + 0.25 rerank = 1.13 final — URL matches now reliably win.
- **Possessive apostrophes break naive multi-word regexes**: `/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g` fails on "Saint's Necklace" because `'s` isn't `\s+[A-Z]`. Fix: `/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g`. This single character blocked all URL-match boosts for possessive-form item/boss names. Very easy to miss because vector search still returns *something*, just the wrong thing (Crossroads Necklace instead of Saint's Necklace).
- **URL encoding for Fextralife wiki**: spaces become `+`, but apostrophes stay literal (`/Saint's+Necklace`). The `ilike` pattern has to preserve the apostrophe verbatim.

## Next.js 16 + Node 24

- **`.env.local` not loading in API routes**: Next.js 16 running on Node 24 had issues where `process.env` didn't pick up `.env.local` values in server-side route handlers. Workaround: built a manual `loadEnv()` function in `route.ts` that reads and parses the file directly. The function checks `process.env.VERCEL` to skip file reads in production (where Vercel injects env vars natively).

## Supabase + pgvector

- **`match_knowledge_chunks` RPC**: This is a custom Postgres function that must exist in Supabase for vector search to work. It takes `query_embedding` (vector), `match_threshold` (float), and `match_count` (int). Make sure the function is created in the Supabase SQL editor before testing vector search.
- **Embedding dimensions**: Voyage AI `voyage-3.5-lite` produces embeddings of a specific dimension. The `embedding` column in `knowledge_chunks` must match this dimension. If switching embedding models, the column and all existing embeddings need to be regenerated.
- **CRITICAL — RPC parameter must be `vector(1024)` not `vector`**: If the `query_embedding` parameter is declared as untyped `vector` (no dimension), PostgREST's JSON→vector cast corrupts `input_type: "query"` embeddings from Voyage AI. The cosine similarity computation breaks silently — correct chunks score near-zero and wrong chunks float to the top. Fix: declare the parameter as `vector(1024)` to match the column type.
- **Passing `match_threshold: 0.0` via supabase-js may use the DEFAULT instead**: When `0.0` is serialized as JSON `0`, PostgREST may treat it as falsy/absent and fall back to the function's DEFAULT threshold. Use an explicit non-zero value or test with negative thresholds to verify the parameter is being received.

## Voyage AI

- **Model choice**: Using `voyage-3.5-lite` for embeddings. It's the lightweight model — good balance of cost and quality for a game guide use case.
- **Use `input_type: "query"` for search queries, `"document"` for ingestion**: The earlier note about `"query"` being corrupted was actually a different bug (untyped `vector` parameter). With the `vector(1024)` fix in place, using the correct input types (query for search, document for storage) gives the best similarity scores.

## Spoiler Tier Prompt Engineering

- **Per-category examples are essential**: The nudge tier prompt needed explicit good/bad examples for each question type (puzzles, items, bosses, mechanics). Without these, the model would sometimes give full answers even when set to "nudge" mode.
- **Snarky no-info responses + scope explainer**: When the knowledge base has no relevant info, the system returns a snarky line followed by a structured "What I'm built for" block — bulleted examples of questions the app IS good at (boss strategies, weapon/armor stats, skill details, NPC info, region directions) and a note that broad overview queries are not well supported. This aligns user expectations with the current KB strengths instead of leaving them at a dead end. Applied both in the API short-circuit (before Claude call) and inside `BASE_SYSTEM_PROMPT` so Claude emits the same block when it falls back. The check happens before the Claude call for the short-circuit path — if relevance thresholds aren't met, we return the snarky+explainer string immediately and skip Claude entirely.
- **Two tiers beat three for this product**: Originally had Nudge / Guide / Full. In practice Guide and Full produced nearly identical output — both were walkthroughs at different token budgets, and users couldn't distinguish them. Collapsed to Nudge (hint, Haiku) + Solution/Full (complete answer, Sonnet). Simpler mental model ("hint me" vs "tell me"), cleaner paywall split, one less prompt to maintain. Lesson: if two tiers in a UX ladder don't produce visibly different outputs, they're the same tier.
- **Legacy tier values in DB**: When collapsing tiers, don't migrate historical data — accept legacy values at read time. Admin stats folds `guide` rows into `full`; chat API silently maps incoming `spoilerTier="guide"` requests to `"full"`. Zero-downtime, zero migration risk.

## Error Logging Pattern

- **Never let error logging crash the app**: Both the client-side `logClientError()` and the `/api/log-error` endpoint are wrapped in try/catch and swallow all exceptions. Logging is always fire-and-forget.
- **React Error Boundaries must be class components**: React's `componentDidCatch` lifecycle is only available in class components — function components cannot be error boundaries. Use `getDerivedStateFromError` for updating state + `componentDidCatch` for side effects (logging).
- **Next.js `error.tsx` vs React ErrorBoundary**: `error.tsx` in App Router catches errors from Server Components and async route handlers. It does NOT catch errors in client components during render — that still needs a React ErrorBoundary. Use both for full coverage.
- **`error_logs` context column (jsonb)**: Store structured metadata about the error — `question`, `tier`, `component`, `url`, `digest` etc. Makes it much easier to reproduce issues from the admin dashboard.
- **Time-bucketed sparklines without a timeseries DB**: Use JS to bucket raw rows into fixed intervals (5-min / 1-hr / 6-hr) client-side. No extra DB query needed — just filter the already-fetched rows. Works fine up to a few thousand rows.
- **Expandable table rows in React**: Use a `expandedId` state string. Render a second `<tr>` immediately after the main row when `id === expandedId`. Use `<>` fragment as the map return so both rows sit at the same level in the `<tbody>`.
- **Server-side error logging should be async and non-blocking**: In API routes, log errors with `.then(() => {})` or inside a separate try/catch after returning the response. Don't `await` the log insert before returning 500 — the user is already waiting.

## RAG Pipeline Design

- **CI env loading pattern**: Scripts that read `.env.local` via `fs.readFileSync` will throw in CI (no file present). Wrap in try/catch and fall back to `process.env`. GitHub Actions injects secrets as environment variables, so `process.env.VOYAGE_API_KEY` works there. Pattern: `process.env[key] || env[key] || ""`.
- **Content change detection via hashing**: Store `sha256(pageContent).slice(0,16)` in a `page_hashes` table keyed by URL. On re-crawl, hash the new content and compare — skip embedding if unchanged. This is the correct way to make scheduled re-ingestion cheap; don't rely on HTTP `Last-Modified` headers (Fextralife doesn't send them reliably).
- **Wiki nav exclusion list can hide entire sub-categories**: `/Abyss+Gear` was in the `navPages` exclusion set, so the ingestion script never crawled it and never followed links to it. When adding new wiki categories, check the exclusion set and remove any that should be crawled. The correct pattern: nav-only pages (index pages, UI pages) go in the exclusion set; content pages do not.
- **1-level crawl misses interconnected content**: The original script crawled Index → linked pages and stopped. Pages like Crow's Pursuit (linked from Abyss Gear, not from Items index) were invisible. Fix: BFS `--deep` mode follows links within level-1 pages to discover level-2 content.
- **Idempotent ingestion**: Use delete-by-source-url before inserting to safely re-run categories without duplicating chunks. Supabase `knowledge_chunks` has no unique constraint on `source_url`, so without this, re-runs multiply the data.

- **Dual search strategy**: Vector search is primary, text search is fallback. This handles cases where embeddings miss something that simple keyword matching would catch.
- **Relevance gating**: Similarity threshold for vector results is 0.5 (with `input_type: "document"` embeddings, relevant chunks typically score 0.6–0.85 and unrelated chunks score < 0.4). Text search fallback requires >= 2 keyword matches. Without these gates, Claude would hallucinate from tangentially related chunks.
- **Keyword extraction**: Stop words list includes game-generic terms ("crimson", "desert") that would match everything and dilute search quality.
- **Response caching**: Before calling Voyage/Claude, check `queries` table for exact `question` + `spoiler_tier` match within 7 days. Returns cached `response` immediately, skipping all API calls. Only kicks in for identical question strings — not fuzzy.
- **Per-tier Claude config**: `TIER_CLAUDE` constant maps each tier to a model, maxTokens, and matchCount. Nudge uses Haiku (150 tokens, 3 chunks) — ~20x cheaper per query. Full/Solution uses Sonnet (1024 tokens, 8 chunks). Wire via `tierConfig = TIER_CLAUDE[spoilerTier]`.
- **Single Supabase client**: One `createClient()` call per request, used for rate limiting, cache check, vector search, and query logging. Avoids creating multiple TCP connections.

## Auth

- **Daily query reset**: The `queries_today_reset_at` field stores a date string. On each login, if the stored date doesn't match today, the counter resets to 0. This avoids needing a cron job.
- **User profile creation**: Currently relies on Supabase triggers or first-sign-in logic to create the user row. Need to verify the trigger exists in the DB.

## Voice Features

- **Browser compatibility**: Web Speech API (SpeechRecognition) only works reliably in Chrome and Edge. Firefox has partial support. Safari is inconsistent. The app shows an alert for unsupported browsers.
- **Type declarations**: Needed a custom `speech.d.ts` for TypeScript to recognize `webkitSpeechRecognition` and related types.

## Mobile Layout

- **`100vh` vs `100dvh` on mobile**: `h-screen` in Tailwind maps to `height: 100vh`, which on mobile browsers includes the browser chrome (address bar, bottom nav bar). The actual visible area is smaller, so a bottom-anchored input gets pushed just below the fold. Fix: use `h-[100dvh]` (dynamic viewport height) which tracks the true visible area. Safari 15.4+, Chrome 108+, Firefox 101+ support `dvh`.
- **Lock body scroll for app-shell layouts**: Add `height: 100%` + `overflow: hidden` to `html` and `body` so the flex container owns all scrolling. Without this, the page itself can scroll and break the fixed-input illusion.

## Windows: Running Detached Long-Running Processes

- **Bash background jobs (`&`) die when the shell closes on Windows**: Running `tsx script.ts >> log.log 2>&1 &` in Claude Code's bash tool will get killed the moment the bash session ends (the task completes but the child process is killed). The log gets truncated and nothing is inserted.
- **Use PowerShell `Start-Process` for truly detached processes**:
  ```powershell
  Start-Process -FilePath 'node_modules\.bin\tsx.cmd' -ArgumentList @('scripts/ingest-fextralife.ts', '--deep', '--category', 'accessories') -WorkingDirectory 'C:\path\to\project' -RedirectStandardOutput 'ingest.log' -NoNewWindow -PassThru | Select-Object Id
  ```
  This returns a PID and the process keeps running even after the shell closes.
- **Check ingest progress via Supabase SQL** when the output file is unavailable: `SELECT COUNT(*), MAX(created_at) FROM knowledge_chunks WHERE source_type = 'fextralife_wiki'` — if `MAX(created_at)` is recent and COUNT is growing, it's still running.
- **If the computer sleeps, in-flight HTTP requests time out**: The node process resumes on wake but any mid-request Voyage API or Fextralife fetches will have errored. Depending on error handling the script may skip that batch and continue, or halt. Check the log file and chunk count after waking to confirm status.

## Default Spoiler Tier

- **Set `nudge` as the default tier** (not `guide`): Nudge uses Haiku (cheapest model, 150 tok, 3 chunks) — ~20x cheaper per query than Sonnet. Most new users haven't chosen their preference yet, so defaulting to the cheapest tier saves significant API cost at scale. Users who want more detail can switch to Guide/Full.

## Database Maintenance

- **Duplicate chunks from multiple ingest runs**: The ingest script does delete-before-insert per URL, but if run multiple times or across different category flags, the same URL can end up with multiple sets of chunks. Fix: deduplicate with `DELETE WHERE id NOT IN (SELECT DISTINCT ON (source_url, md5(content)) id ... ORDER BY created_at DESC)`. Session 9 removed 72,702 dupes (73% of DB).
- **Nav-list junk chunks**: Fextralife wiki pages have sidebar navigation lists (`♦ item1 ♦ item2 ♦ item3...`) that get captured as chunks. These are pure noise — they contain no useful information about the page topic but compete in vector search results. Fix: `DELETE WHERE content LIKE '%♦%♦%♦%'`. Session 9 removed 9,527 junk chunks (36% of remaining).
- **Clear query cache after changes**: The `queries` table caches responses for 7 days. After any prompt, DB, or classifier change, `DELETE FROM queries` is required or users will get stale cached responses. Easy to forget.
- **Supplemental scraping pattern**: When the main crawler misses specific sections (e.g., "How to Obtain" on item pages), build a targeted supplemental scraper that: (1) queries existing URLs from the DB, (2) re-fetches each page, (3) extracts only the missing section, (4) inserts as a new chunk with embedding. Make it idempotent by checking for existing supplemented chunks. This is faster and cheaper than re-crawling everything.

## Prompt Engineering (RAG-specific)

- **Include game world context in system prompt**: Claude produces much better responses when the system prompt includes game-specific knowledge (world name, protagonist, factions, regions, combat systems). Without this, Claude sounds generic and misses connections between chunks.
- **"Share what you know" beats "only answer if directly relevant"**: An overly strict prompt ("If context doesn't directly answer, say you don't know") causes Claude to discard partially-relevant context. Better: "Share EVERY useful detail from the context, even if it doesn't perfectly match the question. Say what's missing."
- **Source metadata in context helps**: Prefixing each chunk with `[Source: PageName]` helps Claude identify where info comes from and prioritize.
- **Nudge tier needs explicit anti-leak rules**: When context contains detailed strategies (button inputs, phase breakdowns), Claude will leak them into nudge responses unless explicitly told not to. Good/bad examples in the prompt are essential. Also: fewer chunks (2 vs 3) and lower max tokens (100 vs 150) help.
- **Wiki section header variants break extraction**: Fextralife uses "How to Get", "How to Obtain", "How to Craft", "Where to Find" inconsistently across pages. Any regex-based extractor must account for all variants.

## Deployment

- **Vercel Hobby plan**: Does not support git-triggered deploys from collaborators. The git author's email must match the Vercel account owner. Fix: deploy via CLI (`npx vercel --prod`) instead of git integration.
- **Node.js 24.x breaks Vercel builds**: Next.js 16 doesn't support Node 24 yet. Set Node.js version to 20.x in Vercel Settings → General.
- **Vercel project config can break when changing git connections**: Disconnecting/reconnecting a git repo can corrupt project settings, causing 0ms build failures with no error message. Fix: redeploy a known-good deployment from the dashboard, then use CLI deploys going forward.
- **`.env.local` manual loader**: The `loadEnv()` function in the API route checks `process.env.VERCEL` to skip file-based env loading in production — Vercel provides env vars directly via `process.env`.
