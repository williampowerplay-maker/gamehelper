# Crimson Desert Guide - Project Status

**Last updated:** 2026-04-04 (session 8)

## Overview

AI-powered game companion for Crimson Desert. Players ask questions about quests, puzzles, bosses, items, and mechanics, and get answers filtered through a two-tier spoiler system (Nudge / Solution).

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
- [x] **Spoiler Tier System** - **Two tiers** (Nudge / Solution) with distinct system prompts. Collapsed from 3 tiers in v0.6.0 — the old middle "Guide" tier was indistinguishable from "Full" in practice. Default tier is `nudge` (cheapest, preserves discovery). Legacy `guide` values in DB are folded into `full` at read time.
- [x] **RAG metadata pre-filtering** — `classifyContentType()` classifier narrows vector search to matching content_type (boss/item/quest/exploration/mechanic/recipe/character). Auto-fallback to unfiltered search if 0 results. `match_knowledge_chunks` RPC updated with optional `content_type_filter TEXT DEFAULT NULL` param.
- [x] **Chunk splitting & overlap** — `chunkPageContent()` now splits sections >800 chars into ~500-char sub-chunks with 150-char intra-section overlap and 120-char inter-section overlap prefix. Fixes item chunks that averaged 666 chars (303 over 1500). **Existing ingested chunks pre-date this change — re-ingest needed to apply to all categories.**
- [x] **RAG Pipeline** (`/api/chat/route.ts`)
  - Voyage AI embedding of user question (`input_type: "document"` — see LEARNINGS.md)
  - Supabase pgvector similarity search (`match_knowledge_chunks` RPC, threshold 0.5, count varies by tier)
  - Text-search fallback with keyword ranking when vector search returns no results
  - Relevance threshold checks (similarity > 0.5 for vector, >= 2 keyword matches for text)
  - **Response caching**: checks `queries` table for identical question+tier in last 7 days before calling any AI API
  - **Per-tier Claude config**: Nudge→Haiku (150 tok, 3 chunks), Full/Solution→Sonnet (1024 tok, 8 chunks)
  - **No-info fallback scope explainer**: when retrieval returns nothing relevant, the snarky line is followed by a structured "What I'm built for" block with 4 example queries, redirecting users toward the app's strengths (bosses, weapons, skills, NPCs, locations)
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

- [x] ~~**Knowledge Base Seeding**~~ - 6,382+ chunks ingested from Fextralife wiki as of 2026-04-03. Full reseed in progress with `--deep` (2-level BFS). Re-ingest also needed for chunk overlap update.
- [x] ~~**Content Ingestion Pipeline**~~ - `scripts/ingest-fextralife.ts` crawls wiki, chunks, embeds, upserts. **v2**: Added abyss-gear, npcs, collectibles, key-items, accessories categories; 2-level BFS crawl via `--deep`; idempotent re-runs via delete-before-insert. **v3**: `--changed-only` flag skips unchanged pages via SHA256 content hashing; CI-safe env loading. **v4**: Chunk splitting + overlap (500-char target, 150-char intra overlap, 120-char inter-section overlap).
- [x] **Automated Wiki Monitoring** - GitHub Actions workflow runs every Sunday, detects changed wiki pages via `page_hashes` table, re-embeds only what changed. Manual trigger available in GitHub UI.

#### Ingest status (2026-04-04) — full reseed COMPLETE
All 17 categories ingested with the new chunk-overlap format. Total: **82,312 chunks**.

| Category | Chunks (approx) | Pages |
|----------|----------------|-------|
| bosses | ✅ | 47 |
| enemies | ✅ | 7 |
| quests | ✅ | 247 |
| walkthrough | ✅ | 228 |
| weapons | ✅ | 460 |
| armor | ✅ | 243 |
| abyss-gear | ✅ | 166 |
| accessories | ✅ | 75 |
| items | ✅ | 351 |
| collectibles | ✅ | 58 |
| key-items | ✅ | 63 |
| locations | 1677 | 195 |
| characters | 863 | 85 |
| npcs | 1523 | 168 |
| skills | 1365 | 159 |
| crafting | 607 | 36 |
| guides | 2 | — |

Avg chunk length by content_type (all under the 800-char split threshold, confirms overlap format applied): boss 429, quest 280, item 519 (down from pre-overlap 666), exploration 458, mechanic 482, recipe 468, character 299.

#### RAG quality baseline (2026-04-04, post-reseed)
Ran `scripts/test-rag-quality.ts` (59 tests across 17 categories). **Overall: 42/59 passed (71.2%)**, avg similarity 0.777.

Strong (100% pass): bosses, enemies, armor, abyss-gear, accessories, collectibles, locations, characters, npcs.

Weak categories needing attention:
- **items** 25% (3 fail) — "recovery items list", "crafting materials info", "grilled meat / healing items" all return no chunks
- **walkthrough** 33% (2 fail) — "game progress route overview", "main quest order"
- **guides** 33% (6 fail) — mostly "no chunks" for generic guide queries (new player tips, housing, combat tips, grapple, stamina, upgrade/refining). Note: `guides` only has 2 chunks — the category is essentially empty
- **key-items** 50% (1 fail), **crafting** 50% (1 fail), **quests** 60% (2 fail)
- **weapons** 80%, **skills** 80% (1 fail each)

