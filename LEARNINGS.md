# Learnings & Notes

Things discovered during development that are worth remembering across sessions.

---

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

## RAG Pipeline Design

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

## Deployment

- **Vercel**: The app is configured for Vercel deployment. `next.config.ts` passes through `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` via the `env` config. On Vercel, set these in the project's environment variables dashboard.
- **`.env.local` manual loader**: The `loadEnv()` function in the API route checks `process.env.VERCEL` to skip file-based env loading in production — Vercel provides env vars directly via `process.env`.
