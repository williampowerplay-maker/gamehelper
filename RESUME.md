# Resume: Phase 1 closed + landing/mobile UX polished

## Current state
- Last commit: 776bcfe (session 29 — landing trim: removed duplicate 96px logo)
- Branch: main, working tree clean
- Recall@10: 80.0% deterministic across 10 consecutive runs
- MRR: 0.482 (1-of-10 runs at 0.449 — sub-decision-floor wobble)
- Phase 1: COMPLETE
- Corpus: 59,708 chunks (down from 90,395 baseline)
- IVFFlat index: idx_chunks_embedding, lists=237, rebuilt post-1e
- Coverage-stats display: LIVE
- Mobile: header visibility bug FIXED, landing layout polished

## Session 29 (2026-04-27) — mobile UX

Five commits, all UX. No retrieval / corpus changes.

1. `260ebfb` — CoverageStats: `grid-cols-1 sm:grid-cols-2` so labels fit on mobile. Header: smaller logo/title on mobile, tighter gap, `min-w-0`+`truncate` so title can't push AuthButton off-screen.
2. `081ec32` — **Mobile header-disappearing bug fixed.** Two interacting causes:
   - `body { min-h-screen }` (= `100vh` = `lvh` on Android Chrome) made body 57px taller than the visible viewport (`win.innerHeight = 690`, `body rect.h = 747`). `globals.css` had `body { height: 100%; overflow: hidden }` which locks body's own scroll, but **html became the document scroller** for the 57px gap.
   - `useEffect(() => { scrollToBottom() }, [messages])` fired on initial mount with `messages = []`, calling `messagesEndRef.scrollIntoView({ behavior: "smooth" })`. This scrolled html to its max (56px) over a ~500ms animation, hiding the top of the page (which was visible briefly, then disappeared — exactly the symptom).
   - Fix: removed `min-h-screen` from `<body>` in `layout.tsx`; guarded `scrollToBottom` with `messages.length > 0`.
3. `c42fca4` — Cleanup: removed debug instrumentation (eruda script, on-page overlay logger, red marker div).
4. `127efbc` — Trimmed landing example questions 4 → 2 (kept Azure Moon Labyrinth + Kailok the Hornsplitter).
5. `776bcfe` — Removed duplicate 96px logo from empty-state landing (header logo is sufficient).

## Diagnostic methodology that worked (session 29)
- For time-delayed mobile bugs, **instrument first, theorize second**. Two earlier rounds of static-CSS analysis (header crowding, then 100vh viewport-mismatch theory) produced wrong fixes.
- Inject a fixed-position on-page debug overlay (`<pre style="position:fixed;bottom:0;z-index:max">`) that captures `getBoundingClientRect()` for the affected element + parent, computed styles, `html.scrollTop`, `body.scrollTop`, `window.innerHeight`, `visualViewport.{height,offsetTop}`, and `Array.from(document.body.children)` at multiple timestamps (mount / 500 / 1500 / 3000 ms). User screenshots the overlay — no remote DevTools needed.
- Eruda alone wasn't sufficient because the offending element covered eruda's launcher. The on-page overlay pattern is the more reliable fallback.

## Database-only state (not in git)
- knowledge_chunks_backup_20260422 (pre-Phase-1a)
- knowledge_chunks_backup_phase1b_20260423
- knowledge_chunks_backup_phase1c_20260425
- knowledge_chunks_backup_phase1d_20260426
- knowledge_chunks_backup_phase1e_20260426
- retrieval_eval_backup_20260422
- retrieval_eval_backup_phase1c_audit_20260424
- retrieval_eval_backup_phase1d_20260426
- retrieval_eval_backup_phase1d_audit_20260426
- phase1c_classifications_20260425 (Bucket A applied)
- phase1c_manual_review_20260425 (2 rows, deferred)
- phase1d_candidates_20260426
- phase1d_failed_20260426 (0 rows, clean run)
- phase1e_nav_only_candidates_20260425 (587 rows; 298 deleted, 289 deferred — invalidated by spot-check)

## Smoke test on resume
1. cd to repo
2. git pull
3. (clean any .git/refs/desktop.ini that Windows recreated)
4. npx tsx scripts/run-eval.ts
5. Expect: 80.0% / 0.482 (or 0.449 on the 1-in-10 wobble)
6. If lower or unstable: investigate before any new work
7. Open production URL on a phone — verify header stays visible (the session-29 fix). If not, check `body` has no `min-h-*` class and that `scrollToBottom` is guarded.

## Next session — options
1. **SHIP**: Vercel deploy is live; add telemetry + production hygiene
2. **POLISH**: Tier-list retrieval (Phase 1f) — best-X queries at 0%, URL-pattern boost or matchCount tuning, 1-2 sessions, could reach ~87%
3. **INGEST**: Phase 2 ingest rewrite (URL canonicalization, cheerio-based parsing, content-based content_type — biggest scope)
4. **UX**: Continued landing/onboarding tuning (mobile layout currently good after session 29)

## Open work items (deferred, documented)
- Phase 1e residual queue: 289 URLs deferred pending per-chunk reclassifier
- Tier-list retrieval (best-one-handed-weapons, best-body-armor at 0%)
- Phase 2 ingest rewrite
- Optional reranker (Cohere or Haiku-relevance pass)
- Production deployment / monitoring

## API key on this machine
ANTHROPIC_API_KEY: stored in Windows Credential Manager (Target: "ANTHROPIC_API_KEY")
  Retrieve via: $env:ANTHROPIC_API_KEY = (Get-StoredCredential -Target 'ANTHROPIC_API_KEY').GetNetworkCredential().Password
  Or in bash: ANTHROPIC_API_KEY=$(powershell -Command "(Get-StoredCredential -Target 'ANTHROPIC_API_KEY').GetNetworkCredential().Password")
VOYAGE_API_KEY in .env.local
SUPABASE_SERVICE_ROLE_KEY in .env.local
(.env.local is gitignored — verified via git check-ignore)

## Final reference docs
- phase1-complete-summary.md (milestone artifact, full scoreboard, per-query deltas, top 7 lessons)
- PROJECT_STATUS.md (working state)
- LEARNINGS.md (operational lessons)
- CHANGELOG.md (commit history reference)
