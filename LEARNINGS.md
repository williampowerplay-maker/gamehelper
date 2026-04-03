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
- **Classifier ordering matters**: Check boss names/verbs first (very specific), then recipe (before item, since "how to craft" could match item too), then item, then quest, etc. First match wins — ambiguous questions should return `null`.
- **`character` is a reserved word in PostgreSQL**: Quoting as `"character"` is required in both the RETURNS TABLE and SELECT inside the function body.

## Next.js 16 + Node 24

- **`.env.local` not loading in API routes**: Next.js 16 running on Node 24 had issues where `process.env` didn't pick up `.env.local` values in server-side route handlers. Workaround: built a manual `loadEnv()` function in `route.ts` that reads and parses the file directly. The function checks `process.env.VERCEL` to skip file reads in production (where Vercel injects env vars natively).

## Supabase + pgvector

- **`match_knowledge_chunks` RPC**: This is a custom Postgres function that must exist in Supabase for vector search to work. It takes `query_embedding` (vector), `match_threshold` (float), and `match_count` (int). Make sure the function is created in the Supabase SQL editor before testing vector search.
- **Embedding dimensions**: Voyage AI `voyage-3.5-lite` produces embeddings of a specific dimension. The `embedding` column in `knowledge_chunks` must match this dimension. If switching embedding models, the column and all existing embeddings need to be regenerated.
- **CRITICAL — RPC parameter must be `vector(1024)` not `vector`**: If the `query_embedding` parameter is declared as untyped `vector` (no dimension), PostgREST's JSON→vector cast corrupts `input_type: "query"` embeddings from Voyage AI. The cosine similarity computation breaks silently — correct chunks score near-zero and wrong chunks float to the top. Fix: declare the parameter as `vector(1024)` to match the column type.
- **Passing `match_threshold: 0.0` via supabase-js may use the DEFAULT instead**: When `0.0` is serialized as JSON `0`, PostgREST may treat it as falsy/absent and fall back to the function's DEFAULT threshold. Use an explicit non-zero value or test with negative thresholds to verify the parameter is being received.

## Voyage AI

- **Model choice**: Using `voyage-3.5-lite` for embeddings. It's the lightweight model — good balance of cost and quality for a game guide use case.
- **Use `input_type: "document"` for query embeddings too**: Despite Voyage's docs recommending `input_type: "query"` for retrieval queries, this type's embeddings get corrupted when cast through PostgREST's JSON→`vector(1024)` conversion. Using `input_type: "document"` for both queries and stored chunks gives consistent, correct cosine similarity scores (Kailok query → Kailok chunks score 0.85 vs ~0.33 for unrelated content).

## Spoiler Tier Prompt Engineering

- **Per-category examples are essential**: The nudge tier prompt needed explicit good/bad examples for each question type (puzzles, items, bosses, mechanics). Without these, the model would sometimes give full answers even when set to "nudge" mode.
- **Snarky no-info responses**: When the knowledge base has no relevant info, the system returns a random snarky response instead of calling Claude at all. This saves API costs and gives personality. The check happens before the Claude call — if relevance thresholds aren't met, we short-circuit.

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
- **Per-tier Claude config**: `TIER_CLAUDE` constant maps each tier to a model, maxTokens, and matchCount. Nudge uses Haiku (150 tokens, 3 chunks) — ~20x cheaper per query. Guide/Full use Sonnet. Wire via `tierConfig = TIER_CLAUDE[spoilerTier]`.
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

## Deployment

- **Vercel**: The app is configured for Vercel deployment. `next.config.ts` passes through `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` via the `env` config. On Vercel, set these in the project's environment variables dashboard.
- **`.env.local` manual loader**: The `loadEnv()` function in the API route checks `process.env.VERCEL` to skip file-based env loading in production — Vercel provides env vars directly via `process.env`.
