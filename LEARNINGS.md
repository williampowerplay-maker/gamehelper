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

## RAG: Nudge Tier Chunk Count Scaling

- **As the DB grows, Nudge chunk count needs to grow too**: Started at 2 chunks for Nudge tier when the DB had ~17k chunks. Fine then — 2 top results were reliably correct. After adding 21k more chunks (38k total), 2 chunks became too narrow: grappling and fast travel queries ranked their answer 3rd or 4th and got cut off. Raised to 4. Lesson: **revisit chunk counts whenever the DB roughly doubles in size**.
- **Cache can mask newly ingested content**: If a query was cached before new content was added, the stale "I don't know" response gets served for 7 days even though the answer is now in the DB. When ingesting new categories that fix known retrieval gaps, **always clear the cache for those specific failing queries** via `DELETE FROM queries WHERE question = '...'` in Supabase.
- **Nudge token budget doesn't need to grow with chunk count**: Increasing from 2→4 chunks doesn't require increasing `maxTokens` — Claude Haiku is still capped at 100 tokens and will synthesize from whichever chunks are most relevant. More chunks = more retrieval candidates, not necessarily more output.

## RAG: Item Location Re-ranking

- **Item pages contain both stats AND location data — but stats sections are often first**: Fextralife item pages have a "Where to Find" section, but the page's opening sections (name, stats, effects) generate chunks that are semantically close to "where is X" queries. Without a location-specific boost, stats/refinement chunks outscore the location chunk.
- **Location-intent boost pattern**: In the Step C re-ranking loop, detect whether the query is asking for location (`where do i find`, `how to get`, `where to obtain`, etc.). If yes, add +0.15 to chunks containing location signal phrases: `where to find`, `can be found`, `obtained from`, `merchant`, `boss drop`, `chest`, `dropped by`, `found in`, `sold by`, `purchase from`, `reward from`. This promotes the location-data chunk above surrounding stats chunks.
- **Fextralife has ~1,330 chunks with "where to find"** — good coverage of weapons/armor/shields/accessories. If a query returns no location info, the item may be a true content gap (e.g. White Lion Necklace — no location data in either source).
- **Keep location-intent classifier broad**: The `getItemPhrases` regex must catch `how to get`, `how do I obtain`, `where can I obtain` in addition to `where do I find`. These patterns should route to `content_type = 'item'` rather than falling through to mechanic/exploration classifiers that would pick the wrong content.

## RAG: Wiki Domain Fragmentation

- **Fextralife wiki has two subdomains**: `crimsondesert.wiki.fextralife.com` (original, most content) and `crimsondesertgame.wiki.fextralife.com` (newer migration). Some pages redirect across domains — e.g. `/Grappling` on the original domain 301s to the new domain. The ingest script uses a fixed `BASE_URL` and may not follow cross-domain redirects, resulting in sparse or empty chunk extraction for those pages. Workaround: the linked skill pages (Restrain, Throw, Lariat etc.) are crawled via BFS from the redirect target and do get ingested correctly. The overview page itself may be thin.
- **Check for redirects when a category produces unexpectedly few chunks**: If an index page returns far fewer chunks than expected, fetch it manually in Node and check for a 301 response with a `Location` header pointing to a different domain.

## RAG: Classifier Keyword Coverage

- **Add new content category keywords to the classifier immediately**: When a new wiki category is ingested (e.g. "challenges"), add its keywords to `classifyContentType()` at the same time. If the classifier doesn't recognize "challenge" as a mechanic question, it returns `null` and the search runs unfiltered across all 17,000+ chunks — correct chunks rarely win.
- **"challenge" questions belong in the mechanic content type**: Challenges in Crimson Desert are game mechanics (life skills, exploration tasks, minigames). Classifier regex: `challenge|challenges|mastery|minigame|mini-game` added to mechanic regex.

## RAG: Ingest DELETE Silently Fails with Anon Key (RLS)

- **The DELETE step in ingest-from-cache.ts uses supabase-js with the anon key** — but RLS restricts DELETE on `knowledge_chunks` to `service_role` only. The DELETE silently succeeds (returns no error, 0 rows deleted), then INSERT adds new chunks alongside the old ones. You end up with duplicates: same source_url, same text, but two different `content_type` labels.
- **Symptom**: After a re-ingest you see the same source_url appearing under two content_type values in the DB. Query: `SELECT source_url, array_agg(DISTINCT content_type) FROM knowledge_chunks WHERE source_url LIKE '%game8%' GROUP BY source_url HAVING COUNT(DISTINCT content_type) > 1`.
- **Fix**: Use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) in `.env.local` for ingest scripts. Or use the Supabase MCP `apply_migration` / `execute_sql` to run the DELETE as service_role.
- **Content_type must match classifier**: When ingesting a new category, check what `content_type` the classifier routes those queries to (`classifyContentType()`) and use that exact value. Mismatch = chunks invisible to filtered searches. E.g. game8-puzzles must be `"puzzle"` not `"mechanic"` because puzzle queries filter by `content_type = 'puzzle'`.

