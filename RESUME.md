# Resume — Production-deployed at 96.7% breadth coverage

## Current state
- Last commit: `121971c` "feat(feedback): per-response thumbs feedback with categorized downvote reasons" (session 39). Cache investigation (session 40) was research-only — no code or DB changes.
- Branch: main, working tree clean (CSVs from breadth eval still untracked: `coverage-breadth-42.csv`, `coverage-breadth-42-run1.csv`, `coverage-breadth-42-runA.csv`, `coverage-breadth-42-runOLD.csv`, `coverage-breadth-99.csv`)
- Production: live at gitgudai.com + crimson-guide.vercel.app
- Recall (depth eval, 15 queries): **86.7% / 0.536** deterministic
- Coverage (breadth eval, 276 entities seed=42): **96.7% ± 2.1%**
- Phase 1 + Phase 2 complete
- Mobile header bug: fixed (session 29)
- Mobile long-thread scroll bug: fixed (session 35 — `min-h-0` on flex children, `src/app/page.tsx:144` and `:189`)
- Coverage stats display: live
- **AdSense: REMOVED ENTIRELY (session 38, commit `85ca60d`).** No `<script>` loader, no inline AdBanner, no desktop sidebar ad, no `public/ads.txt`. `tier !== "premium"` now gates UpgradeCTA directly (was previously gated by `showAds`).
- **Signup cap: 50** users (default in `src/lib/auth-context.tsx:7`). Override via `NEXT_PUBLIC_MAX_USERS` env var in Vercel.
- **Feedback feature: live (session 39).** See section below.
- **Supabase RLS hardening (session 36):** all 18 backup/staging tables in the `public` schema now have RLS enabled (no policies attached). Supabase Security Advisor warnings cleared. **⚠️ Caveat: `scripts/fix-game8-titles.ts` reads `knowledge_chunks_backup_titlefix_20260430` via supabase-js and will now return zero rows silently.** If Phase 1f rollback is ever needed, either add a service-role policy to that table or switch the script to MCP-direct SQL. See LEARNINGS for the full PostgREST/RLS mental model.

