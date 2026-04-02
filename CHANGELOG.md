# Changelog

All notable changes to the Crimson Desert Guide project.

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
