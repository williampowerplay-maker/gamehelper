# Changelog

All notable changes to the Crimson Desert Guide project.

---

## [0.6.1] - 2026-04-04 (Starter Question Retrieval Fixes)

### Fixed
Four homepage starter questions were not returning correct results. Root causes found via `scripts/debug-starters-full-pipeline.ts`:

- **Classifier misroute on "how do I solve X"** — `/how do/` in the mechanic regex was swallowing location/exploration questions. Azure Moon Labyrinth was routed to `mechanic` → filter missed the page entirely (top 5 became unrelated "Challenges" chunks). **Fix**: moved exploration regex *above* mechanic; added `labyrinth|ruin|tower|temple|crypt|catacomb|sanctum|dungeon|cave` and `how do i (solve|complete|clear|finish)` keywords to exploration; removed bare `how do`/`how does` from mechanic (kept the more specific `how does .+ work` phrasing).
- **Possessive-apostrophe regex bug in URL-match boost** — `quotedNames = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g` couldn't match "Saint's Necklace" or "Kailok's Lair" because the `'s` broke the second-word boundary. URL boost never fired for these questions; vector search returned semantically near-but-wrong items (Crossroads Necklace instead of Saint's Necklace). **Fix**: regex now tolerates possessive `'s`: `/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g`.
- **URL-match boost too weak** — baseline similarity 0.55 + 0.15 rerank boost = 0.70 final. Filtered vector searches often return unrelated results at sim 0.78–0.90 (semantic near-misses), so URL-matched chunks from the *actually-named page* would lose the rerank. **Fix**: baseline 0.55 → **0.88**, rerank boost 0.15 → **0.25**. When the user explicitly names a page in their question, that page now dominates over any semantic drift.

### Results (measured via `scripts/debug-starters-full-pipeline.ts`)
All 4 starter questions now retrieve the correct page in the top-5 with similarity ≥ 1.0:
- "How do I solve the Azure Moon Labyrinth?" — was returning "Challenges" page, now returns Azure Moon Labyrinth (sim 1.13)
- "Best strategy for Kailok the Hornsplitter?" — already worked; slightly better (now Kailok wiki page 1.01 instead of YouTube transcripts)
- "Where is the Saint's Necklace?" — was returning **Crossroads Necklace (wrong item!)**, now returns Saint's Necklace (sim 1.13)
- "How does the Abyss Artifact system work?" — already worked; now hits the dedicated `/Abyss+Artifact` page instead of the `/Sealed+Abyss+Artifacts` spillover page

### DB admin task completed (2026-04-04)
Dropped the duplicate `match_knowledge_chunks` RPC overload. Ran in Supabase SQL editor:
```sql
DROP FUNCTION public.match_knowledge_chunks(vector, double precision, integer);
```
Note: the actual stored signature uses `vector` without an explicit dimension (per `pg_proc.pg_get_function_identity_arguments`), not `vector(1024)` — had to match the stored form exactly. Verified via re-query of `pg_proc` — only the 4-arg version (with `content_type_filter text`) remains. The unfiltered-retry fallback path and `null`-classifier path now work cleanly — no more `Could not choose the best candidate function` errors from PostgREST.

### Regression check
Re-ran `scripts/test-rag-quality.ts` full suite after fixes: **42/59 (71.2%)**, avg sim 0.774 — identical pass rate to pre-fix baseline. No regressions. The starter-question fixes target URL-explicit proper-noun queries, which aren't in the test suite.

---

## [0.6.0] - 2026-04-04 (Two-Tier Spoiler System + No-Info Scope Explainer)