## Feedback feature — live as of 2026-06-10
- **Per-response thumbs up/down** with categorized downvote reasons (`wrong_info` / `spoiled_answer` / `unhelpful` / `other`).
- **Browser session cookie** — `feedback_session`, 2-year `Max-Age`, `HttpOnly` + `Secure` + `SameSite=lax`. Set by `src/proxy.ts` (Next 16's renamed-from-middleware convention; allowlist matcher `["/", "/api/feedback", "/api/feedback/:path*"]`). No auth required.
- **Service-role API** at `src/app/api/feedback/route.ts` — `POST` upsert (on conflict `(message_id, session_id)`), `GET ?message_id=<uuid>` for hydration on mount.
- **Schema** — `public.feedback` table + `public.query_feedback_summary` view that joins feedback → queries (carries `mode`, `cache_hit`, `content_gap`, `question`, both timestamps). Migration applied via Supabase MCP `apply_migration` (no `supabase/migrations/` dir in this repo — same convention as sessions 26, 27, 32, 34, 36).
- **Cache-hit responses ARE rateable** — each cache hit pre-generates its own `queries.id` (Phase 5b fix) and returns `queryId` to the client. The "spoiled_answer on Nudge" signal therefore captures cache-hit responses too, which is where the bulk of repeated-question signal lives.
- **Per-message gating** — `MessageFeedback` only mounts when `message.queryId` is defined. Sign-in walls, rate-limit messages, demo-mode responses, off-topic/no-info shortcuts → no feedback UI (no DB row to FK to).
- **Optimistic UI + silent revert** — clicking a thumb snaps state immediately; POST runs in background; non-2xx response or network error reverts state without surfacing any error to the user. Feedback is non-critical, never blocks the user from reading the response itself.

### Primary eval query

```sql
SELECT question, mode, reason, count(*) AS votes
FROM query_feedback_summary
WHERE rating = 'down' AND mode = 'nudge'
GROUP BY question, mode, reason
ORDER BY votes DESC
LIMIT 50;
```

This is the headline metric — **Nudge-mode downvotes by reason**. `spoiled_answer` is the Nudge-quality signal: it tells us when the model is leaking solution-level detail that the user opted out of.

## Response cache — full mental model (documented session 40)

The "response cache" is **NOT** a separate table — it's a read-through view of `public.queries`. Reasoned this through so a future session can clear/manage it without confusion.

- **Store:** `public.queries` (Supabase Postgres). No Redis/Upstash, no in-memory layer.
- **Lookup key:** `(question_normalized, spoiler_tier)` where `question_normalized = question.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ")` — see `src/app/api/chat/route.ts:322`.
- **TTL:** time-based, `created_at >= now() - 7 days`. Lookup is `select response from queries where question=cacheKey and spoiler_tier=tier and created_at >= now()-7d and response is not null limit 1` (route.ts:370–378). No expiry job; stale rows just stop qualifying.
- **Write sites:**
  - Main RAG insert (route.ts:915–935) — writes `response` set when `shouldCache = !isMissingOrDefaultResponse(answer)`.
  - No-info / content-gap insert (route.ts:939–959) — writes `response: null` + `content_gap: true` so the row exists for analytics but won't serve from cache.
  - Cache-hit logging insert (route.ts:388–399) — re-inserts the same `response` with `cache_hit=true` and a fresh `created_at`, **which effectively extends the cache TTL on every hit**.
- **Readers besides chat route:** `src/app/api/admin/stats/route.ts` and `src/app/api/admin/export/route.ts` (analytics dashboards). `src/app/page.tsx` checks `data.cached` to skip the anon-counter increment.

### ⚠️ Why `queries` is dangerous to bulk-delete

`queries` is not just a cache. It backs:
1. **Anon rate limit** (route.ts:407–423): counts non-cached `queries` rows per `client_ip` over 24h.
2. **Free-tier daily cap** (route.ts:428–444): counts non-cached rows per `user_id` over 24h.
3. **Feedback FKs (session 39):** `public.feedback.message_id` references `queries.id` with `ON DELETE CASCADE`. **Deleting `queries` rows silently drops the associated feedback rows.**
4. **Admin stats/export dashboards.**
5. **Retrieval instrumentation** (`classified_content_type`, `retrieval_similarities`, `classifier_fallback_fired`, `top_chunk_similarity`) used for eval.

**To clear the cache without losing analytics/feedback, prefer `UPDATE … SET response = NULL`** — the row stays for analytics, but it stops qualifying for the lookup (`.not("response", "is", null)`).

### Cache state at session-40 snapshot

| Metric | Count |
|---|---|
| Total `queries` rows | 391 |
| Rows with `response IS NOT NULL` (cacheable ever) | 391 |
| Live cache (response not null, within 7 days) | **7** |
| Live cache — Nudge | 7 |
| Live cache — Full | 0 |
| Rows where `cache_hit = true` | 0 |

`cache_hit=0` means no production user has triggered the cache-hit logging path yet (cache hits would have populated this since session 39 shipped). Either no repeat-questions in production, or the production traffic itself has been very light.

### Cache-clearing recipes (deferred — no action taken session 40)

Soft variants (preserve analytics + feedback):

```sql
-- 1. Nuke the entire live cache
UPDATE public.queries SET response = NULL
WHERE response IS NOT NULL;

-- 2. Clear by question pattern (NORMALIZED form — lowercase alnum+space)
UPDATE public.queries SET response = NULL
WHERE response IS NOT NULL AND question ILIKE '%kailok%';

-- 3. Clear by mode
UPDATE public.queries SET response = NULL
WHERE response IS NOT NULL AND spoiler_tier = 'nudge';   -- or 'full'

-- 4. Clear stale (older than 7d — hygiene only, already not served)
UPDATE public.queries SET response = NULL
WHERE response IS NOT NULL AND created_at < NOW() - INTERVAL '7 days';

-- 5a. Clear entries with any down-vote
UPDATE public.queries q SET response = NULL
WHERE response IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.feedback f
    WHERE f.message_id = q.id AND f.rating = 'down'
  );

-- 5b. Clear entries flagged spoiled_answer
UPDATE public.queries q SET response = NULL
WHERE response IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.feedback f
    WHERE f.message_id = q.id
      AND f.rating = 'down'
      AND f.reason = 'spoiled_answer'
  );
```

Hard-delete variants (`DELETE FROM public.queries WHERE …`) exist but destroy analytics history and cascade-delete feedback rows. Don't use unless explicit goal is purging.

### Outstanding cleanup (carried over)
- **`next lint` not functional post Next 16 upgrade.** Package script `"lint": "next lint"` fails because Next 16 removed the `next lint` command. Project needs ESLint flat-config migration (`eslint.config.js`). Not blocking; pick up in a dedicated hygiene session.
- **Visual UI verification of `MessageFeedback`** — deferred from Phase 5d (session 39). Test on production: thumbs render, hover states, reason picker layout, click → state transitions, refresh hydration (GET hydrates state), incognito = fresh state. The `feedback_session` cookie hydrates the same vote across reloads in the same browser.

### RLS reference (for future schema work)

On the `feedback` table, **anon INSERT/UPDATE returns explicit `401` + Postgres code `42501`** (`"new row violates row-level security policy"`). Anon `SELECT` returns `200` with `[]` (PostgREST's standard behavior for filtered-zero-rows on a SELECT). Service role works both ways.

This is the contrast to **session 35's silent `204` footgun**: the difference is having explicit policies that DENY anon writes (via no policy matching anon for the INSERT/UPDATE commands), vs missing policies entirely on a public-schema table. Pattern to copy for any future write-table: `ENABLE ROW LEVEL SECURITY`, then add explicit `service_role`-only policies for `SELECT`/`INSERT`/`UPDATE`/`DELETE` as needed.

## Database-only state
- All prior backup tables (pre-1a through 1e)
- `knowledge_chunks_backup_titlefix_20260430` (172 rows from Phase 1f)
- `retrieval_eval_backup_phase1d_audit_20260426`
- IVFFlat: `idx_chunks_embedding`, `lists=237`, `probes=10`
- corpus: 59,708 chunks (post-1e, post-1f)
- **NEW (session 39):** `public.feedback` table + `public.query_feedback_summary` view

## Smoke test on resume
1. `cd` to repo
2. `git pull` (clean any `.git/refs/desktop.ini` that Windows recreated)
3. `npx tsx scripts/run-eval.ts` — expect **86.7% / 0.536** deterministic
4. `npx tsx scripts/coverage-breadth-eval.ts --seed=42` — expect **~96.7%** (within margin of error; per-entity ~1.8% wobble is normal IVFFlat noise)
5. Open `gitgudai.com` on a phone — verify header stays visible (session-29 fix) AND send 6+ messages to verify long-thread scroll works (session-35 fix). No ads should appear (AdSense fully removed).
6. **NEW:** Verify feedback UI — send a question, click 👍 (turns green), refresh, vote persists (hydrate via GET). Click 👎 (turns red), reason pills appear, click "Spoiled answer", pill highlights, refresh → both persist.

## Next session — three real options

**A. Production telemetry round.** Instrument live app to log: queries received, retrieval pool size, top similarity, which content_type fired, whether fallback ran. Build basic dashboard. Thumbs-up/down feedback **already lives as of session 39** — see Feedback feature section above; the dashboard would just visualize what's already captured. Cost: 1–2 sessions. Value: every future decision benefits from real-user signal.

**B. "I don't know" UX round.** Confidence detection, low-confidence response styling, honest failure copy, query-rephrase suggestions. The user-facing quality work for the 3.3% failure cases. Cost: 1–2 sessions. Value: graceful failures preserve trust.

**C. Continued retrieval optimization.** Cross-domain bias on bosses (5 entities), Bounty Notice cluster collisions (3–4 entities), parser-fix for game8 markdown bug (queued in `known_issues/game8_markdown_parser_bug.md`), slot-2 H1 fix for tier-list pages (would lift the one missing chunk for `best-one-handed-weapons`). Cost: variable. Value: marginal eval gains, may not affect real-user perceived quality.

**Recommended order: A then B.** Telemetry first because you can't tune UX for "I don't know" cases without knowing what those cases look like in the wild. Real production data after 1–2 weeks tells you whether the 3.3% failure rate correlates with real user queries or not.

**Possible micro-task before A/B/C:** apply a cache-clearing recipe from the section above. Session 40 stopped at "options presented, awaiting scope." If you sit back down at a different PC and want to e.g. clear all Nudge-mode cache entries before letting telemetry collect, run recipe 3.

## API key state
- `ANTHROPIC_API_KEY` at `%USERPROFILE%\.anthropic_key` (also Windows Credential Manager target `ANTHROPIC_API_KEY`). **Will need to be re-provisioned on the other PC.**
- `VOYAGE_API_KEY` in `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (verified `role=service_role` after a swap incident this cycle — see LEARNINGS for JWT-decode startup-assertion pattern)
- `.env.local` is gitignored (verified via `git check-ignore`) — **must be manually copied to the other PC; not in git**.

## Cross-PC handoff notes (session 40)
- Working tree is clean other than the 5 untracked breadth-eval CSVs. None of them are tracked in git by design — they're scratch/baseline outputs. Either copy them across via the OS, regenerate via `npx tsx scripts/coverage-breadth-eval.ts --seed=42` (then `--seed=99`), or just ignore — they're reproducible.
- `.env.local` must be hand-copied (gitignored). Contents needed: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY`.
- `ANTHROPIC_API_KEY` lives at `%USERPROFILE%\.anthropic_key` on the source PC. Either copy it to the same path on the new PC or set the env var directly.
- No DB migrations pending. Schema is current at the Supabase cloud project (`tyjyqzojuhnnnmuhobso`) and any new PC just needs read access via the keys above.

## Final reference docs
- `phase1-complete-summary.md` (Phase 1 milestone, scoreboard, lessons)
- `PROJECT_STATUS.md` (working state)
- `LEARNINGS.md` (operational lessons)
- `known_issues/game8_markdown_parser_bug.md` (queued root-cause fix for hyphenated title truncation in ingestion)
- `CHANGELOG.md` (commit history reference — may be stale)
- `coverage-breadth-42.csv` (latest seed=42 baseline; currently untracked)
- `coverage-breadth-99.csv` (independent seed=99 sample for generalization confirmation; currently untracked)

## Key open questions
- **Has any real user traffic happened yet at gitgudai.com?** `cache_hit=0` in `queries` suggests not, OR no one's asking repeat questions. Either way: pull telemetry/logs and analyze before any tuning work.
- **Does the production deployment have any error monitoring** (Sentry, LogRocket, console.errors going anywhere)? If not, this is the highest priority for next session.
- **Phone-test the session-35 fixes.** Confirm the long-thread scroll works on multiple viewport sizes (375x667, 390x844, 412x915).
- **Path B backup-table cleanup (deferred from session 36).** 15 obsolete backup/staging tables in `public` schema can be dropped to reclaim ~76 MB. The 3 keepers (`knowledge_chunks_backup_phase1e_20260426`, `knowledge_chunks_backup_titlefix_20260430`, `phase1e_nav_only_candidates_20260425`) are referenced by active rollback paths or queued cleanup work. See PROJECT_STATUS session 36 block for the full drop list. Low priority — RLS already silenced the warnings; this is just storage hygiene.
- **Cache-clearing scope (deferred from session 40).** Picks an option from the cache-clearing recipes section. Defer until a clear reason exists (e.g., feedback identifies bad cached responses).
