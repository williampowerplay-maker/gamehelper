# Crimson Desert Guide - Project Status

**Last updated:** 2026-04-14 (session 14)

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

## Current Status: MVP Functional + Security Hardened

### Session 14 — Game8 Full Ingest + Cache Fix (2026-04-14)
- **647 game8.co pages ingested** across 14 categories — puzzles (1,221 chunks), bosses (347 chunks), walkthrough, guides, weapons, armor, accessories, abyss, skills, crafting, items, locations, characters, challenges
- **Darkbringer Location content gap resolved** — `game8-accessories` category contained the Darkbringer Location page, now ingested
- **Cache no-store fix**: Added `isMissingOrDefaultResponse()` to `route.ts` — Claude "no info" responses are now logged with `response: null` so they're never served from cache. Previous behaviour caused stale "no info" answers to persist 7 days post-ingest.
- **All work moved to `gamehelper` project** — this is now the canonical project going forward

### Session 13 Retrieval Fixes (2026-04-14)
- **RAG pass rate**: **13/15 (87%)** on 15-query test battery, up from 6/15 (40%) at session start
- **Stale cache cleared**: 14 "no info" cache entries removed after game8 content was already in DB
- **Keyword boost breadth fix**: Multi-word URL terms only (not single words) — prevents "necklace" from matching every necklace page
- **Content_type filter applied to keyword boost**: URL-match and content-ILIKE boost queries now respect the active content_type filter — prevents fextralife exploration chunks outscoring game8 puzzle chunks
- **Build classifier added**: "Best build for X" now uses null filter for cross-type search (equipment stats in item/character + guides in mechanic)
- Remaining 2 failures: generic boss strategy query (no summary content), darkbringer sword (content gap)

### Session 12 Security Fixes (2026-04-13)
- **API key exposure patched**: Removed ANTHROPIC/VOYAGE keys from `next.config.ts` `env` block (were being bundled client-side)
- **Security headers added**: X-Frame-Options, HSTS 2yr, nosniff, Referrer-Policy, Permissions-Policy
- **Rate limit tier bypass fixed**: Was using client-controlled `spoilerTier` body param to determine limits; now hardcoded to free tier for all unauthenticated requests
- **Input guard**: Questions capped at 500 chars
- **Admin auth**: `crypto.timingSafeEqual()` + failed-attempt throttle (5 fails / 15 min / IP)
- **Supabase RLS**: Fixed silent error logging failure; restricted knowledge_chunks writes to service_role; tightened queries SELECT; locked page_hashes to service_role
- **Ingest scripts**: Now use `SUPABASE_SERVICE_ROLE_KEY` (add to .env.local from Supabase dashboard → Settings → API)
- **RAG pass rate**: 10/12 (83%) on Reddit-style test queries (was 3/10 = 30% at session start)

## Current Status: MVP Functional

The app runs locally and has a working RAG pipeline, but needs content seeding and production polish.

### What's Built and Working

- [x] **Chat UI** - Dark-themed chat interface with message bubbles, loading animation, sample starter questions
- [x] **Spoiler Tier System** - **Two tiers** (Nudge / Solution) with distinct system prompts. Collapsed from 3 tiers in v0.6.0 — the old middle "Guide" tier was indistinguishable from "Full" in practice. Default tier is `nudge` (cheapest, preserves discovery). Legacy `guide` values in DB are folded into `full` at read time.
- [x] **RAG metadata pre-filtering** — `classifyContentType()` classifier narrows vector search to matching content_type (boss/item/quest/exploration/mechanic/recipe/character). Auto-fallback to unfiltered search if 0 results. `match_knowledge_chunks` RPC updated with optional `content_type_filter TEXT DEFAULT NULL` param.
- [x] **Chunk splitting & overlap** — `chunkPageContent()` now splits sections >800 chars into ~500-char sub-chunks with 150-char intra-section overlap and 120-char inter-section overlap prefix. Fixes item chunks that averaged 666 chars (303 over 1500). **Existing ingested chunks pre-date this change — re-ingest needed to apply to all categories.**
- [x] **RAG Pipeline** (`/api/chat/route.ts`)
  - Voyage AI embedding of user question (`input_type: "query"` for searches, `"document"` for ingestion)
  - Supabase pgvector similarity search (`match_knowledge_chunks` RPC, threshold 0.5, count varies by tier)
  - Text-search fallback with keyword ranking when vector search returns no results
  - Relevance threshold checks (similarity > 0.5 for vector, >= 2 keyword matches for text)
  - **Response caching**: checks `queries` table for identical question+tier in last 7 days before calling any AI API
  - **Per-tier Claude config**: Nudge→Haiku (100 tok, 2 chunks), Full/Solution→Sonnet (1024 tok, 8 chunks)
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
- [x] ~~**Content Ingestion Pipeline**~~ - `scripts/ingest-fextralife.ts` crawls wiki, chunks, embeds, upserts. **v2**: Added abyss-gear, npcs, collectibles, key-items, accessories categories; 2-level BFS crawl via `--deep`; idempotent re-runs via delete-before-insert. **v3**: `--changed-only` flag skips unchanged pages via SHA256 content hashing; CI-safe env loading. **v4**: Chunk splitting + overlap (500-char target, 150-char intra overlap, 120-char inter-section overlap). **v5 (2026-04-09)**: Split into 2-phase pipeline — `crawl-wiki.ts` saves wiki pages to local `wiki-cache/`, `ingest-from-cache.ts` chunks+embeds+upserts from cache. Re-chunking or re-embedding no longer requires re-crawling the site. `ingest-state.json` tracks what's been embedded so `--changed-only` skips already-ingested unchanged pages.
- [x] **Automated Wiki Monitoring** - GitHub Actions workflow runs every Sunday, detects changed wiki pages via `page_hashes` table, re-embeds only what changed. Manual trigger available in GitHub UI.