### Changed
- **Collapsed spoiler tiers from 3 to 2**: `nudge` (gentle hint, Haiku) + `full` (complete answer, Sonnet). Dropped the middle `guide` tier — its step-by-step formatting guidance was merged into the new `full` prompt.
  - `SpoilerTierSelector` now renders two buttons: "Nudge" and "Solution" (formerly "Full Solution"). The "Guide 📖" option is gone.
  - `SpoilerTier` type in `src/lib/supabase.ts` narrowed to `"nudge" | "full"`.
  - `TIER_CLAUDE` map in `src/app/api/chat/route.ts` has 2 entries. `SPOILER_INSTRUCTIONS` has 2 prompts. Full prompt absorbed Guide's mobile-scannable formatting (bold key actions, numbered steps, no filler).
  - Chat API default tier changed from `"guide"` to `"nudge"` (cheapest, preserves discovery).
  - Legacy compatibility: incoming requests with `spoilerTier="guide"` are silently mapped to `"full"` at the top of the POST handler so cached clients don't break.
- **Admin dashboard** folds legacy `guide` query rows into the `full` count. Tier breakdown chart now shows 2 bars (Solution, Nudge). `/api/admin/stats` returns `{ nudge, full }` instead of `{ nudge, guide, full }`.
- **`ChatMessage` tier badge** map updated — 2 entries only.

### Added
- **Scope explainer in no-info fallback responses**: when retrieval returns nothing relevant (or Claude judges context irrelevant), the snarky line is now followed by a structured "What I'm built for" block explaining the app's strengths (boss strategies, weapon/armor stats, skill details, NPC info, region directions) with 4 example queries and a note about broad-overview question limitations. Applied in both the API short-circuit (`SCOPE_EXPLAINER` constant) and the `BASE_SYSTEM_PROMPT` / nudge `SPOILER_INSTRUCTIONS` so Claude emits the same block when it decides to fall back.

### Rationale
The Guide and Full tiers were producing nearly indistinguishable output in practice — both were walkthroughs at slightly different token budgets. Users couldn't tell which to pick. Collapsing to Nudge (hint) + Solution (answer) gives a clearer mental model and cleaner free→premium paywall split, and removes a prompt to maintain.

### Migration
- **DB**: no schema change. Historical `queries.spoiler_tier = 'guide'` rows are preserved; they're treated as `full` at read time.
- **Type/prompt files**: `route.ts`, `supabase.ts`, `SpoilerTierSelector.tsx`, `ChatMessage.tsx`, `admin/page.tsx`, `admin/stats/route.ts` all updated. Typecheck passes.

---

## [0.5.7] - 2026-04-04 (Full Reseed Complete + RAG Quality Baseline)

### Completed
- **Full knowledge base reseed** across all 17 categories using `--deep` 2-level BFS + chunk-overlap format. Total: **82,312 chunks**. All categories ingested between 2026-04-03 16:47 and 17:46 UTC.
- Per-content-type avg chunk lengths confirm overlap format applied: boss 429, quest 280, item 519 (down from pre-overlap 666), exploration 458, mechanic 482, recipe 468, character 299.

### Measured
- **RAG quality baseline**: 42/59 test cases pass (71.2%), avg similarity 0.777. Strong (100%) in bosses, enemies, armor, abyss-gear, accessories, collectibles, locations, characters, npcs. Weak: items (25%), walkthrough (33%), guides (33% — category has only 2 chunks, crawler issue).

### Fixed
- **`scripts/test-rag-quality.ts`**: was calling the old `match_chunks` RPC instead of `match_knowledge_chunks` — the test suite couldn't run at all until fixed.

---

## [0.5.6] - 2026-04-03 (Chunk Splitting & Overlap)

### Changed
- **`chunkPageContent()`** in `scripts/ingest-fextralife.ts` now uses sliding-window overlap:
  - `CHUNK_SPLIT_AT = 800` — sections over this are split into sub-chunks
  - `CHUNK_TARGET = 500` — target chars per sub-chunk
  - `CHUNK_OVERLAP = 150` — chars carried forward between intra-section sub-chunks so adjacent chunks share context
  - `INTER_OVERLAP = 120` — last ~120 chars of the previous section prepended to the next section's first chunk