**Action items**: (1) `guides` category returned only 2 chunks — ingest crawler isn't finding guide pages; needs investigation. (2) `items` failures are around generic category queries that don't match specific item pages — may need a "category overview" synthesized chunk. (3) Most "weapons/skills" passes came via URL-match boost rather than pure semantic sim.

#### Starter question retrieval fixes (2026-04-04, session 8, v0.6.1)
All 4 homepage starter questions were debugged and fixed (see CHANGELOG v0.6.1 and `scripts/debug-starters-full-pipeline.ts`):
- Classifier now routes "how do I solve the X Labyrinth" → `exploration` (was `mechanic` via bare `how do` match). Exploration regex moved above mechanic; added labyrinth/ruin/tower/dungeon keywords.
- URL-match boost `quotedNames` regex fixed to handle possessive apostrophes — "Saint's Necklace" now matches as a multi-word term (was silently returning Crossroads Necklace).
- URL-match baseline similarity raised 0.55 → 0.88, rerank boost 0.15 → 0.25. When user explicitly names a page, that page now dominates the top 5.

**DB admin task still open**: `DROP FUNCTION public.match_knowledge_chunks(vector(1024), float, int);` needs to be run in Supabase SQL editor — the old 3-arg version coexists with the 4-arg version and breaks the unfiltered-retry path plus any question where the classifier returns `null`. See CHANGELOG v0.6.1 Known Issue.

- [ ] **Streaming Responses** - Currently waits for full Claude response; no SSE/streaming
- [ ] **Conversation History** - Each question is standalone; no multi-turn context
- [x] **Mobile Optimization (partial)** - Input field always above fold on mobile: `h-[100dvh]`, tighter header padding, subtitle hidden on mobile, `overflow:hidden` on body. Full polish (message bubbles, touch targets) still TODO.
- [x] **Error Boundaries & Error Dashboard** - `ErrorBoundary` class component wraps root layout. `error.tsx` handles Next.js route-level errors. Both log to `error_logs` Supabase table. Admin dashboard has a full error analysis section: **1h / 24h / 7d time filter**, sparkline bar chart, per-type breakdown cards, expandable rows with stack trace + JSON context.
- [x] **Analytics Dashboard** - `/admin` page with password gate, overview stats, 7-day chart, tier usage, knowledge base breakdown, recent query log. **CSV export buttons** for waitlist emails and all users — download directly from dashboard header.
- [ ] **Content Management** - No admin interface for managing knowledge chunks
- [ ] **Payment Integration** - Premium tier exists in schema but no Stripe/payment flow

## Future Features (Planned)

### UX Enhancements

- [ ] **Quick Boss Mode** - Instead of typing, players select from a boss/quest list and get instant strategy with phases, weaknesses, and recommended gear. One-tap help while holding a controller.
- [ ] **Build Planner / Loadout Recommender** - Interactive gear calculator ("I'm level 25, using a spear, what armor?"). Stat comparisons, save/share builds. Creates community engagement + return visits.
- [ ] **Interactive Map Integration** - Simplified embedded map where users ask "where is X?" and see it pinned. Overlay collectibles, boss locations, quest givers.
- [ ] **Voice-First Mode (Controller-Friendly)** - Dedicated hands-free UI with larger buttons, auto-read responses, minimal scrolling. Killer differentiator vs wikis for players mid-game.

### Community & Retention

- [ ] **Creator/Streamer Partnerships** - Embeddable guide widget for Twitch streams ("Ask the AI guide" overlay). Revenue share on premium signups via referral links.
- [ ] **Tip of the Day Push Notifications** - Daily game tip based on where the user is in the game. Keeps users opening the app between play sessions. Drives ad impressions on free tier.
- [ ] **Community Upvoting on Answers** - Users rate AI responses as helpful/not helpful. Best-rated answers get cached and served faster (saves API costs). Creates feedback loop for quality improvement.

### Manual Setup Required

See **[TODO_MANUAL.md](TODO_MANUAL.md)** for a checklist of accounts, keys, and configs needed (AdSense, Stripe, Google OAuth, domain, content seeding, legal pages).

## Supabase Schema

### Tables
- **`knowledge_chunks`** - Game content with vector embeddings (id, content, embedding, source_url, source_type, chapter, region, quest_name, content_type, character, spoiler_level)
- **`queries`** - Query log (question, response, spoiler_tier, chunk_ids_used, tokens_used, client_ip)
- **`users`** - User profiles (tier, queries_today, queries_today_reset_at)
- **`waitlist`** - Email waitlist for when signups are at capacity (id, email unique, created_at)

### RPC Functions
- **`match_knowledge_chunks`** - pgvector similarity search. Params: `query_embedding vector(1024)`, `match_threshold float DEFAULT 0.5`, `match_count int DEFAULT 8`, `content_type_filter text DEFAULT NULL`. Filter param narrows search to a single content_type when set.

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
