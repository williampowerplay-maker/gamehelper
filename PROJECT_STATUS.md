# Crimson Desert Guide - Project Status

**Last updated:** 2026-04-02 (session 3)

## Overview

AI-powered game companion for Crimson Desert. Players ask questions about quests, puzzles, bosses, items, and mechanics, and get answers filtered through a spoiler-tier system (Nudge / Guide / Full Solution).

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.1 |
| Frontend | React + TypeScript | 19.2.4 / 6.0.2 |
| Styling | Tailwind CSS 4 + PostCSS | 4.2.2 |
| Database | Supabase (Postgres + pgvector) | supabase-js 2.100.0 |
| AI (Answers) | Claude Sonnet (Anthropic API) | claude-sonnet-4-20250514 |
| AI (Embeddings) | Voyage AI | voyage-3.5-lite |
| Auth | Supabase Auth (Email + Google OAuth) | via supabase-js |
| Deployment | Vercel | - |

## Current Status: MVP Functional

The app runs locally and has a working RAG pipeline, but needs content seeding and production polish.

### What's Built and Working

- [x] **Chat UI** - Dark-themed chat interface with message bubbles, loading animation, sample starter questions
- [x] **Spoiler Tier System** - Three tiers (Nudge/Guide/Full) with distinct system prompts controlling response detail level
- [x] **RAG Pipeline** (`/api/chat/route.ts`)
  - Voyage AI embedding of user question (`input_type: "document"` — see LEARNINGS.md)
  - Supabase pgvector similarity search (`match_knowledge_chunks` RPC, threshold 0.5, count varies by tier)
  - Text-search fallback with keyword ranking when vector search returns no results
  - Relevance threshold checks (similarity > 0.5 for vector, >= 2 keyword matches for text)
  - **Response caching**: checks `queries` table for identical question+tier in last 7 days before calling any AI API
  - **Per-tier Claude config**: Nudge→Haiku (150 tok, 3 chunks), Guide→Sonnet (600 tok, 6 chunks), Full→Sonnet (1024 tok, 8 chunks)
  - **Single Supabase client** per request (was two separate clients)
  - **Bug fixed**: `match_knowledge_chunks` parameter changed from `vector` to `vector(1024)` — untyped vector caused silent corruption of query embeddings through PostgREST
- [x] **Auth System** - Email/password + Google OAuth via Supabase Auth, with AuthProvider context
- [x] **User Tiers** - Free/Premium tier tracking with daily query counter and reset logic
- [x] **Signup Cap + Waitlist** - Limits signups to 100 users (configurable via `NEXT_PUBLIC_MAX_USERS`). When full, shows waitlist email form. Waitlist table in Supabase.
- [x] **Rate Limiting** - IP-based, server-side. Free: 5/min, 20/hr. Premium: 10/min, 60/hr. Returns friendly messages shown inline in chat.
- [x] **Google AdSense Integration** - Banner ads after every 3rd response, desktop sidebar ad (300x250), upgrade CTA every 5th response. Premium users see zero ads. Requires AdSense account setup (see TODO_MANUAL.md).
- [x] **Query Logging** - All queries logged to `queries` table with client_ip (async, non-blocking)
- [x] **Voice I/O** - Speech-to-text input (Web Speech API) + text-to-speech playback on responses
- [x] **Demo Mode** - Placeholder responses when API keys aren't configured
- [x] **Snarky Fallbacks** - Random humorous responses when no relevant context is found
- [x] **Source Attribution** - Links to source content shown below AI answers

### What's NOT Built Yet

- [x] ~~**Knowledge Base Seeding**~~ - 1,690 chunks ingested from Fextralife wiki (2026-04-01)
- [x] ~~**Content Ingestion Pipeline**~~ - `scripts/ingest-fextralife.ts` crawls wiki, chunks, embeds, upserts
- [ ] **Streaming Responses** - Currently waits for full Claude response; no SSE/streaming
- [ ] **Conversation History** - Each question is standalone; no multi-turn context
- [ ] **Mobile Optimization** - Basic responsive layout but not fully tested/polished
- [ ] **Error Boundaries** - No React error boundaries for graceful failure
- [x] **Analytics Dashboard** - `/admin` page with password gate, overview stats, 7-day chart, tier usage, knowledge base breakdown, recent query log
- [ ] **Content Management** - No admin interface for managing knowledge chunks
- [ ] **Payment Integration** - Premium tier exists in schema but no Stripe/payment flow

### Manual Setup Required

See **[TODO_MANUAL.md](TODO_MANUAL.md)** for a checklist of accounts, keys, and configs needed (AdSense, Stripe, Google OAuth, domain, content seeding, legal pages).

## Supabase Schema

### Tables
- **`knowledge_chunks`** - Game content with vector embeddings (id, content, embedding, source_url, source_type, chapter, region, quest_name, content_type, character, spoiler_level)
- **`queries`** - Query log (question, response, spoiler_tier, chunk_ids_used, tokens_used, client_ip)
- **`users`** - User profiles (tier, queries_today, queries_today_reset_at)
- **`waitlist`** - Email waitlist for when signups are at capacity (id, email unique, created_at)

### RPC Functions
- **`match_knowledge_chunks`** - pgvector similarity search (query_embedding, match_threshold, match_count)

### Content Types
`puzzle | boss | item | mechanic | recipe | exploration | quest | character`

## File Structure

```
crimson-guide/
  src/
    app/
      page.tsx              # Main chat page
      layout.tsx            # Root layout with AuthProvider
      globals.css           # Tailwind + custom CSS variables + animations
      api/chat/route.ts     # RAG pipeline API endpoint
      auth/callback/route.ts # Supabase OAuth callback
    components/
      ChatInput.tsx         # Text input + voice input (mic button)
      ChatMessage.tsx       # Message bubble with tier badge, sources, TTS
      SpoilerTierSelector.tsx # Nudge/Guide/Full toggle
      AuthButton.tsx        # Sign in modal (email + Google OAuth) + waitlist
      AdBanner.tsx          # Google AdSense ad unit component
      UpgradeCTA.tsx        # Premium upgrade prompt (shown between responses)
    lib/
      supabase.ts           # Supabase client + TypeScript types
      auth-context.tsx      # React context for auth state
    types/
      speech.d.ts           # Web Speech API type declarations
  next.config.ts            # Env vars passthrough
  tsconfig.json
  postcss.config.mjs
  package.json
  .gitignore
  .env.local                # API keys (not committed)
```

## Environment Variables Required

```
# Required
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
ANTHROPIC_API_KEY=<your-claude-api-key>
VOYAGE_API_KEY=<your-voyage-ai-key>

# Optional (features activate when set)
NEXT_PUBLIC_MAX_USERS=100
NEXT_PUBLIC_ADSENSE_ID=ca-pub-XXXXXXXXXX
NEXT_PUBLIC_AD_SLOT_BANNER=<slot-id>
NEXT_PUBLIC_AD_SLOT_SIDEBAR=<slot-id>
ADMIN_SECRET=<your-admin-password>   # Protects /admin dashboard
```
