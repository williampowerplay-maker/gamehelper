# Pre-Launch Checklist

Items that were intentionally disabled/deferred during development and **must be restored before going live**.

---

## 🔴 MUST DO before launch

### 1. Re-enable Rate Limiting
**File:** `src/app/api/chat/route.ts` — lines ~197–219
**Status:** Disabled (commented out) with `// TODO (PRE-LAUNCH)` marker
**Action:** Uncomment the rate-limiting block. Also wire `userTier` to the authenticated user's DB record instead of hardcoding `"free"`.
**Limits to restore:**
- Free tier: 5 requests/min, 20 requests/hour
- Premium tier: 10 requests/min, 60 requests/hour

### 2. Deploy gamehelper to Production
**Status:** All new code (cache no-store, boss classifier, item location boost) lives in `gamehelper` project. Production URL (`crimson-guide.vercel.app`) still runs old code from the `crimson-guide` project.
**Action:** Wire the `gamehelper` repo to Vercel and redeploy.

### 3. Swap to Service Role Key for Ingest Scripts
**File:** `scripts/ingest-from-cache.ts`
**Status:** Ingest scripts must use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) so DELETE steps actually work before re-ingest.
**Action:** Confirm `.env.local` on the ingest machine has `SUPABASE_SERVICE_ROLE_KEY` set.

### 4. Clear Dev/Test Cache Entries
**Status:** During development, many "no info" test queries got cached with `response: null` — these are harmless but noisy.
**Action:** Run `DELETE FROM queries WHERE response IS NULL AND created_at < now() - interval '1 day'` to clean up analytics noise before launch.

### 5. Review Admin Auth Throttle
**File:** `src/app/api/chat/route.ts`
**Status:** Admin endpoint has 5-fail / 15-min / IP throttle using in-memory Map. This resets on server restart (Vercel cold start).
**Action:** Consider moving failed-attempt tracking to Supabase if admin security is critical at launch.

---

## 🟡 NICE TO HAVE before launch

### 6. Content Gap Fills
Known queries with no data in the DB:
- **Abyss Kutum** — no dedicated strategy page in game8-bosses
- **Darkbringer Sword** — not found in fextralife or game8
- **Bow locations** — fextralife bow pages not fully crawled
- **Kliff weapon types overview** — no general overview page ingested
- **Weapon tier/refinement system** — upgrade content not retrieving for generic queries
- **Alpha Wolf Helm** — retrieval gap, investigate crawl coverage

### 7. Spoiler Tier Wiring
**Status:** `spoilerTier` is currently hardcoded to the value sent in the request body. For authenticated users, it should come from the user's DB profile.
**Action:** After auth is wired, pull `spoilerTier` from `user.tier` in Supabase.

### 8. Google OAuth Callback URL
**Status:** Supabase Auth is configured for local `localhost:3000`. Update the OAuth redirect URL to the production domain.

### 9. Environment Variables on Vercel
Confirm all secrets are set in Vercel project settings:
- `ANTHROPIC_API_KEY`
- `VOYAGE_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only, not `NEXT_PUBLIC_`)
- `ADMIN_TOKEN`

### 10. Error Logging Review
**Status:** `error_logs` table in Supabase captures Claude errors and rate-limit events. Review before launch to ensure nothing is silently failing at scale.

---

## ✅ Already done / confirmed safe

- Rate limiting code preserved and ready to uncomment (see item 1)
- Cache no-store fix for "no info" responses ✅
- RLS: `knowledge_chunks` restricted to `service_role` for writes ✅
- API keys removed from `next.config.ts` (were being bundled client-side) ✅
- Security headers: X-Frame-Options, HSTS, nosniff, Referrer-Policy ✅
- Input guard: questions capped at 500 chars ✅
- Admin auth: `crypto.timingSafeEqual()` + failed-attempt throttle ✅
