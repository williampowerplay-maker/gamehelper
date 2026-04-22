# Crimson Desert Guide - Project Status

**Last updated:** 2026-04-22 (session 21)

## Overview

AI-powered game companion for Crimson Desert. Players ask questions about quests, puzzles, bosses, items, and mechanics, and get answers filtered through a two-tier spoiler system (Nudge / Solution).

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| GitHub repo | williampowerplay-maker/gamehelper | (renamed from crimson-guide) |
| Framework | Next.js (App Router) | 16.2.1 |
| Frontend | React + TypeScript | 19.2.4 / 6.0.2 |
| Styling | Tailwind CSS 4 + PostCSS | 4.2.2 |
| Database | Supabase (Postgres + pgvector) | supabase-js 2.100.0 |
| AI (Answers) | Claude Sonnet (Anthropic API) | claude-sonnet-4-20250514 |
| AI (Embeddings) | Voyage AI | voyage-3.5-lite |
| Auth | Supabase Auth (Email + Google OAuth) | via supabase-js |
| Deployment | Vercel | - |

## Current Status: MVP Functional + Stripe Integration + Improved RAG

### Session 22 — Admin Polish, Cost Dashboard, Referral Program Design (2026-04-22)

- **Admin dashboard scroll fixed** — `body { overflow: hidden }` in `globals.css` is intentional for the chat UI's locked-scroll. Admin outer div changed to `h-screen overflow-y-auto` so it creates its own scroll context and scrolls independently.

- **Most Active Users Today** section added to admin dashboard — fetches `public.users WHERE queries_today > 0 ORDER BY queries_today DESC LIMIT 10`, cross-references with `supabase.auth.admin.listUsers()` (service role) to resolve emails. Shows rank, email, queries today, tier badge.

- **Full API Cost Breakdown dashboard** (new admin section):
  - `queries.input_tokens` column added (default 0); `route.ts` now stores `claudeData.usage.input_tokens` and captures Voyage `embeddingData.usage.total_tokens`
  - `get_cost_stats()` Postgres function — conditional aggregation across all-time / last-7-days / today without fetching 111K rows into JS
  - Pricing: Haiku $0.80/$4.00 per M input/output, Sonnet $3/$15 per M, Voyage $0.02 per M
  - Input cost falls back to query-count estimates for historical rows (nudge ~1,500 tokens, full ~2,800 tokens)
  - Dashboard shows: 3 time-window cards (all time / 7d / today) with Sonnet/Haiku/Voyage split bars; projected monthly cost; avg cost per query by tier; avg cost per user/day; avg per active user; avg per free vs premium user

- **Referral program — designed, DB deployed, code pending** (see "Planned Features" below):
  - DB migration already applied: `referral_code text NOT NULL UNIQUE` on `users` (auto-generated from first 8 chars of UUID via `trg_set_referral_code` trigger); `referrals` table with `referrer_id`, `referred_id`, `status` ('pending'|'converted'|'rewarded'|'reward_pending'), timestamps; RLS policy (referrers read own rows)
  - All existing users already have `referral_code` values backfilled

### Session 21 — Stripe Integration, RAG Classifier Expansion, game8 Full Ingest (2026-04-22)

- **Admin dashboard fixed** — all three admin routes (`/api/admin/stats`, `/api/admin/export`, `/api/admin/errors`) were using `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is blocked by RLS policies, causing all stats to silently return empty. Fixed by switching to `SUPABASE_SERVICE_ROLE_KEY`. User also added `SUPABASE_SERVICE_ROLE_KEY` to Vercel env vars and redeployed.

- **Stripe subscription integration (code complete, env vars pending)**:
  - `/api/stripe/checkout` — creates Stripe Checkout Session for $4.99/mo (subscription mode). Creates/retrieves Stripe customer, persists `stripe_customer_id`, includes `supabase_user_id` in metadata.
  - `/api/stripe/webhook` — handles `checkout.session.completed` (→ tier=premium), `invoice.payment_succeeded` (keep premium), `customer.subscription.deleted` (→ tier=free, clears subscription ID). Verifies Stripe signature on every request.
  - `/api/stripe/portal` — creates Stripe Billing Portal session so premium users can manage/cancel subscription.
  - `/upgrade` page updated — real Subscribe button for signed-in free users, Manage Billing button for premium users, notify form kept for signed-out visitors only. "Coming Soon" badge removed.
  - `/upgrade/success` — post-payment confirmation page that calls `refreshProfile()` after 2s delay to pick up webhook-updated tier.
  - `AuthButton` updated — premium users see "Billing" link (amber, opens portal); free users see "Upgrade" link (red, goes to /upgrade).
  - `auth-context.tsx` — added `refreshProfile()` function to `AuthState` interface and implementation.
  - Supabase schema — added `stripe_customer_id TEXT` and `stripe_subscription_id TEXT` columns to `users` table, with index on `stripe_customer_id`.
  - **Still needs**: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` added to Vercel env vars + Stripe dashboard product/price/webhook setup.

