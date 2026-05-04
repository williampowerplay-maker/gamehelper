# Resume — Production-deployed at 96.7% breadth coverage

## Current state
- Last commit: `bddea1b` (chore: lower signup cap default 100 → 50)
- Branch: main, working tree clean (CSVs from breadth eval still untracked)
- Production: live at gitgudai.com + crimson-guide.vercel.app
- Recall (depth eval, 15 queries): **86.7% / 0.536** deterministic
- Coverage (breadth eval, 276 entities seed=42): **96.7% ± 2.1%**
- Phase 1 + Phase 2 complete
- Mobile header bug: fixed (session 29)
- Mobile long-thread scroll bug: fixed (session 35 — `min-h-0` on flex children, `src/app/page.tsx:144` and `:189`)
- Coverage stats display: live
- **AdSense: DISABLED** pending account setup. Both the `<script>` loader in `layout.tsx` and `showAds` calc in `page.tsx` are commented out with revival instructions in commit `ef3ccdb`.
- **Signup cap: 50** users (default in `src/lib/auth-context.tsx:7`). Currently 4 signed up → 46 spots remaining. Override via `NEXT_PUBLIC_MAX_USERS` env var in Vercel.
- UpgradeCTA copy: removed "premium voice" mention (feature was never implemented).

## Database-only state
- All prior backup tables (pre-1a through 1e)
- `knowledge_chunks_backup_titlefix_20260430` (172 rows from Phase 1f)
- `retrieval_eval_backup_phase1d_audit_20260426`
- IVFFlat: `idx_chunks_embedding`, `lists=237`, `probes=10`
- corpus: 59,708 chunks (post-1e, post-1f)

## Smoke test on resume
1. `cd` to repo
2. `git pull` (clean any `.git/refs/desktop.ini` that Windows recreated)
3. `npx tsx scripts/run-eval.ts` — expect **86.7% / 0.536** deterministic
4. `npx tsx scripts/coverage-breadth-eval.ts --seed=42` — expect **~96.7%** (within margin of error; per-entity ~1.8% wobble is normal IVFFlat noise)
5. Open `gitgudai.com` on a phone — verify header stays visible (session-29 fix) AND send 6+ messages to verify long-thread scroll works (session-35 fix). No ads should appear (AdSense disabled).

## Next session — three real options

**A. Production telemetry round.** Instrument live app to log: queries received, retrieval pool size, top similarity, which content_type fired, whether fallback ran, thumbs-up/down feedback if added. Build basic dashboard. Cost: 1–2 sessions. Value: every future decision benefits from real-user signal.

**B. "I don't know" UX round.** Confidence detection, low-confidence response styling, honest failure copy, query-rephrase suggestions. The user-facing quality work for the 3.3% failure cases. Cost: 1–2 sessions. Value: graceful failures preserve trust.

**C. Continued retrieval optimization.** Cross-domain bias on bosses (5 entities), Bounty Notice cluster collisions (3–4 entities), parser-fix for game8 markdown bug (queued in `known_issues/game8_markdown_parser_bug.md`), slot-2 H1 fix for tier-list pages (would lift the one missing chunk for `best-one-handed-weapons`). Cost: variable. Value: marginal eval gains, may not affect real-user perceived quality.

**Recommended order: A then B.** Telemetry first because you can't tune UX for "I don't know" cases without knowing what those cases look like in the wild. Real production data after 1–2 weeks tells you whether the 3.3% failure rate correlates with real user queries or not.

## API key state
- `ANTHROPIC_API_KEY` at `%USERPROFILE%\.anthropic_key` (also Windows Credential Manager target `ANTHROPIC_API_KEY`)
- `VOYAGE_API_KEY` in `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (verified `role=service_role` after a swap incident this cycle — see LEARNINGS for JWT-decode startup-assertion pattern)
- `.env.local` is gitignored (verified via `git check-ignore`)

## Final reference docs
- `phase1-complete-summary.md` (Phase 1 milestone, scoreboard, lessons)
- `PROJECT_STATUS.md` (working state)
- `LEARNINGS.md` (operational lessons)
- `known_issues/game8_markdown_parser_bug.md` (queued root-cause fix for hyphenated title truncation in ingestion)
- `CHANGELOG.md` (commit history reference — may be stale)
- `coverage-breadth-42.csv` (latest seed=42 baseline; currently untracked — see Task 6 in last session for CSV decision)
- `coverage-breadth-99.csv` (independent seed=99 sample for generalization confirmation; currently untracked)

## Key open questions
- **Has any real user traffic happened yet at gitgudai.com?** If yes, pull telemetry/logs and analyze before any tuning work.
- **AdSense re-enable timing.** Currently disabled (suspected source of mobile freeze on 6th-message AdBanner). Re-enabling = uncomment two blocks in `layout.tsx` + restore `showAds` calc in `page.tsx`. Before re-enabling: confirm AdSense account is approved, decide on auto-ad enablement (vignette/anchor) — those were the most likely freeze culprit and the AdSense dashboard config controls them, not our code.
- **Does the production deployment have any error monitoring** (Sentry, LogRocket, console.errors going anywhere)? If not, this is the highest priority for next session.
- **Phone-test the session-35 fixes.** Confirm the long-thread scroll works on multiple viewport sizes (375x667, 390x844, 412x915) and that the AdSense-disabled state doesn't introduce any other UX regressions.
