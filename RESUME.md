# Resume: Phase 1 closed at 80% deterministic recall

## Current state
- Last commit: d546264 (post-Phase-1e REINDEX)
- Branch: main, working tree clean
- Recall@10: 80.0% deterministic across 10 consecutive runs
- MRR: 0.482 (1-of-10 runs at 0.449 — sub-decision-floor wobble)
- Phase 1: COMPLETE
- Corpus: 59,708 chunks (down from 90,395 baseline)
- IVFFlat index: idx_chunks_embedding, lists=237, rebuilt post-1e

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

## Next session — three options to choose from
1. SHIP: Vercel deploy + telemetry + production hygiene
   (eval at 80% is production-viable; real users surface real problems faster than eval optimization)
2. POLISH: Tier-list retrieval (Phase 1f)
   (best-X queries at 0% — URL-pattern boost or matchCount tuning, 1-2 sessions, could reach ~87%)
3. INGEST: Phase 2 ingest rewrite
   (URL canonicalization, cheerio-based parsing, content-based content_type — biggest scope, sets up clean re-crawls)

## Open work items (deferred, documented)
- Phase 1e residual queue: 289 URLs deferred pending per-chunk reclassifier
- Tier-list retrieval (best-one-handed-weapons, best-body-armor at 0%)
- Phase 2 ingest rewrite
- Optional reranker (Cohere or Haiku-relevance pass)
- Production deployment / monitoring

## API key on this machine
ANTHROPIC_API_KEY at %USERPROFILE%\.anthropic_key
VOYAGE_API_KEY in .env.local
SUPABASE_SERVICE_ROLE_KEY in .env.local
(.env.local is gitignored — verified via git check-ignore)

## Final reference docs
- phase1-complete-summary.md (milestone artifact, full scoreboard, per-query deltas, top 7 lessons)
- PROJECT_STATUS.md (working state)
- LEARNINGS.md (operational lessons)
- CHANGELOG.md (commit history reference)