- **game8 full ingest complete** — 286 game8-guides pages (which contained tier-list / best-of / ranking content) were only 2 entries in the DB before. Now all 660 game8 pages are indexed: **17,798 game8 chunks** from 660 pages across 14 categories (guides, walkthrough, puzzles, bosses, weapons, armor, accessories, items, locations, skills, crafting, characters, challenges, abyss).

- **7 new query classifiers** (34/34 unit tests passing — `scripts/test-classifiers.mjs`):
  1. **Versus/comparison** (`X vs Y`, `better than`, `sword or spear`) → `null` (full search). Previously wrongly filtered to `item` type, missing tier-list/guide content.
  2. **Food/buff/consumable** (`what food before a boss fight`, `best food for combat`) → `null`. Must come **before** boss classifier so food+boss co-occurrence doesn't route to boss.
  3. **Camp/faction system** (`how does camp management work`, `upgrade my camp`) → `mechanic`.
  4. **Mount/pet system** (`how do I get a horse`, `how do mounts work`) → `mechanic`.
  5. **Endgame/NG+** (`after beating the game`, `new game+`, `endgame content`) → `mechanic`.
  6. **List queries** (`list all bosses`, `every weapon in the game`) → `null` + `matchCount = 20` (was 8). Makes catalogue-style queries actually useful.
  7. **Off-topic detection** (`weather forecast`, `who is the president`) → immediate short-circuit, skips Voyage + Claude entirely.

- **RAG recommendation improvements** (from previous session, now with full game8 data):
  - `isRecommendationQuery()` helper boosts `matchCount` by +4 (up to 12) for vague queries like "what are good swords".
  - Recommendation pattern added to classifier (before item classifier) so "best swords" → `null` (full cross-type search) not `item`.

- **DB content as of session 21**: ~111,905 total chunks (93,405 fextralife_wiki + 17,798 game8 + 516 wiki + 186 youtube).

### Session 20 — Cost Optimisations, Upgrade Page, Ad Labels (2026-04-16)

- **Cost optimisations (5 changes)**:
  - **Cache check before Voyage embedding**: Cache lookup now runs before the Voyage AI call — cache hits skip the $0.0001 embedding entirely. `cache_hit boolean` column added to `queries` table; hits log with `cache_hit: true, tokens_used: 0`.
  - **Sonnet token cap reduced**: `maxTokens` 1,024 → 650. Most good answers are 200–400 tokens; saves ~35% Sonnet output cost with minimal quality loss.
  - **Nudge matchCount reduced**: 6 → 4 chunks. Haiku only needs 3–4 for a hint; fewer chunks = fewer input tokens.
  - **Solution tier free daily cap**: 10 solution-tier queries/day for free users — preserved in commented pre-launch block alongside other rate limits.
  - **Nudge system prompt trimmed**: Haiku gets a 1-line base prompt instead of full `BASE_SYSTEM_PROMPT` (~60% fewer input tokens per nudge query).
- **Cache hit rate in admin dashboard**: Stats API computes cache hit % over last 7 days. New "Cache Hit Rate" stat card in overview section shows % and hit count.
- **`/upgrade` placeholder page**: Free vs Premium plan comparison, "Coming Soon" badge, email capture form (stores to `waitlist` table). All upgrade CTAs and the dead "Upgrade — $4.99/mo" buttons now link here.
- **Upgrade button in header**: Signed-in free users now see `[Free] Upgrade Sign out` in the header. Premium users see no upgrade link.
- **Ad banner upgrade prompt**: Every `AdBanner` now shows `Advertisement` label (left) and `Remove ads — Upgrade →` link (right) above the ad unit. Covers both inline chat banner and desktop sidebar.
- **Ad frequency reduced**: Inline banner changed from every 3rd to every 6th assistant response. New pattern: ads on 6, 12, 18… · upgrade CTA on 5, 10, 15…