## RAG: Threshold Sensitivity — It Doesn't Matter Much

- **Threshold (0.10–0.35) is rarely the retrieval bottleneck**: Per-category sensitivity sweep across all failing questions showed that questions either find their answer at ALL thresholds or at NONE. Tuning threshold does not recover missing answers — if the content isn't returned at 0.25 (production value), lowering to 0.10 won't help either (and may cause Supabase timeouts on large categories like `item`).
- **Supabase statement timeouts at threshold=0.10 with item filter**: The `item` content_type has the most chunks (~12k+). At threshold=0.10, too many rows pass the similarity check and the query times out. Keep minimum threshold at 0.15 for item queries; 0.25 (current production) is safe for all categories.
- **Real bottlenecks in order of impact**: (1) stale cached no-info responses, (2) wrong content_type classifier routing, (3) true content gaps. Threshold tuning is rarely #1.
- **Diagnosis script**: `scripts/test-sensitivity-by-category.ts` — queries Supabase + Voyage AI directly (bypasses HTTP API) with a threshold sweep and matchCount sweep per question. Shows whether each question's answer is in the DB at all, and at what rank. Useful after major content changes.

## RAG: Cache Poisoning from Stale Responses

- **7-day cache causes stale "no info" responses after content ingestion**: When new content is added to the KB (e.g. game8 puzzle solutions), queries that were cached before with "I don't have info" responses will keep returning stale answers for up to 7 days. After any major content ingestion, run `DELETE FROM queries WHERE response ILIKE '%don''t have specific%' OR response ILIKE '%no information%' ...` to wipe stale negative-cache entries.
- **Don't cache "no info" responses** ✅ IMPLEMENTED: `isMissingOrDefaultResponse(text)` in `route.ts` detects no-info/content-gap answers via regex before the cache insert. If matched, the query is logged with `response: null` (so rate limiting still counts it) but the cache lookup only returns rows where `response IS NOT NULL`, so the null row is never served. Patterns detected: "I don't have information", "not in the provided context", "context doesn't contain/mention/cover", "I can't find information", "no relevant information available/found/provided", plus fallback text like "couldn't generate an answer".
- **Cache is exact-match on question string**: "where is the white lion necklace" and "where to find darkbringer sword?" are different cache keys. Test suites that vary question phrasing will bypass cache and generate fresh (and potentially failing) responses.

## RAG: URL-Match Keyword Boost