#### Ingest status (2026-04-10) — session 11
Previous total ~17,345 chunks + 21,276 new chunks from session 11 = **~38,600+ chunks total**.

New categories added in session 11: grappling (1,608), game-progress (3,430), beginner-guides (16,238).

#### Ingest status (2026-04-05) — cleaned + supplemented
Original: 82,312 chunks → deduplicated to 26,343 → nav-list junk removed to 16,816 → supplemented with 529 item location chunks = **~17,345 chunks**.

Cleanup performed in session 9:
- Removed 72,702 duplicates (same source_url + content from multiple ingest runs)
- Removed 9,527 nav-list junk chunks (sidebar `♦ item ♦ item` lists that wasted vector search slots)
- Added 529 "How to Obtain / Where to Find" chunks for items via `scripts/supplement-item-locations.ts`

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
| challenges | ✅ | ~78 |
| grappling | ✅ (1,608 chunks) | 110 |
| game-progress | ✅ (3,430 chunks) | 212 |
| beginner-guides | ✅ (16,238 chunks) | 1,154 |

#### RAG quality baseline (2026-04-04, post-reseed, pre-cleanup)
Ran `scripts/test-rag-quality.ts` (59 tests across 17 categories). **Overall: 42/59 passed (71.2%)**, avg similarity 0.777. Note: this was measured before the session 9 DB cleanup and prompt tuning — actual quality should be significantly better now.

#### Prompt tuning test (2026-04-05, session 9)
10 diverse questions tested via `scripts/prompt-tuning-test.ts` after DB cleanup + classifier fixes:
- 9/10 returned relevant chunks
- 1 fail: "Where do I find the Hwando Sword?" — page doesn't exist on wiki (404)
- Classifier fixes verified: "Focused Shot" → mechanic (was boss), "Greymane Camp" → exploration (was null)

#### Session 11 retrieval fixes (2026-04-10, v0.9.0)
- **Nudge chunk count raised 2→4**: With 38k+ chunks, 2 was too narrow to reliably surface the right content for mechanic/guide queries.
- **Mechanic classifier**: Added `fast travel`, `fast-travel`, `travel point`, `abyss nexus`, `traces of the abyss`.
- **Item classifier**: Added `gold bar`, `gold bars`, `silver`, `currency`; added `best (weapon|armor|gear|build|loadout)` to getItemPhrases.
- **Cache cleared**: 6 stale bad cached responses removed from `queries` table after ingesting new content.
- **Reddit query test (10 queries)**: 3/10 pass before fixes. Boss queries (Lucian Bastier, Reed Devil) and Abyss Artifact queries worked. Grappling, fast travel, gold bars, best armor all failed due to missing content — now addressed.

#### Session 10 retrieval fixes (2026-04-09, v0.8.0)
- **Classifier**: Added `challenge|challenges|mastery|minigame|mini-game` to mechanic regex — challenge questions were returning null classifier (unfiltered search), causing poor retrieval.
- **URL-match boost case-insensitive**: Replaced uppercase-first filter with stop-word filter. Lowercase questions like "how to do feather of the earth challenge" now generate boost keywords correctly.
- **cleanedForPhrase extraction**: Strips question prefixes/suffixes to extract the core topic name for URL-match. "how to do feather of the earth challenge" → extracts "feather of the earth" → URL boost fires against correct page.
- **TypeScript fix**: `quotedNames` explicitly typed as `string[]` to fix Vercel build failure (was inferred as `RegExpMatchArray` → push had type `never`).
- Verified on production: "how to feather of the earth challenge" returns correct Karin Quarry location + Sealed Abyss Artifact + carry 5 birds objective.

#### Starter question retrieval fixes (2026-04-04, session 8, v0.6.1)
All 4 homepage starter questions were debugged and fixed (see CHANGELOG v0.6.1 and `scripts/debug-starters-full-pipeline.ts`):
- Classifier now routes "how do I solve the X Labyrinth" → `exploration` (was `mechanic` via bare `how do` match). Exploration regex moved above mechanic; added labyrinth/ruin/tower/dungeon keywords.
- URL-match boost `quotedNames` regex fixed to handle possessive apostrophes — "Saint's Necklace" now matches as a multi-word term (was silently returning Crossroads Necklace).
- URL-match baseline similarity raised 0.55 → 0.88, rerank boost 0.15 → 0.25. When user explicitly names a page, that page now dominates the top 5.

**DB admin task completed (2026-04-04)**: Dropped the duplicate 3-arg `match_knowledge_chunks` overload via `DROP FUNCTION public.match_knowledge_chunks(vector, double precision, integer);` in Supabase SQL editor. Verified with `pg_proc` query — only the 4-arg version (with `content_type_filter`) remains. The unfiltered-retry path and `null`-classifier path now work cleanly.

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