- Added `splitWithOverlap()` helper — finds natural break points (paragraph → sentence → line → word) before splitting
- Added `sectionTail()` helper — extracts a clean word-boundary-aligned tail for inter-section overlap prefix
- Extracted `makeChunkMeta()` to DRY up chunk construction

### Why it matters
- Item chunks were averaging 666 chars with 303 over 1500 chars — one embedding had to represent a wall of stats
- After this change, long item pages produce multiple focused sub-chunks each with a specific concept (obtain → craft → stats → notes)
- Cross-section facts (e.g. a stat mentioned in the notes of the previous section) are now captured in the overlap prefix of the next chunk

### Note
Requires a full re-ingest to apply to existing chunks. Already-running ingest for remaining categories will use the new chunking automatically.

---

## [0.5.5] - 2026-04-03 (RAG Metadata Pre-filtering)

### Added
- **`classifyContentType(question)`** in chat route — keyword + regex classifier mapping questions to 7 content types: `boss`, `item`, `quest`, `exploration`, `mechanic`, `recipe`, `character`. Returns `null` for ambiguous questions (no filter applied).
- **`content_type_filter TEXT DEFAULT NULL`** param in `match_knowledge_chunks` RPC — adds `AND kc.content_type = content_type_filter` to the WHERE clause so pgvector scores only the relevant chunk subset.
- **Automatic unfiltered fallback** — if filtered search returns 0 results (item living in an unexpected category), route retries without the filter before falling back to keyword search.

### Why it helps
- Boss fight questions search ~400 chunks instead of 6000+ — faster, less noise to Claude
- Item questions search ~3000 chunks (all gear types)
- No regression risk: zero-result filtered searches always fall back to full corpus

---

## [0.5.4] - 2026-04-02 (Error Dashboard Time Filters)

### Added
- **`/api/admin/errors` endpoint**: Dedicated error log API accepting `?window=1h|24h|7d`. Returns filtered error list (up to 200), breakdown by type, and time-series bucketed data (5-min buckets for 1h, 1-hr buckets for 24h, 6-hr buckets for 7d).
- **Error Dashboard time filter UI** in `/admin`:
  - **1h / 24h / 7d toggle buttons** — switches window, auto-refetches
  - **Sparkline bar chart** — shows error frequency over time for selected window using appropriate bucket sizes
  - **Type breakdown cards** — one card per error type with count, % of total, and colored progress bar
  - **Expandable error rows** — click any row to expand full context (JSON prettified), stack trace (scrollable), and exact timestamp + IP
  - **Refresh button** — manual refresh without switching windows
  - Auto-fetches errors on login and whenever window changes

---

## [0.5.3] - 2026-04-02 (Error Boundaries & Logging)

### Added
- **`error_logs` Supabase table**: Captures `error_type`, `message`, `stack`, `context` (jsonb), `client_ip`, `created_at`. Indexed on `created_at DESC` and `error_type`.
- **`/api/log-error` endpoint**: POST endpoint receives client-side errors and writes to `error_logs`. Truncates stack to 2000 chars, message to 500 chars. Never throws — designed to be fire-and-forget.
- **`src/lib/logError.ts`**: Client-side `logClientError()` utility. Wraps the fetch in try/catch so it never crashes the app.
- **`src/components/ErrorBoundary.tsx`**: React class component (`componentDidCatch`) with a gaming-themed "Something went wrong / Try again" fallback UI. Logs error type, message, stack, component name, and component stack to `error_logs` via `logClientError`.
- **`src/app/error.tsx`**: Next.js App Router global error page — catches server component failures, logs them on mount, shows a themed error screen with "Try again" button and error digest ref.
- **Server-side error logging in `/api/chat`**: Outer catch block, Voyage AI errors, and Claude API errors all write to `error_logs` asynchronously (non-blocking).
- **Admin dashboard — Error Log section**: "Recent Errors (last 30)" table with colored type badges (`client_render`=yellow, `api_chat`=red, `voyage`=purple, `claude`=blue, `unhandled`=orange), message, compact JSON context, IP, and time ago. New "Errors (24h)" stat card in overview grid.