- **When the user names a page, that page should dominate**: The URL-match boost finds chunks whose `source_url` contains a multi-word proper noun from the question (e.g. "Azure Moon Labyrinth" → `ilike %Azure+Moon+Labyrinth%`). Baseline similarity for URL matches must be high enough to beat typical filtered-vector scores on unrelated-but-semantically-near pages. Previous values (0.55 baseline + 0.15 rerank boost = 0.70 final) lost to 0.78–0.90 filtered vector results about wrong pages. Bumped to 0.88 baseline + 0.25 rerank = 1.13 final — URL matches now reliably win.
- **Possessive apostrophes break naive multi-word regexes**: `/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g` fails on "Saint's Necklace" because `'s` isn't `\s+[A-Z]`. Fix: `/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g`. This single character blocked all URL-match boosts for possessive-form item/boss names. Very easy to miss because vector search still returns *something*, just the wrong thing (Crossroads Necklace instead of Saint's Necklace).
- **URL encoding for Fextralife wiki**: spaces become `+`, but apostrophes stay literal (`/Saint's+Necklace`). The `ilike` pattern has to preserve the apostrophe verbatim.
- **All-lowercase questions get zero boost keywords if you filter by uppercase-first**: The original `boostKeywords` filter kept only words starting with a capital letter (to find proper nouns). A question like "how to do feather of the earth challenge" has no capital letters → zero boost terms → falls back to pure vector search → wrong page wins. Fix: replace the uppercase-first filter with a stop-word Set. Any word >3 chars not in the stop list is a boost candidate, regardless of case.
- **Strip question boilerplate to extract the core topic name**: After removing stop words, also strip common question prefixes ("how to do/get/find/complete", "where is", "what is") and topic suffixes ("challenge", "quest", "boss", "fight", "location") from the raw question string. The remaining phrase ("feather of the earth") is the actual page name and can be used for URL-match `ilike` lookup. Without this stripping, the full phrase "how to do feather of the earth challenge" doesn't match the URL `/Feather+of+the+Earth`.
- **Single-word URL terms are too broad**: "necklace" (8 chars) qualifies as a URL match term but matches every necklace page (`limit(10)` may return 10 wrong-necklace chunks with no White Lion Necklace in sight). Fix: when multi-word phrases are available, use ONLY those for URL matching — skip single words. Multi-word phrases like "white+lion+necklace" target exactly the right page.
- **Keyword boost must respect content_type filter**: The URL-match and content-ILIKE boost queries were previously unfiltered — they added any chunk whose URL/content matched boost terms, regardless of content type. When a `content_type_filter` is active (e.g. "puzzle"), adding fextralife exploration chunks at synthetic sim=0.88 causes them to outscore correct game8 puzzle chunks at real sim=0.67. Fix: apply `eq("content_type", contentTypeFilter)` to both URL and content boost queries when the filter is set.
- **Build queries need cross-type search**: "Best build for X" requires equipment data (content_type="item"/"character") for stats AND guide content (content_type="mechanic"). Using mechanic-only filter misses weapons/accessories with critical rate/attack stats. Fix: add a BUILD classifier at the top that returns `null` (no filter) for any query containing "best build", "build for", etc., ensuring cross-type retrieval.
- **TypeScript: `RegExpMatchArray` is not assignable to `string[]` for push**: `const x = str.match(/regex/g) || []` infers `x` as `RegExpMatchArray | never[]`, which TS narrows to `RegExpMatchArray`. That type has a readonly-like push signature of `(item: never) => number` — pushing any string causes a type error. Fix: explicitly annotate: `const x: string[] = str.match(/regex/g) || [];`

## RAG: Action Verb Contamination in Keyword Boost

- **Bare action verbs at the start of a question contaminate multi-word phrase extraction**: "find tauria curved sword" → `cleanedForPhrase` = "find tauria curved sword" → URL boost term = `find+tauria+curved+sword` → `ilike %find+tauria+curved+sword%` → no match against `/Tauria+Curved+Sword`. The same query capitalised ("Tauria curved sword") worked because no prefix verb was present.
- **Two-part fix**: (1) Add action verbs (`find`, `locate`, `get`, `buy`, `farm`, `obtain`, `craft`, `make`, `use`, `equip`, `upgrade`, `unlock`, `show`, `tell`, `give`) to `boostStopWords` so they're filtered from keyword lists. (2) Add a `.replace(/^(find|locate|get|buy|...)\ s+/i, "")` step to `cleanedForPhrase` so the verb is stripped before multi-word phrase extraction.
- **Order of replacements in `cleanedForPhrase` matters**: Strip compound question prefixes ("how to find", "where is") first, then bare action verbs, then articles ("the", "a", "an"). This ensures "how to upgrade tauria sword" correctly strips "how to" then "upgrade" in sequence → "tauria sword".
- **Action verbs survive `boostKeywords` length filter without stop-word coverage**: "find" is 4 chars (passes `> 3`) and was not in the original stop-word set — so it appeared in boost keyword lists AND in URL match terms.

## Rate Limiting Design

- **Daily cap is critical for cost protection at flat-rate pricing**: Per-minute and per-hour limits prevent burst abuse but don't stop a determined user from consistently querying 60/hr × 8hrs = 480 queries/day. At ~$0.004/query, one power user on a $4.99/mo plan costs ~$1.92/day = $57.60/month. A daily cap (free: 30, premium: 200) prevents this while still feeling unlimited to normal players.
- **Show upgrade CTA immediately when a free user hits a limit**: The rate-limit error message is the highest-intent conversion moment — the user just hit a wall and is still engaged. Add `showUpgradeCTA: userTier === "free"` to the JSON response and render `<UpgradeCTA rateLimitHit />` directly below the error bubble. Use different copy from the mid-conversation CTA ("You've reached your free limit" vs "Enjoying the guide?").
- **Three-tier check (min/hr/day) can run in a single `Promise.all`**: All three window checks are independent Supabase count queries — run them in parallel. The day check adds one DB round-trip but no sequential latency.
- **Flag rate-limited responses in the Message type**: Add `showUpgradeCTA?: boolean` to the `Message` interface. The API sets this flag; the frontend reads it to conditionally render the CTA. Keeps the UI logic clean — the CTA knows why it's appearing and can show contextual copy.

## Admin Dashboard: Abuse Detection