### Session 19 — Google OAuth Fix, Content Gap Tracking (2026-04-16)

- **Google OAuth redirect fixed**: Supabase Site URL was still set to `localhost` — updated to `https://crimson-guide.vercel.app`. Added `https://crimson-guide.vercel.app/auth/callback` to Supabase redirect URLs. Added Supabase's auth endpoint (`https://tyjyqzojuhnnnmuhobso.supabase.co/auth/v1/callback`) to Google Cloud Console OAuth client. Confirmed new user row created in DB after successful Google login.
- **App URL confirmed**: `https://crimson-guide.vercel.app` (Vercel project name is `crimson-guide`, repo is `gamehelper`). Admin dashboard at `/admin`.
- **Content gap tracking**: Added `content_gap boolean DEFAULT false` column to `queries` table. `route.ts` now sets `content_gap: true` whenever `isMissingOrDefaultResponse()` fires. Admin dashboard shows an "Unanswered Questions" table (last 100) with question text, tier, and timestamp. "↓ Content Gaps CSV" export button added to admin header and section — downloads `question, spoiler_tier, asked_at` for all content gap queries. This creates a live priority list for future knowledge base expansion.
- **User signup cap confirmed working**: 3 users in DB (March 27, April 6, April 16). Waitlist flow confirmed — `signupsClosed` triggers when user count ≥ `NEXT_PUBLIC_MAX_USERS` (default 100).

### Session 18 — Rate Limiting, Keyword Fix, Admin Abuse Detection (2026-04-16)

- **Action verb keyword boost fix**: "find tauria curved sword" was producing URL boost term `find+tauria+curved+sword` instead of `tauria+curved+sword`, missing the wiki page URL match. Added `find/locate/get/buy/farm/obtain/craft/make/use/equip/upgrade/unlock/show/tell/give` to `boostStopWords` and added a matching `.replace()` to `cleanedForPhrase` to strip bare action verbs at the start of questions before phrase extraction.
- **Upgrade CTA on rate limit**: When a free user hits their query limit, the rate-limit error message is now followed by an inline `<UpgradeCTA rateLimitHit />` with targeted copy ("You've reached your free limit") rather than the generic mid-conversation CTA. `showUpgradeCTA: userTier === "free"` added to both rate-limit response paths. `Message` type extended with `showUpgradeCTA?: boolean`.
- **Daily query caps added**: Rate limits now include a per-day cap (free: 30/day, premium: 200/day) to prevent power users from exhausting API cost at $0.003–0.006/query on a $4.99/mo plan. Full limit table: Free = 3/min, 10/hr, 30/day · Premium = 10/min, 60/hr, 200/day. Daily check added to commented rate-limiting block; `oneDayAgo` window added to the Promise.all.
- **Admin: query rate stats**: Stats API now computes rolling averages — avg queries/min (last hr), avg/hr (last 24h), avg/day (last 7d) — plus last-hour and last-24h totals. New "Query Rate" stat card row added to dashboard.
- **Admin: high-volume IP abuse detection**: Stats API groups `client_ip` counts over the last 24h and returns the top 15 IPs. IPs with >30 queries (exceeding the free daily limit) are flagged `suspicious: true`. New "Top IPs — Last 24h" table in admin dashboard highlights outliers in orange with a "High Volume" badge.

### Session 17 — Build Fix, Legal Pages, Logo, Supabase Audit (2026-04-15)