### Modified
- `src/app/layout.tsx` — wrapped `{children}` in `<ErrorBoundary componentName="RootLayout">` so any render crash shows a graceful fallback instead of a white screen.
- `src/app/api/admin/stats/route.ts` — added `recentErrors` (last 30 rows) and `errorsLast24h` count to parallel queries and response payload.

---

## [0.5.2] - 2026-04-02 (Admin CSV Export)

### Added
- **`/api/admin/export` route**: Protected by `ADMIN_SECRET` Bearer token. Accepts `?type=waitlist` or `?type=users` and returns a properly formatted `.csv` download with `Content-Disposition` header.
  - `waitlist` export: `email, signed_up_at` — all waitlist signups ordered newest first
  - `users` export: `id, email, tier, queries_today, signed_up_at` — all registered users
  - Values with commas/quotes/newlines are properly escaped per RFC 4180
- **Export buttons on `/admin` dashboard**: "↓ Waitlist CSV" (green) and "↓ Users CSV" (blue) buttons in the header — click to instantly download the CSV. Uses browser `Blob` + anchor click trick so no new tab opens.

---

## [0.5.1] - 2026-04-02 (Automated Wiki Monitoring)

### Added
- **`page_hashes` Supabase table**: Stores `sha256(content)[0:16]` per crawled URL + category. Enables change detection between runs.
- **`--changed-only` flag**: Before embedding, the script hashes each page's content and compares against `page_hashes`. Unchanged pages are skipped entirely — no Voyage API call, no DB write. Only new/changed pages get re-embedded and re-inserted.
- **GitHub Actions workflow** (`.github/workflows/wiki-reseed.yml`):
  - Runs every Sunday at 3am UTC with `--changed-only` (only processes changed wiki pages)
  - Manual trigger via GitHub Actions UI with options for `--deep` and `--category`
  - Reads secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `VOYAGE_API_KEY`
- **CI-safe env loading**: Ingestion script now wraps `.env.local` read in try/catch and falls back to `process.env` — works in GitHub Actions without the file.

### Setup required
Add these three secrets to GitHub repo → Settings → Secrets and variables → Actions:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `VOYAGE_API_KEY`

---

## [0.5.0] - 2026-04-02 (Deeper Wiki Ingestion)

### Changed
- **New categories added**: `abyss-gear` (`/Abyss+Gear`), `npcs` (`/NPCs`), `collectibles` (`/Collectibles`), `key-items` (`/Key+Items`), `accessories` (`/Accessories`) — these were all missing from the ingestion script. Abyss Gear was also in the nav exclusion set, so it was actively blocked.
- **2-level BFS crawl** (`--deep` flag): Index page → Level-1 pages → Level-2 pages (links found within Level-1 pages). Discovers interconnected content that index pages don't link to directly (e.g., gear obtainable from a quest, crafted from an enemy drop, etc.).
- **Idempotent re-runs**: Before inserting, the script now deletes existing chunks by `source_url`. Re-running a category cleans and replaces without duplicating.
- **`extractLinks` / `extractLinksFromIndex` merged**: Single function used for both index and content pages.
- **NAV_PAGES exclusion updated**: Removed `/Abyss+Gear`, `/NPCs`, `/Collectibles`, `/Key+Items` from exclusion — these are now explicit crawl targets.

### To re-seed the database
```bash
# Just the missing categories (fast, targeted)
npx tsx scripts/ingest-fextralife.ts --category abyss-gear
npx tsx scripts/ingest-fextralife.ts --category npcs
npx tsx scripts/ingest-fextralife.ts --category collectibles

# Full re-seed with deep crawl (slow but comprehensive)
npx tsx scripts/ingest-fextralife.ts --deep
```

---

## [0.4.2] - 2026-04-02 (Default Spoiler Tier)