- **Group by IP in JS, not SQL, for the admin dashboard**: Supabase JS client doesn't support `GROUP BY` in select queries. Fetch `client_ip` for the time window (`select("client_ip").gte("created_at", oneDayAgo)`) and aggregate in a `Record<string, number>` map. Fast enough for thousands of rows; avoids needing an RPC function.
- **Use the free daily limit as the abuse threshold**: Flagging IPs at `count > 30` (the free tier daily cap) surfaces users who are over-quota without rate limiting being enabled yet, and distinguishes them from normal premium usage. When rate limiting goes live, this table becomes a way to confirm it's working.
- **Rolling rate averages reveal traffic patterns**: `avg/min = queriesLastHour / 60`, `avg/hr = queriesLast24h / 24`, `avg/day = last7dTotal / 7`. These three numbers together show whether traffic is growing, what the sustained load is, and whether a spike is an outlier or a new baseline. More useful for operational awareness than point-in-time totals.
- **Reuse existing fetches for derived metrics**: The IP fetch for abuse detection (`select("client_ip").gte(oneDayAgo)`) has `.data.length` equal to the 24h query count — no need for a separate count query. Similarly, `last7DaysRes.data.length` gives the 7d total without an extra DB call.

## Next.js 16 + Node 24

- **`.env.local` not loading in API routes**: Next.js 16 running on Node 24 had issues where `process.env` didn't pick up `.env.local` values in server-side route handlers. Workaround: built a manual `loadEnv()` function in `route.ts` that reads and parses the file directly. The function checks `process.env.VERCEL` to skip file reads in production (where Vercel injects env vars natively).

## Supabase + pgvector

- **`match_knowledge_chunks` RPC**: This is a custom Postgres function that must exist in Supabase for vector search to work. It takes `query_embedding` (vector), `match_threshold` (float), and `match_count` (int). Make sure the function is created in the Supabase SQL editor before testing vector search.
- **Embedding dimensions**: Voyage AI `voyage-3.5-lite` produces embeddings of a specific dimension. The `embedding` column in `knowledge_chunks` must match this dimension. If switching embedding models, the column and all existing embeddings need to be regenerated.
- **CRITICAL — RPC parameter must be `vector(1024)` not `vector`**: If the `query_embedding` parameter is declared as untyped `vector` (no dimension), PostgREST's JSON→vector cast corrupts `input_type: "query"` embeddings from Voyage AI. The cosine similarity computation breaks silently — correct chunks score near-zero and wrong chunks float to the top. Fix: declare the parameter as `vector(1024)` to match the column type.
- **Passing `match_threshold: 0.0` via supabase-js may use the DEFAULT instead**: When `0.0` is serialized as JSON `0`, PostgREST may treat it as falsy/absent and fall back to the function's DEFAULT threshold. Use an explicit non-zero value or test with negative thresholds to verify the parameter is being received.

## RAG: Debugging Embedding Similarity

- **Always use the same model when manually testing similarity**: When debugging why vector search returns wrong results, use the production model (`voyage-3.5-lite`) to generate the test query embedding. Using a different model (`voyage-3-large`) produces near-zero cosine similarity against stored `voyage-3.5-lite` embeddings — making it look like all chunks are irrelevant when they're actually correct. This is extremely confusing. Double-check: look at `generateEmbeddings()` in ingest-from-cache.ts to see the stored model, and `route.ts` for the query model. They must match.
- **Similarity scores for good matches**: With `voyage-3.5-lite` and correct input types, expect sim=0.60–0.70 for highly relevant game guide chunks, 0.40–0.55 for related but not exact matches, and 0.25–0.40 for borderline relevant chunks. Scores below 0.25 usually indicate wrong content type or poor content quality.

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
- **2-phase crawl+ingest pipeline (added 2026-04-09)**: Split the monolithic crawl→chunk→embed→upsert script into two separate scripts to avoid unnecessary re-crawling:
  - `scripts/crawl-wiki.ts` — fetches Fextralife wiki pages, saves extracted text + metadata to `wiki-cache/pages/{category}/{slug}.json` with a `manifest.json` index. Supports `--deep`, `--changed-only`, `--category`, `--dry-run`.
  - `scripts/ingest-from-cache.ts` — reads from `wiki-cache/`, chunks, embeds via Voyage AI, upserts to Supabase. Maintains `wiki-cache/ingest-state.json` to track what's been embedded. Supports `--changed-only` (re-embeds only pages whose cached content hash changed since last ingest).
  - **When to re-crawl**: Only when wiki content changes. Use `crawl-wiki.ts --changed-only` to fetch only updated pages.
  - **When to skip re-crawling**: Changing chunking logic, fixing extraction, or adjusting metadata — just run `ingest-from-cache.ts` directly from the existing cache (no wiki hits, no 800ms/page wait).
  - `wiki-cache/` is gitignored. Re-populate with a full crawl if it gets deleted.
  - Workflow: `crawl-wiki.ts` (once, or on wiki updates) → `ingest-from-cache.ts` (anytime after)

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