- **Build-breaking TS errors fixed**: `supabase` client and `clientIp` were only defined inside the commented-out rate limiting block — all Supabase calls in the main try block were referencing undefined variables. Added `const supabase = createClient(...)` and `const clientIp = getClientIp(req)` at the top of the POST handler. Also fixed 3 implicit `any` types in text search fallback. Zero TS errors; Vercel deployment unblocked.
- **Vercel deployment confirmed + unblocked**: Vercel was already connected to `williampowerplay-maker/gamehelper` (user had done this) but the latest deployment was in `ERROR` state due to the TS errors above. Fixed build lets Vercel auto-deploy all session 12–16 improvements (95% pass rate, boss classifier, location boost, cache no-store fix) to production for the first time.
- **Repo rename cleanup**: Updated `README.md` (GitHub repo field, removed stale local folder note), `scripts/crawl-wiki.ts` User-Agent string, and `PROJECT_STATUS.md` to reflect the rename from `crimson-guide` → `gamehelper`.
- **Privacy Policy + Terms of Service**: Added `/privacy` and `/terms` as static Next.js pages with dark theme styling. Content covers: data collection (queries, IP, email, OAuth), third-party services (Supabase, Anthropic, Voyage AI, AdSense, Vercel), AI disclaimer, subscription terms, fan-project IP notice. Footer links added to main chat page.
- **Shield AI logo**: Added `GGAi Logo1.webp` to `public/logo.webp`. Generated `src/app/icon.png` (32×32), `src/app/icon-192.png` (192×192), and `src/app/apple-icon.png` (180×180) via Sharp — Next.js App Router auto-serves these as browser favicon and Apple touch icon. Logo shown at 44px in header alongside title text; also replaces the ⚔️ emoji on the empty chat screen at 96px.
- **Supabase health audit**: DB is **1,576 MB** total. `knowledge_chunks` has **94,107 rows** (docs said ~38,600 — corrected). IVFFlat vector index is **956 MB** — exceeds free/starter compute RAM, causing disk IO on every similarity search (root cause of the IO alert). Index also has wrong `lists=100` for 94k rows (should be ~307). 10 performance advisors (RLS initplan, unused indexes, unindexed FK) and 7 security advisors (mutable search_path, permissive RLS, leaked password protection) logged — fixes deferred, documented in project scope.
- **Chunk count corrected**: Verified via `SELECT COUNT(*)` — 94,107 chunks live in DB. Previous estimate of ~38,600 in docs was stale; game8 full ingest (session 14) more than doubled the total.

### Session 16 — Sensitivity Sweep + 95% Pass Rate (2026-04-14)
- **Pass rate: 95% (38/40)** on 40-question Reddit-style test battery — up from 53% at session start
- **Per-category sensitivity sweep** (`test-sensitivity-by-category.ts`): queried Supabase directly with threshold 0.10–0.35, confirmed threshold is NOT the bottleneck — stale cache and wrong classifier routing were the real issues
- **Stale cache purge**: 30 cached "no-info" responses deleted from `queries` table — these were blocking good retrieval for kearush, myurdin, antumbra, ludvig, excavatron, alpha wolf helm, and others
- **Classifier fixes**: "best weapon for beginner" and "what weapons can X use" now return `null` (cross-type search) instead of routing to `item`-only
- **No-info pattern tightened**: Consolidated overlapping `"context doesn't"` patterns; removed overly broad `includes("i don't have")` false-positive catchers
- **Rate limits**: Already disabled for development with pre-launch TODO note preserved in code
- **Remaining true gaps** (need crawling): Darkbringer Sword, "hidden weapons" (generic), Kearush weak point detail, Abyss Kutum dedicated page
- **Pre-launch checklist**: Rate limits must be re-enabled before going live (see `route.ts` lines 197–219)

### Session 15 — Boss + Item Location Retrieval (2026-04-14)
- **Boss classifier**: Added missing boss names `goyen`, `matthias`, `white bear`, `t'rukan` to `bossNames` array — these were falling through to full-type search instead of routing to `content_type = 'boss'`
- **Item location re-ranking**: Added `isLocationQuery` detection + +0.15 boost for chunks containing location signal phrases (`where to find`, `obtained from`, `merchant`, `boss drop`, `chest`, `dropped by`, etc.) — promotes location data over stats chunks for "where to find X" queries
- **Item classifier expansion**: `getItemPhrases` regex now captures `how to get`, `how do I obtain`, `where can I obtain`, and other location-intent patterns — routes them to `content_type = 'item'`

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
- [x] **Rate Limiting** - IP-based, server-side. Free: 3/min, 10/hr, 30/day. Premium: 10/min, 60/hr, 200/day. Returns friendly messages shown inline in chat. Free users who hit a limit see an upgrade CTA immediately below the error. **Still disabled for dev — re-enable pre-launch.**
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

