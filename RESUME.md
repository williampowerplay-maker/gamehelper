# RESUME — Crimson Desert AI Guide

Last updated: end of session 27 (2026-04-26). Read this first when resuming work.

## Current State

- **Recall@10: 66.7% (deterministic across 3 runs)**
- **MRR: 0.390**
- **Cumulative Phase 1 lift: +46.7pp recall** from baseline 20.0%
- **Last session 27 commit on `main`: see `git log` — session 27 covers Phase 1d + eval audit**
- **Repo:** `williampowerplay-maker/gamehelper`
- **Working directory:** `C:\Users\William Power\Claude Desktop Working Files\Game AI Helper\crimson-guide`

## Database state (NOT in git)

These live in Supabase project `tyjyqzojuhnnnmuhobso` (`crimson-desert-guide`):

### Production tables
- `knowledge_chunks` — **62,804 chunks** (Phase 1d deleted 748 thin remainders this session; 2,914 chunks now have shorter content + new embeddings + non-null `re_embedded_at`)
- `re_embedded_at` column added to knowledge_chunks (session 27)
- `retrieval_eval` — **15 queries**. Oongka seed needs re-audit (see "First action" below)
- `match_knowledge_chunks()` RPC — `ivfflat.probes='10'`
- `idx_chunks_embedding` — IVFFlat **lists=237** (rebuilt session 26). Phase 1d added 2,914 new vectors; minor probe-variance possible

### Backup / staging tables (droppable pre-launch once cleanup is locked in)
| Table | Rows | Purpose |
|---|---:|---|
| `knowledge_chunks_backup_20260422` | 76,123 | Pre-Phase-1a fextralife snapshot |
| `knowledge_chunks_backup_phase1b_20260423` | 7,209 | Phase 1b deletion backup |
| `knowledge_chunks_backup_phase1c_20260425` | 11,670 | Phase 1c UPDATE backup |
| `dedup_to_delete_20260422` | 19,634 | Phase 1a delete IDs |
| `phase1b_to_delete_20260423` | 7,209 | Phase 1b delete IDs |
| `phase1c_classifications_20260425` | 1,007 | Phase 1c apply staging |
| `phase1e_nav_only_candidates_20260425` | 587 | **Phase 1e ready-to-execute queue** |
| `phase1c_manual_review_20260425` | 2 | Memory Fragment + House Serkis (manual review queue) |
| `retrieval_eval_backup_20260422` | 15 | Pre-session-24 eval state |
| `retrieval_eval_backup_phase1c_audit_20260425` | 15 | Pre-eval-audit state (session 26) |
| `phase1d_candidates_20260426` | 3,662 | Phase 1d staging |
| `phase1d_failed_20260426` | 0 | Empty — no Voyage failures during execute |
| `knowledge_chunks_backup_phase1d_20260426` | 3,662 | Pre-1d snapshot for rollback |

## Smoke test on resume

```bash
cd "C:\Users\William Power\Claude Desktop Working Files\Game AI Helper\crimson-guide"
git pull
npx tsx scripts/run-eval.ts
```

**Expected output:** `Recall@10: 66.7%   MRR: 0.390`. Deterministic across consecutive runs. If you see different numbers, **something has changed in the corpus, classifier, or eval seeds — investigate before proceeding**.

## API key location

- **Anthropic key:** `%USERPROFILE%\.anthropic_key` (Windows). The `phase1c-classify.ts` resolver auto-loads it via 3-step fallback (env var → Windows Credential Manager → file).
- **Voyage + Supabase keys:** `.env.local` in the project root (gitignored). Mirror to other PC if needed.
- **Verify resolver works:** `npx tsx scripts/phase1c-classify.ts` prints `[phase1c] Anthropic key resolved (length=NNN)` if the resolver finds a key.

## First action when resuming — pick ONE

### Option A — Phase 1e nav-only deletion
- **Scope:** 587 URLs queued in `phase1e_nav_only_candidates_20260425`. **Re-count first** — some may have been deleted by Phase 1d's 748 thin-remainder deletes.
- **Method:** backup affected chunks → DELETE FROM knowledge_chunks WHERE source_url IN (SELECT source_url FROM phase1e_nav_only_candidates_20260425).
- **Wall time:** seconds
- **Eval signal:** likely flat — these are nav-only chunks that shouldn't be ranking anyway. Real wins are corpus shrinkage (less IVFFlat noise) and reduced fallback noise.

### Option B — Tier-list retrieval work
- **Trigger:** "best one-handed weapons" still 0% with seed `fa85ee79` (the literal ranked weapon list)
- **Hypothesis:** null-classifier pool=8 is too narrow for tier-list queries; need keyword boost on "best" + matchCount tuning
- **Files:** `src/app/api/chat/route.ts` `isRecommendationQuery()` and pool sizing
- **Eval signal:** would unlock both "best one-handed weapons" and potentially raise "best body armor" higher than 67%.

### Option C — Diagnose Kailok (33% mid-pool)
- **Status:** 33% recall — only 1 of 3 expected chunks ranks
- **Approach:** check whether the other 2 expected seeds are also in the same kind of "exists but doesn't rank" pattern as Oongka/Reed Devil (would mean another seed-audit) or whether they're genuinely thin/unfindable

## Anything else to know cold

- **Eval has its own copy of `classifyContentType()` in `scripts/run-eval.ts`** — not imported from `route.ts`. Any classifier change must be mirrored in both files or the eval measures the wrong thing.
- **Probes setting is inside the SQL function body**, not a session variable. The `set_config('ivfflat.probes', '10', true)` runs on every RPC call. Changing it = `CREATE OR REPLACE FUNCTION`.
- **`maintenance_work_mem` matters for IVFFlat builds.** Default Supabase 32MB is insufficient for 63K × 1024-dim. Use `SET maintenance_work_mem = '256MB'` before any future REINDEX.
- **MCP `apply_migration` has a ~2-min client-side timeout.** Long DDL (CREATE INDEX) needs `execute_sql` + polling `pg_stat_activity` for completion.
- **The 2 unresolved 0% eval queries are not seed bugs** (audited last session). Reed Devil = Phase 1d signal; best one-handed weapons = tier-list retrieval signal. Treat them as honest measurements until those rounds happen.
- **`.phase1c-batches/` is committed** — these are the SQL inserts used for Bucket A apply. Useful audit trail; safe to delete if cleaning up later.
- **Big files in repo:** `phase1c-corpus-urls.json` (3.8M), `phase1c-corpus-classifications.json` (1.1M). Worth keeping for reproducibility of session 26 audit findings.
- **Memory at `C:\Users\William Power\.claude\projects\...\memory\`** — older entries (e.g. project_crimson_guide.md from session 3) may be stale. Don't trust dated memory without verifying against PROJECT_STATUS.md.
