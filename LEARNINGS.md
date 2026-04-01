# Learnings & Notes

Things discovered during development that are worth remembering across sessions.

---

## Next.js 16 + Node 24

- **`.env.local` not loading in API routes**: Next.js 16 running on Node 24 had issues where `process.env` didn't pick up `.env.local` values in server-side route handlers. Workaround: built a manual `loadEnv()` function in `route.ts` that reads and parses the file directly. The function checks `process.env.VERCEL` to skip file reads in production (where Vercel injects env vars natively).

## Supabase + pgvector

- **`match_knowledge_chunks` RPC**: This is a custom Postgres function that must exist in Supabase for vector search to work. It takes `query_embedding` (vector), `match_threshold` (float), and `match_count` (int). Make sure the function is created in the Supabase SQL editor before testing vector search.
- **Embedding dimensions**: Voyage AI `voyage-3.5-lite` produces embeddings of a specific dimension. The `embedding` column in `knowledge_chunks` must match this dimension. If switching embedding models, the column and all existing embeddings need to be regenerated.

## Voyage AI

- **Model choice**: Using `voyage-3.5-lite` for embeddings. It's the lightweight model — good balance of cost and quality for a game guide use case. The `input_type: "query"` parameter should be set when embedding user questions (vs `"document"` when embedding knowledge chunks).

## Spoiler Tier Prompt Engineering

- **Per-category examples are essential**: The nudge tier prompt needed explicit good/bad examples for each question type (puzzles, items, bosses, mechanics). Without these, the model would sometimes give full answers even when set to "nudge" mode.
- **Snarky no-info responses**: When the knowledge base has no relevant info, the system returns a random snarky response instead of calling Claude at all. This saves API costs and gives personality. The check happens before the Claude call — if relevance thresholds aren't met, we short-circuit.

## RAG Pipeline Design

- **Dual search strategy**: Vector search is primary, text search is fallback. This handles cases where embeddings miss something that simple keyword matching would catch.
- **Relevance gating**: Without the threshold checks (similarity > 0.3 for vector, >= 2 keywords for text), Claude would confidently hallucinate answers from tangentially related chunks. The gating forces a "I don't know" response when context quality is low.
- **Keyword extraction**: Stop words list includes game-generic terms ("crimson", "desert") that would match everything and dilute search quality.

## Auth

- **Daily query reset**: The `queries_today_reset_at` field stores a date string. On each login, if the stored date doesn't match today, the counter resets to 0. This avoids needing a cron job.
- **User profile creation**: Currently relies on Supabase triggers or first-sign-in logic to create the user row. Need to verify the trigger exists in the DB.

## Voice Features

- **Browser compatibility**: Web Speech API (SpeechRecognition) only works reliably in Chrome and Edge. Firefox has partial support. Safari is inconsistent. The app shows an alert for unsupported browsers.
- **Type declarations**: Needed a custom `speech.d.ts` for TypeScript to recognize `webkitSpeechRecognition` and related types.

## Deployment

- **Vercel**: The app is configured for Vercel deployment. `next.config.ts` passes through `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` via the `env` config. On Vercel, set these in the project's environment variables dashboard.
- **`.env.local` manual loader**: The `loadEnv()` function in the API route checks `process.env.VERCEL` to skip file-based env loading in production — Vercel provides env vars directly via `process.env`.