#### Ingest status (2026-04-22) — confirmed via Supabase
`SELECT COUNT(*) FROM knowledge_chunks` returned approximately **111,905 chunks** (93,405 fextralife_wiki + 17,798 game8 + 516 wiki + 186 youtube). game8-guides 286 pages re-ingested this session — were previously only 2 entries.

#### Ingest status (2026-04-15) — confirmed via Supabase
`SELECT COUNT(*) FROM knowledge_chunks` returned **94,107 chunks** (verified live). Previous estimate of ~38,600 was outdated — game8 full ingest (session 14) and subsequent runs more than doubled the count.

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

- [x] **Privacy Policy + Terms of Service** — `/privacy` and `/terms` static pages, dark-themed, linked in footer. Contact email placeholders to replace when domain is live.
- [x] **Branding** — Shield AI logo (`public/logo.webp`) in header (44px) and empty chat screen (96px). Auto-generated favicon (`src/app/icon.png` 32×32) and Apple touch icon (`src/app/apple-icon.png` 180×180) via Next.js App Router convention.
- [ ] **Streaming Responses** - Currently waits for full Claude response; no SSE/streaming
- [ ] **Conversation History** - Each question is standalone; no multi-turn context
- [x] **Mobile Optimization (partial)** - Input field always above fold on mobile: `h-[100dvh]`, tighter header padding, subtitle hidden on mobile, `overflow:hidden` on body. Full polish (message bubbles, touch targets) still TODO.
- [x] **Error Boundaries & Error Dashboard** - `ErrorBoundary` class component wraps root layout. `error.tsx` handles Next.js route-level errors. Both log to `error_logs` Supabase table. Admin dashboard has a full error analysis section: **1h / 24h / 7d time filter**, sparkline bar chart, per-type breakdown cards, expandable rows with stack trace + JSON context.
- [x] **Analytics Dashboard** - `/admin` (live at `https://crimson-guide.vercel.app/admin`) — overview stats incl. **cache hit rate %**, 7-day chart, tier usage, query rate stats (avg/min/hr/day), high-volume IP table, unanswered questions table. CSV exports for waitlist, users, content gaps.
- [ ] **Content Management** - No admin interface for managing knowledge chunks
- [x] **Payment Integration** - Stripe checkout, webhook, billing portal, and upgrade/success pages all built. Code complete; needs Stripe env vars in Vercel + dashboard product/webhook setup to go live.

## Future Features (Planned)

### UX Enhancements

- [ ] **Quick Boss Mode** - Instead of typing, players select from a boss/quest list and get instant strategy with phases, weaknesses, and recommended gear. One-tap help while holding a controller.
- [ ] **Build Planner / Loadout Recommender** - Interactive gear calculator ("I'm level 25, using a spear, what armor?"). Stat comparisons, save/share builds. Creates community engagement + return visits.
- [ ] **Interactive Map Integration** - Simplified embedded map where users ask "where is X?" and see it pinned. Overlay collectibles, boss locations, quest givers.
- [ ] **Voice-First Mode (Controller-Friendly)** - Dedicated hands-free UI with larger buttons, auto-read responses, minimal scrolling. Killer differentiator vs wikis for players mid-game.

### Referral Program (DB live — code not built yet)

Full design is spec'd. DB schema already deployed. Build order when ready:

1. **`/api/referral/claim` route** (POST, JWT-authenticated) — attaches a referral code to a newly signed-up user. Validates code exists, blocks self-referral, upserts `referrals` row as `pending`. Idempotent.
2. **`/api/referral/stats` route** (GET, JWT-authenticated) — returns caller's `referral_code`, shareable link (`?ref=CODE`), and conversion stats (total referred / converted / rewarded / reward_pending).
3. **`auth-context.tsx` update** — two additions:
   - On mount: read `?ref=` URL param → `localStorage.setItem('referral_code', code)` (persists through Google OAuth redirect)
   - On `SIGNED_IN` event in `onAuthStateChange`: if localStorage has `referral_code`, call `/api/referral/claim` with the session access token, then clear localStorage. Covers both email/password and Google OAuth sign-ups.