## Next.js App Router: Favicon & Icons

- **Drop files in `src/app/` to auto-serve icons**: Next.js App Router uses file-based icon conventions. `src/app/icon.png` → browser favicon, `src/app/apple-icon.png` → Apple touch icon, `src/app/icon-192.png` → high-res PWA icon. No `<link>` tags needed — Next.js injects them into `<head>` automatically. Routes show up as `○ /icon.png` in the build output confirming they're serving.
- **Use Sharp to generate icons from a source image**: Sharp is already a Next.js dependency (used for image optimization). Run it directly in Node: `sharp(src).resize(32, 32).png().toFile('./src/app/icon.png')`. No extra packages needed.
- **Transparent background webp/png works best for logos on dark themes**: The shield logo has a transparent background which renders cleanly on the dark header without needing a box or background treatment.

## Supabase: Vector Index Sizing

- **IVFFlat `lists` must scale with row count**: Formula is `sqrt(n_rows)` for datasets under 1M rows. At 94k rows, correct value is ~307. The original `lists=100` was set when the DB had ~17k rows and was never updated. With 100 lists and 94k vectors, each bucket holds ~940 vectors — oversized buckets cause more data to be scanned per query, increasing IO.
- **Vector index size can exceed compute RAM and cause IO alerts**: The IVFFlat index on 94k × 1024-dimension vectors is ~956 MB. On Supabase starter compute (1 GB RAM), this barely fits and any competing memory use causes the index to be paged to disk. Every similarity search then requires disk reads → IO alert. Fix: upgrade compute so index fits in RAM, AND rebuild index with correct `lists` value.
- **Rebuilding IVFFlat requires a brief table lock**: `DROP INDEX` then `CREATE INDEX USING ivfflat` takes the full table lock while building. Schedule during low-traffic window. For 94k rows the rebuild is fast (seconds to low minutes).
- **Index size dominates DB storage for vector tables**: `knowledge_chunks` has 76 MB of table data but 963 MB of indexes (956 MB vector + 7 MB btree). Total = 1,564 MB. When estimating DB storage, the vector index is typically 10–15× the raw table size.

## Supabase: RLS Performance

- **`auth.uid()` in RLS policies re-evaluates per row by default**: Postgres evaluates RLS policy expressions for every row scanned unless the expression is wrapped in a subquery. `auth.uid()` is a function call that hits the session context each time. At scale this becomes significant. Fix: replace `auth.uid()` with `(select auth.uid())` — the subquery form is evaluated once per query and the result is reused.
- **Supabase's advisor tool catches this**: The `auth_rls_initplan` lint fires on any policy using bare `auth.uid()` or `auth.role()`. Run the performance advisor after any schema change.

## Debugging Vercel Deployments

- **A broken deployment stays silently broken until you check logs**: Vercel shows `ERROR` state in the dashboard, but the git push doesn't fail and there's no email by default. After wiring a new repo, always verify the first deployment succeeded by checking the Vercel dashboard or using the MCP `get_deployment_build_logs` tool.
- **TypeScript errors that pass locally can fail on Vercel if tsconfig differs**: Vercel runs `next build` which includes a full TypeScript check. Locally, `next dev` skips strict type checking. Always run `npx tsc --noEmit` locally before pushing to confirm the build is clean.
- **`live: false` on a Vercel project means no successful production deployment has landed**: The project exists but has never successfully deployed, or all deployments are in ERROR state. Normal healthy projects show `live: true` with a valid `latestDeployment.readyState: "READY"`.

## Deployment

- **Vercel Hobby plan**: Does not support git-triggered deploys from collaborators. The git author's email must match the Vercel account owner. Fix: deploy via CLI (`npx vercel --prod`) instead of git integration.
- **Node.js 24.x breaks Vercel builds**: Next.js 16 doesn't support Node 24 yet. Set Node.js version to 20.x in Vercel Settings → General.
- **Vercel project config can break when changing git connections**: Disconnecting/reconnecting a git repo can corrupt project settings, causing 0ms build failures with no error message. Fix: redeploy a known-good deployment from the dashboard, then use CLI deploys going forward.
- **`.env.local` manual loader**: The `loadEnv()` function in the API route checks `process.env.VERCEL` to skip file-based env loading in production — Vercel provides env vars directly via `process.env`.
