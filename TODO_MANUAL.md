# Manual Setup Checklist

Things that need to be done by hand (accounts, keys, configs) that can't be automated in code.

---

## Google AdSense

- [ ] Apply for Google AdSense at https://adsense.google.com
- [ ] Get approved (requires live site with real content — may need knowledge base seeded first)
- [ ] Copy your publisher ID (format: `ca-pub-XXXXXXXXXX`)
- [ ] Create ad units in AdSense dashboard:
  - [ ] Horizontal banner unit (for in-chat ads) — copy the slot ID
  - [ ] Medium rectangle unit (for desktop sidebar) — copy the slot ID
- [ ] Add to `.env.local` and Vercel env vars:
  ```
  NEXT_PUBLIC_ADSENSE_ID=ca-pub-XXXXXXXXXX
  NEXT_PUBLIC_AD_SLOT_BANNER=<banner-slot-id>
  NEXT_PUBLIC_AD_SLOT_SIDEBAR=<sidebar-slot-id>
  ```
- [ ] Add `ads.txt` file to `public/` folder (AdSense gives you the content)
- [ ] For EU users: set up Google consent mode or a CMP (cookie consent banner) for GDPR compliance

## Stripe (Premium Payments)

- [ ] Create Stripe account at https://stripe.com
- [ ] Create a product + price ($4.99/mo recurring)
- [ ] Set up webhook endpoint for subscription events (customer.subscription.created/deleted)
- [ ] Add to `.env.local` and Vercel:
  ```
  STRIPE_SECRET_KEY=sk_live_XXXXXXXXXX
  STRIPE_WEBHOOK_SECRET=whsec_XXXXXXXXXX
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_XXXXXXXXXX
  STRIPE_PRICE_ID=price_XXXXXXXXXX
  ```
- [ ] Wire the "Upgrade — $4.99/mo" button in `UpgradeCTA.tsx` to Stripe Checkout

## API Keys

- [ ] **Anthropic API key** — https://console.anthropic.com (already have this)
- [ ] **Voyage AI key** — https://dash.voyageai.com (already have this)
- [ ] Make sure both are set in Vercel env vars (not just `.env.local`)

## Supabase

- [x] ~~Create `waitlist` table~~ (done 2026-04-01)
- [x] ~~Add `client_ip` column to `queries` table~~ (done 2026-04-01)
- [ ] Verify `users` table has a trigger to auto-create profile on first sign-in
- [ ] Verify `match_knowledge_chunks` RPC function exists and works
- [ ] Set up Row Level Security policies on all tables (especially `queries`, `users`)
- [ ] Enable Supabase Google OAuth provider in Auth settings (with your Google Cloud OAuth credentials)

## Google OAuth (for Supabase Auth)

- [ ] Create OAuth credentials in Google Cloud Console
- [ ] Set authorized redirect URI to `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
- [ ] Add client ID and secret in Supabase Dashboard > Auth > Providers > Google

## Domain & Deployment

- [ ] Buy domain (if not already done)
- [ ] Configure custom domain in Vercel
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel env vars
- [ ] Set `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` in Vercel env vars

## Content / Knowledge Base

- [ ] Seed initial game content (YouTube transcripts, wiki scrapes, written guides)
- [ ] Chunk content by game unit (one quest, one boss, one puzzle per chunk)
- [ ] Generate embeddings with Voyage AI (`voyage-3.5-lite`, `input_type: "document"`)
- [ ] Upload chunks + embeddings to `knowledge_chunks` table
- [ ] Test with 20+ sample questions to verify retrieval quality

## User Cap

- [ ] Current cap: **100 users** (set via `NEXT_PUBLIC_MAX_USERS` env var)
- [ ] When ready to increase: update the env var in Vercel (no code change needed)
- [ ] When ready to remove cap entirely: set to a very high number or remove the check

## Legal / Compliance

- [ ] Add Privacy Policy page (required for AdSense and GDPR)
- [ ] Add Terms of Service page
- [ ] Cookie consent banner for EU users (required for personalized AdSense ads)
- [ ] `ads.txt` in public folder (required for AdSense)