4. **`/api/stripe/webhook` update** — in `checkout.session.completed`, after upgrading user to premium: query `referrals WHERE referred_id = userId AND status = 'pending'`. If found: apply `REFERRAL_1MONTH_FREE` Stripe coupon (100% off, once, created idempotently if missing) to referrer's active subscription → mark `rewarded`. If referrer has no active subscription → mark `reward_pending`.
5. **`/api/stripe/checkout` update** — before creating the Checkout Session, check if this user has any `reward_pending` referrals. If yes, apply the `REFERRAL_1MONTH_FREE` coupon to the checkout session's first payment (the reward owed to them for converting referrals before they subscribed).
6. **`ReferralCard` component** — shows: shareable referral link with copy button, stats pill (X referred / X converted / X rewarded), and contextual state messages ("Your next billing cycle is free!" / "X rewards pending — subscribe to claim").
7. **Show `ReferralCard`**: Add to `/upgrade/success` page ("Share with friends, get a month free!") and to the `/upgrade` page for already-premium users visiting their billing page.

**Stripe coupon**: `REFERRAL_1MONTH_FREE` — `percent_off: 100`, `duration: 'once'`, `name: 'Referral Reward — 1 Month Free'`. Created idempotently in the webhook handler (try retrieve, catch → create). Applied via `stripe.subscriptions.update(subId, { coupon: 'REFERRAL_1MONTH_FREE' })`.

**Edge cases handled in design:**
- Self-referral blocked (`referrer_id !== referred_id`)
- One referrer per referred user (`UNIQUE(referred_id)` in DB)
- Referrer without subscription → `reward_pending`, applied at their checkout
- Multiple conversions before next billing: Stripe coupon replacement is idempotent for one free month; additional rewards tracked in DB for future stacking support

### Community & Retention

- [ ] **Creator/Streamer Partnerships** - Embeddable guide widget for Twitch streams ("Ask the AI guide" overlay). Revenue share on premium signups via referral links.
- [ ] **Tip of the Day Push Notifications** - Daily game tip based on where the user is in the game. Keeps users opening the app between play sessions. Drives ad impressions on free tier.
- [ ] **Community Upvoting on Answers** - Users rate AI responses as helpful/not helpful. Best-rated answers get cached and served faster (saves API costs). Creates feedback loop for quality improvement.

### Legal / Compliance (do before monetisation)

- [ ] **Update contact emails** in `/privacy` and `/terms` pages — replace `privacy@crimsondesertguide.com` and `legal@crimsondesertguide.com` with real addresses once domain is live.
- [ ] **Google AdSense application** — requires a live site with real content. Apply at adsense.google.com, then add publisher ID + ad slot IDs to Vercel env vars (`NEXT_PUBLIC_ADSENSE_ID`, `NEXT_PUBLIC_AD_SLOT_BANNER`, `NEXT_PUBLIC_AD_SLOT_SIDEBAR`) and drop an `ads.txt` file in `public/`.
- [ ] **GDPR cookie consent banner** — required for EU users before enabling personalised AdSense ads. Implement a CMP (consent management platform) or a lightweight consent banner that gates AdSense loading behind user acceptance.

### Supabase Infrastructure (do before scaling)

**Context (checked 2026-04-15):** DB is 1,576 MB total. `knowledge_chunks` has 94,107 rows with a 956 MB IVFFlat vector index — larger than the default Supabase compute RAM, causing disk IO on every similarity search. This triggered the IO alert.

- [ ] **Upgrade Supabase compute** — go to Project Settings → Compute and upgrade to at least the Small add-on (2 GB RAM) so the 956 MB vector index fits in memory. Dashboard action, no code change needed.
- [ ] **Rebuild vector index with correct lists count** — current `lists=100` is undersized for 94k rows. Run in Supabase SQL editor:
  ```sql
  DROP INDEX idx_chunks_embedding;
  CREATE INDEX idx_chunks_embedding ON knowledge_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 307);
  ```
- [ ] **Fix RLS initplan performance** — 10 policies across `users`, `bookmarks`, `queries`, `knowledge_chunks`, `page_hashes` re-evaluate `auth.uid()` per row. Replace `auth.uid()` with `(select auth.uid())` in each policy.
- [ ] **Drop 3 unused indexes** — `idx_error_logs_created_at`, `idx_error_logs_type`, `idx_queries_user_id`.
- [ ] **Fix mutable search_path on functions** — add `SET search_path = public` to `match_knowledge_chunks` and `match_chunks` functions.
- [ ] **Enable leaked password protection** — Supabase dashboard → Authentication → Security. Checks passwords against HaveIBeenPwned. One toggle.
- [ ] **Add missing FK index** — `bookmarks.query_id` has no covering index. Add: `CREATE INDEX ON bookmarks (query_id);`

