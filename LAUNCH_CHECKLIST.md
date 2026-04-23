# Pre-Launch Checklist

Items that were intentionally disabled/deferred during development and **must be restored before going live**.

---

## 🔴 MUST DO before launch

### 1. Re-enable Rate Limiting
**File:** `src/app/api/chat/route.ts` — search for `TODO (PRE-LAUNCH)`
**Status:** Disabled (commented out) with `// TODO (PRE-LAUNCH)` marker
**Action:** Uncomment the rate-limiting block. Also wire `userTier` to the authenticated user's DB record instead of hardcoding `"free"`.
**Limits:**
- Free tier: 3/min, 10/hr, 30/day
- Premium tier: 10/min, 60/hr, 200/day

### 2. Stripe Dashboard Setup (code is done — needs dashboard config)
**Status:** All Stripe API routes built and deployed. Blocked on Stripe dashboard + Vercel env vars.
**Action — do in this order:**
1. Log into [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create a Product: "Crimson Desert Guide Premium" → $4.99/month recurring
3. Copy the **Price ID** (starts with `price_`)
4. Add webhook endpoint: `https://crimson-guide.vercel.app/api/stripe/webhook` → select events: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`
5. Copy the **Webhook Secret** (starts with `whsec_`)
6. Enable the **Billing Portal** in Stripe Settings → Billing → Customer Portal
7. Add all four env vars to Vercel:
   - `STRIPE_SECRET_KEY` (from Stripe API keys)
   - `STRIPE_WEBHOOK_SECRET` (from webhook endpoint)
   - `STRIPE_PRICE_ID` (from the $4.99/mo price)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (from Stripe API keys)
8. Redeploy Vercel after adding env vars

### 3. Wire `userTier` to Authenticated User in Rate Limiting
**File:** `src/app/api/chat/route.ts`
**Status:** Rate limit block has `userTier` hardcoded to `"free"` as a placeholder.
**Action:** Retrieve the authenticated user from the Supabase session, look up their `tier` in the `users` table, and pass it to `RATE_LIMITS[userTier]`.

### 4. Clear Dev/Test Cache Entries
**Status:** Development queries cached with `response: null` — harmless but noisy analytics.
**Action:** `DELETE FROM queries WHERE response IS NULL AND created_at < now() - interval '1 day'`

### 5. Review Admin Auth Throttle
**File:** `src/app/api/admin/` routes
**Status:** Admin endpoint has 5-fail / 15-min / IP throttle using in-memory Map. Resets on Vercel cold start.
**Action:** Consider moving failed-attempt tracking to Supabase if security is critical at launch.

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

### 6b. Retrieval Cleanup Pipeline (through session 25)
- **Phase 1a (URL dedup)** ✅ DONE (session 24) — 19,634 rows collapsed. Recall 20.0% → 26.7% after probes=10 fix.
- **Phase 1b (boilerplate chunk deletion)** ✅ DONE (session 25) — 7,209 rows deleted (p6, p7, p1∧p3, p1∧p5 patterns). Eval flat at 26.7% / MRR 0.182 — zero regressions.
- **Phase 1c (content-based content_type reclassification via Haiku)** — next. 9 eval queries still 0% due to `content_type` mismatches (Oongka=quest classifier picks character; Faded Abyss Artifact=item classifier picks mechanic). 537 URLs flagged in `dedup-preview/flagged-for-manual-review.txt`.
- **Phase 1d (trailing-boilerplate stripper)** — deferred. Scope ~6,429 chunks with "real content + Fextralife footer" concatenated. UPDATE + re-embed via Voyage (~$0.03). Spec: `known_issues/phase1d_trailing_boilerplate.md`.
- **REINDEX + `lists=237`** — after 1b and 1c complete
- **Crawler fix**: `scripts/crawl-wiki.ts` `stripHtml()` needs div-based nav/sidebar stripping (semantic `<nav>` stripping is insufficient for Fextralife). `extractMainContent()` end markers need hardening against sidebar-inside-content layouts.

### 7. Spoiler Tier Wiring
**Status:** `spoilerTier` is currently sent in the request body (client-controlled). For authenticated users, it should come from the user's DB profile.
**Action:** After auth is wired, consider pulling `spoilerTier` from `user.preferences` in Supabase, or enforce server-side based on auth tier.

### 8. Supabase Infrastructure (before scaling)
- Upgrade compute to Small add-on (2 GB RAM) so vector index fits in memory
- **Rebuild vector index** after Phase 1c + 1d complete: current `lists=100` is wrong for post-cleanup row count (63,552 after 1a+1b; smaller after 1d). Target `lists=237` (≈ rows/1000).
- **Index type is IVFFlat**, not HNSW (docs pre-session-23 had this wrong). Tuning knob is `ivfflat.probes`, currently set to 10 via `set_config` inside `match_knowledge_chunks()`. Consider HNSW migration as part of the REINDEX.
- Fix RLS initplan: replace `auth.uid()` with `(select auth.uid())` in all policies
- Enable leaked password protection in Supabase Auth settings
- Drop 3 unused indexes: `idx_error_logs_created_at`, `idx_error_logs_type`, `idx_queries_user_id`
- **Drop backup tables when cleanup is done**:
  - `knowledge_chunks_backup_20260422` (76,123 rows — pre-Phase-1a)
  - `knowledge_chunks_backup_phase1b_20260423` (7,209 rows — pre-Phase-1b)
  - `retrieval_eval_backup_20260422` (15 rows)
  - `dedup_to_delete_20260422` (19,634 IDs — Phase 1a delete staging)
  - `phase1b_to_delete_20260423` (7,209 IDs — Phase 1b delete staging)

### 9. Environment Variables — Verify All on Vercel
- `ANTHROPIC_API_KEY` ✅
- `VOYAGE_API_KEY` ✅
- `NEXT_PUBLIC_SUPABASE_URL` ✅
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅ (added session 21)
- `ADMIN_SECRET` ✅
- `STRIPE_SECRET_KEY` ❌ pending
- `STRIPE_WEBHOOK_SECRET` ❌ pending
- `STRIPE_PRICE_ID` ❌ pending
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` ❌ pending

### 10. Error Logging Review
**Status:** `error_logs` table captures Claude errors and Voyage errors. Review before launch to confirm nothing silently failing at scale.

---

## ✅ Already done / confirmed safe

- Rate limiting code preserved and ready to uncomment (see item 1) ✅
- Cache no-store fix for "no info" responses ✅
- RLS: `knowledge_chunks` restricted to `service_role` for writes ✅
- API keys removed from `next.config.ts` (were being bundled client-side) ✅
- Security headers: X-Frame-Options, HSTS, nosniff, Referrer-Policy ✅
- Input guard: questions capped at 500 chars ✅
- Admin auth: `crypto.timingSafeEqual()` + failed-attempt throttle ✅
- Google OAuth production redirect URLs configured ✅
- `SUPABASE_SERVICE_ROLE_KEY` added to Vercel (session 21) ✅
- Admin dashboard stats fixed (service role key bypasses RLS) ✅
- Stripe API routes built and deployed (checkout, webhook, portal) ✅
- game8 all 660 pages indexed (17,798 chunks) ✅
- gamehelper repo wired to Vercel, all sessions deployed ✅
