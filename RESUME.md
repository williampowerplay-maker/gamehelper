# RESUME — Crimson Desert AI Guide

Last updated: end of session 27 (2026-04-26). Read this first when resuming work.

## Current State

- **Recall@10: 52.6% (mean of 3 runs)** — Phase 1d's Oongka eval-seed artifact masks ~6pp of real wins
- **MRR: 0.267**
- **Cumulative Phase 1 lift: +32.6pp recall measured** (real lift ~+39pp after Oongka seed re-audit)
- **Last session 27 commit on `main`: see `git log` — session 27 covers Phase 1d**
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

**Expected output:** `Recall@10: 52.6%–53.3%   MRR: 0.256–0.290`. Slight run-to-run variance from IVFFlat probe scan + Saint's Necklace flake. If you see numbers outside this band, **something has changed — investigate before proceeding**.

## API key location

- **Anthropic key:** `%USERPROFILE%\.anthropic_key` (Windows). The `phase1c-classify.ts` resolver auto-loads it via 3-step fallback (env var → Windows Credential Manager → file).
- **Voyage + Supabase keys:** `.env.local` in the project root (gitignored). Mirror to other PC if needed.
- **Verify resolver works:** `npx tsx scripts/phase1c-classify.ts` prints `[phase1c] Anthropic key resolved (length=NNN)` if the resolver finds a key.

## First action when resuming — pick ONE

### Option A — Oongka eval seed re-audit (HIGH PRIORITY, low effort)
- **Trigger:** Phase 1d truncated Oongka's expected_chunk_id from 832→249 chars. Better Oongka chunks now rank above it.
- **Method:** pull top 5 chunks at /Oongka URL ordered by content length, pick 2-3 that best answer "who is Oongka?" (likely `204d0beb`, `4b1d701e`, `f0e3189f` based on session-27 dry-run), update `retrieval_eval` row.
- **Eval impact:** ~+7pp recall (100% on Oongka instead of 0%). Brings cumulative to ~59-60%.
- **Wall time:** 5 min. No DB schema changes, just one UPDATE row.

### Option B — Phase 1e nav-only deletion
- **Scope:** 587 URLs already queued in `phase1e_nav_only_candidates_20260425`. Note: Phase 1d may have shrunk this set since some were among the 748 deletes — re-count first.
- **Method:** DELETE FROM knowledge_chunks WHERE source_url IN (SELECT source_url FROM phase1e_nav_only_candidates_20260425). Add backup first.
- **Wall time:** seconds
- **Eval signal:** likely flat — these are nav-only chunks that shouldn't be ranking anyway.

### Option C — Tier-list retrieval work
- **Trigger:** "best one-handed weapons" still 0% with seed `fa85ee79` (the literal ranked weapon list)
- **Hypothesis:** null-classifier pool=8 is too narrow for tier-list queries; need keyword boost on "best" + matchCount tuning
- **Files:** `src/app/api/chat/route.ts` `isRecommendationQuery()` and pool sizing
- **Eval signal:** would unlock both "best one-handed weapons" and potentially raise "best body armor" higher than 67%.

## Anything else to know cold

- **Eval has its own copy of `classifyContentType()` in `scripts/run-eval.ts`** — not imported from `route.ts`. Any classifier change must be mirrored in both files or the eval measures the wrong thing.
- **Probes setting is inside the SQL function body**, not a session variable. The `set_config('ivfflat.probes', '10', true)` runs on every RPC call. Changing it = `CREATE OR REPLACE FUNCTION`.
- **`maintenance_work_mem` matters for IVFFlat builds.** Default Supabase 32MB is insufficient for 63K × 1024-dim. Use `SET maintenance_work_mem = '256MB'` before any future REINDEX.
- **MCP `apply_migration` has a ~2-min client-side timeout.** Long DDL (CREATE INDEX) needs `execute_sql` + polling `pg_stat_activity` for completion.
- **The 2 unresolved 0% eval queries are not seed bugs** (audited last session). Reed Devil = Phase 1d signal; best one-handed weapons = tier-list retrieval signal. Treat them as honest measurements until those rounds happen.
- **`.phase1c-batches/` is committed** — these are the SQL inserts used for Bucket A apply. Useful audit trail; safe to delete if cleaning up later.
- **Big files in repo:** `phase1c-corpus-urls.json` (3.8M), `phase1c-corpus-classifications.json` (1.1M). Worth keeping for reproducibility of session 26 audit findings.
- **Memory at `C:\Users\William Power\.claude\projects\...\memory\`** — older entries (e.g. project_crimson_guide.md from session 3) may be stale. Don't trust dated memory without verifying against PROJECT_STATUS.md.