### Domain Migration (gitgudai.com)

When moving the app from `crimson-guide.vercel.app` to `gitgudai.com`, complete these steps in order:

**1. Vercel — add custom domain**
- [ ] Go to Vercel → crimson-guide project → Settings → Domains
- [ ] Add `gitgudai.com` and `www.gitgudai.com`
- [ ] Copy the DNS records Vercel provides (A record + CNAME)

**2. Domain registrar — add DNS records**
- [ ] Log into your registrar (where you bought gitgudai.com)
- [ ] Add the A record and CNAME from Vercel
- [ ] Wait for DNS propagation (typically 15–60 min, up to 48h)

**3. Supabase — update allowed URLs**
- [ ] Go to Supabase → Authentication → URL Configuration
- [ ] Change **Site URL** from `https://crimson-guide.vercel.app` → `https://gitgudai.com`
- [ ] Add `https://gitgudai.com/auth/callback` to **Redirect URLs**
- [ ] Keep the old Vercel URL in Redirect URLs during transition if needed

**4. Google Cloud Console — no change needed**
- Google OAuth redirects through Supabase's auth endpoint, not your domain — nothing to update there.

**5. Code / content updates**
- [ ] Update contact emails in `/privacy` and `/terms`: replace `privacy@crimsondesertguide.com` and `legal@crimsondesertguide.com` with `@gitgudai.com` addresses
- [ ] Update `PROJECT_STATUS.md` live URL reference from `crimson-guide.vercel.app` to `gitgudai.com`
- [ ] Update `README.md` live URL if listed
- [ ] Consider branding: decide whether to keep "Crimson Desert Guide" as the product name or rename to match `gitgudai.com`

**6. AdSense**
- [ ] Add `ads.txt` to `public/` with your AdSense publisher ID: `google.com, pub-XXXXXXXXXX, DIRECT, f08c47fec0942fa0`
- [ ] Update AdSense account to include `gitgudai.com` as a verified site

**7. Post-migration verification**
- [ ] Confirm HTTPS works on both `gitgudai.com` and `www.gitgudai.com`
- [ ] Test Google OAuth login end-to-end on the new domain
- [ ] Test a chat query to confirm the RAG pipeline works (Supabase + Voyage + Claude)
- [ ] Check admin dashboard at `gitgudai.com/admin`

---

### Manual Setup Required

See **[TODO_MANUAL.md](TODO_MANUAL.md)** for a checklist of accounts, keys, and configs needed (AdSense, Stripe, Google OAuth, domain, content seeding, legal pages).

## Supabase Schema

### Tables
- **`knowledge_chunks`** - Game content with vector embeddings (id, content, embedding, source_url, source_type, chapter, region, quest_name, content_type, character, spoiler_level)
- **`queries`** - Query log (question, response, spoiler_tier, chunk_ids_used, tokens_used, client_ip)
- **`users`** - User profiles (tier, queries_today, queries_today_reset_at, stripe_customer_id, stripe_subscription_id, referral_code)
- **`referrals`** - Referral tracking (id, referrer_id, referred_id, status['pending'|'converted'|'rewarded'|'reward_pending'], created_at, converted_at, rewarded_at). DB is live; application code not yet wired.
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
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>   # Admin routes + ingest scripts
ANTHROPIC_API_KEY=<your-claude-api-key>
VOYAGE_API_KEY=<your-voyage-ai-key>

# Stripe (code complete — needs setup in Stripe dashboard before going live)
STRIPE_SECRET_KEY=<sk_live_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>
STRIPE_PRICE_ID=<price_...>                        # $4.99/mo subscription price ID
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<pk_live_...>

# Optional (features activate when set)
NEXT_PUBLIC_MAX_USERS=100
NEXT_PUBLIC_ADSENSE_ID=ca-pub-XXXXXXXXXX
NEXT_PUBLIC_AD_SLOT_BANNER=<slot-id>
NEXT_PUBLIC_AD_SLOT_SIDEBAR=<slot-id>
ADMIN_SECRET=<your-admin-password>   # Protects /admin dashboard
```
