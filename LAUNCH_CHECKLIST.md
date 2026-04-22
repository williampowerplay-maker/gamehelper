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

### 7. Spoiler Tier Wiring
**Status:** `spoilerTier` is currently sent in the request body (client-controlled). For authenticated users, it should come from the user's DB profile.
**Action:** After auth is wired, consider pulling `spoilerTier` from `user.preferences` in Supabase, or enforce server-side based on auth tier.

### 8. Supabase Infrastructure (before scaling)
- Upgrade compute to Small add-on (2 GB RAM) so 956 MB vector index fits in memory
- Rebuild vector index: `lists=307` (correct for 94k+ rows), current `lists=100` is undersized
- Fix RLS initplan: replace `auth.uid()` with `(select auth.uid())` in all policies
- Enable leaked password protection in Supabase Auth settings
- Drop 3 unused indexes: `idx_error_logs_created_at`, `idx_error_logs_type`, `idx_queries_user_id`

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