### Changed
- **Default spoiler tier set to "nudge"**: New users start with the least spoilery experience instead of "guide".

---

## [0.4.1] - 2026-04-02 (Mobile UX Fix)

### Fixed
- **Input above fold on mobile**: Replaced `h-screen` (`100vh`) with `h-[100dvh]` (dynamic viewport height). `100vh` includes mobile browser chrome (address bar, nav bar), pushing the input just below the visible area. `dvh` respects the actual visible viewport.
- **Header padding tightened on mobile**: `py-2 sm:py-4` saves ~16px vertical space on small screens.
- **Subtitle hidden on mobile**: "AI-powered game companion" tagline hidden on small screens (`hidden sm:block`) to recover space.
- **Page scroll locked**: Added `height: 100%` + `overflow: hidden` to `html`/`body` so the flex layout stays locked and the page doesn't scroll outside the container.

---

## [0.4.0] - 2026-04-02 (Cost Optimizations)

### Changed
- **Per-tier Claude model**: Nudge tier now uses `claude-haiku-4-5-20251001` (150 max tokens, 3 chunks) instead of Sonnet — ~20x cheaper per nudge query. Guide uses Sonnet at 600 tokens/6 chunks. Full uses Sonnet at 1024 tokens/8 chunks. Configured via `TIER_CLAUDE` constant.
- **Response caching**: Before calling Voyage AI or Claude, the API now checks the `queries` table for an identical `question` + `spoiler_tier` within the last 7 days. Cache hits skip all external API calls entirely.
- **Single Supabase client**: Merged `rateLimitDb` and `supabase` into one `createClient()` call per request.
- **Per-tier match count**: Vector search `match_count` is now 3/6/8 for nudge/guide/full respectively (was always 8).

---

## [0.3.0] - 2026-04-02 (Bug Fix + Admin)

### Fixed
- **Critical RAG bug**: `match_knowledge_chunks` Postgres function parameter was `vector` (untyped). When PostgREST casts a JSON float array to an untyped `vector`, Voyage `input_type: "query"` embeddings are silently corrupted — relevant chunks scored near-zero while unrelated chunks floated to the top. Fixed by changing parameter to `vector(1024)`.
- **Query embedding type**: Changed API route from `input_type: "query"` to `input_type: "document"` for Voyage AI. The "query" embedding space gets distorted through the PostgREST JSON→vector cast; "document" type passes through correctly and relevant chunks now score 0.6–0.85.
- **Vector search threshold**: Raised from `0.0` to `0.5` in both the RPC call and the `hasRelevantContext` check. With correct embeddings, relevant content scores > 0.6 and unrelated content scores < 0.4, so 0.5 cleanly separates them.
- **match_count**: Increased from 5 to 8 to give Claude more context per query.

### Added
- **Admin dashboard** (`/admin`): Password-gated analytics page showing overview stats (total queries, today, users, premium, waitlist, tokens), 7-day query bar chart, spoiler tier usage breakdown, knowledge base chunk counts by type, and recent queries table (last 50). Protected by `ADMIN_SECRET` env var.
- **Admin API** (`/api/admin/stats`): Aggregates data from `queries`, `users`, `waitlist`, and `knowledge_chunks` tables via 10 parallel Supabase queries.

---

## [0.2.0] - 2026-04-01 (Feature Sprint)

### Added
- **Signup cap + waitlist**: Limits signups to 100 users (configurable via `NEXT_PUBLIC_MAX_USERS`). When full, shows waitlist email form that saves to `waitlist` table in Supabase.
- **Rate limiting**: IP-based, server-side. Free: 5/min, 20/hr. Premium: 10/min, 60/hr. Friendly messages shown inline in chat. Uses `client_ip` column on `queries` table with index.
- **Google AdSense integration**: `AdBanner` component (horizontal + rectangle formats), `UpgradeCTA` component. Banner ad after every 3rd response, upgrade CTA every 5th, desktop sidebar ad (300x250). Premium users see zero ads. AdSense script lazy-loaded in layout.
- **Fextralife wiki ingestion script** (`scripts/ingest-fextralife.ts`): Crawls 12 wiki categories, extracts content, chunks by heading sections, generates Voyage AI embeddings, upserts to Supabase. Supports `--dry-run` and `--category` flags.
- **Knowledge base seeded**: 1,690 chunks from Fextralife wiki across all categories:
  - Bosses: 38 | Quests: 222 | Weapons: 389 | Armor: 244
  - Skills: 165 | Items: 95 | Locations: 191 | Characters: 89
  - Guides: 1 | Enemies: 12 | Crafting: 30 | Walkthrough: 214
