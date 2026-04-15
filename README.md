# Crimson Desert Guide

AI-powered game guide for Crimson Desert. Players ask questions; the app retrieves relevant wiki content and generates answers using Claude.

## Project Identity

| Thing | Value |
|---|---|
| **Active local folder** | `C:\Users\William Power\Documents\GitHub\gamehelper` |
| **GitHub repo** | `williampowerplay-maker/gamehelper` |
| **Vercel project** | `crimson-guide` |
| **Production URL** | https://crimson-guide.vercel.app |

## Stack

- **Frontend** — Next.js 15 (App Router), Tailwind CSS
- **API** — `/api/chat` route, Claude (Anthropic) for answer generation
- **Embeddings** — Voyage AI (`voyage-3.5-lite`)
- **Vector DB** — Supabase pgvector (`match_knowledge_chunks` RPC)
- **Hosting** — Vercel (auto-deploys from `main` branch of GitHub repo)

## How It Works

1. Player submits a question with a spoiler tier (nudge / hint / solution)
2. Question is embedded via Voyage AI
3. Supabase vector search retrieves relevant wiki chunks (with content-type filtering + re-ranking)
4. Claude generates a spoiler-appropriate answer from the retrieved context
5. Answer is cached in Supabase `queries` table (7-day TTL)

## Dev Setup

```bash
npm install
npm run dev       # http://localhost:3000
```

Required environment variables (`.env.local`):
- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VOYAGE_API_KEY`

## Key Files

```
src/app/api/chat/route.ts     Main RAG pipeline (classifier → retrieval → rerank → Claude)
scripts/                      Ingestion, test, and sensitivity sweep scripts
LEARNINGS.md                  RAG tuning notes and lessons learned
PROJECT_STATUS.md             Session-by-session progress log
CHANGELOG.md                  Version history
LAUNCH_CHECKLIST.md           Pre-launch items (rate limits, auth, etc.)
```

## Testing

```bash
# Full 40-question Reddit-style test (hits production)
npx tsx scripts/test-reddit-questions.ts

# Filter by category
npx tsx scripts/test-reddit-questions.ts --tag boss
npx tsx scripts/test-reddit-questions.ts --tag weapon
npx tsx scripts/test-reddit-questions.ts --tag puzzle

# Hit local dev server instead
npx tsx scripts/test-reddit-questions.ts --local
```

## Pre-Launch Checklist

See `LAUNCH_CHECKLIST.md`. Key items: re-enable rate limiting, wire `userTier` to auth.