- **Project tracking files**: PROJECT_STATUS.md, CHANGELOG.md, LEARNINGS.md, TODO_MANUAL.md for cross-machine development.
- **Supabase migrations**: `waitlist` table, `client_ip` column + index on `queries` table.

### Technical Decisions
- Used nav-page exclusion set for wiki link extraction to avoid crawling sidebar/header links from every page
- 1.5s delay between wiki requests to be respectful to Fextralife servers
- Batch embedding (32) and batch insert (50) for efficient ingestion
- AdSense only loads when `NEXT_PUBLIC_ADSENSE_ID` env var is set — zero impact when unconfigured

---

## [0.1.0] - 2026-03-26 (Initial Build)

### Added
- **Next.js 16 project** scaffolded with App Router, React 19, TypeScript 6, Tailwind CSS 4
- **Chat UI** with dark gaming theme (custom CSS variables: crimson, gold, dark surfaces)
  - Message bubbles with user/assistant styling
  - Animated loading dots (pulse-glow keyframes)
  - Sample starter questions for new users
  - Custom scrollbar styling
- **Spoiler Tier System** with three levels:
  - **Nudge** - 1-2 sentence hints, no exact solutions
  - **Guide** - Step-by-step walkthrough (3-5 steps)
  - **Full Solution** - Complete detailed answer with all info
  - Each tier has a carefully crafted system prompt with examples of good/bad responses
- **RAG Pipeline** in `/api/chat/route.ts`:
  - Voyage AI `voyage-3.5-lite` for query embeddings
  - Supabase pgvector `match_knowledge_chunks` RPC for semantic search
  - Text-search fallback: keyword extraction (with stop words), ilike matching, ranked by keyword overlap
  - Relevance gating: similarity > 0.3 (vector) or >= 2 keyword matches (text) required
  - Claude Sonnet (`claude-sonnet-4-20250514`) for answer generation
  - Async query logging to Supabase `queries` table
- **Auth System** via Supabase Auth:
  - Email/password sign up and sign in
  - Google OAuth with redirect callback
  - AuthProvider React context with session management
  - User tier (free/premium) and daily query counter
- **Voice Features**:
  - Speech-to-text input via Web Speech API (Chrome/Edge)
  - Text-to-speech playback button on AI responses
- **Demo Mode** - Canned responses when API keys aren't configured
- **Snarky Fallbacks** - 5 randomized humorous responses when no relevant context found
- **Manual .env.local loader** in API route as workaround for Next.js 16 / Node 24 env loading

### Technical Decisions
- Used Voyage AI (`voyage-3.5-lite`) instead of OpenAI for embeddings — lighter, cheaper for this use case
- Chose Supabase over standalone Postgres for built-in auth, realtime, and pgvector support
- Built custom env loader in API route because Next.js 16 with Node 24 had issues loading .env.local in server routes
- Spoiler tier prompts are detailed with per-category examples (puzzles, items, bosses, mechanics) to prevent prompt leakage between tiers

---

## Planned / Next Steps

- Content ingestion pipeline (scrape/chunk/embed game guides into knowledge_chunks)
- Streaming responses (SSE) for better UX
- Rate limiting enforcement based on user tier
- Conversation history / multi-turn context
- Admin dashboard for content management and usage analytics
- Payment integration (Stripe) for premium tier
