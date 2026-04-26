# RESUME — Crimson Desert AI Guide

Last updated: end of session 26 (2026-04-25). Read this first when resuming work.

## Current State

- **Recall@10: 54.4% (deterministic)** — triple-run zero variance
- **MRR: 0.283**
- **Cumulative Phase 1 lift: +34.4pp recall** from baseline 20.0%
- **Last commit on `main`: `ab75fce`** ("session 26: classifier alignment + REINDEX + eval audit")
- **Repo:** `williampowerplay-maker/gamehelper`
- **Working directory:** `C:\Users\William Power\Claude Desktop Working Files\Game AI Helper\crimson-guide`

## Database state (NOT in git)

These live in Supabase project `tyjyqzojuhnnnmuhobso` (`crimson-desert-guide`):

### Production tables
- `knowledge_chunks` — **63,552 chunks** (49,280 fextralife + 17,798 game8 + 516 wiki + 186 youtube)
- `retrieval_eval` — **15 queries**, 5 of which had seeds updated this session
- `match_knowledge_chunks()` RPC — currently sets `ivfflat.probes='10'` inside the function body
- `idx_chunks_embedding` — IVFFlat **lists=237** (rebuilt session 26, was lists=100)

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
| `retrieval_eval_backup_phase1c_audit_20260425` | 15 | Pre-eval-audit state (this session) |

## Smoke test on resume

```bash
cd "C:\Users\William Power\Claude Desktop Working Files\Game AI Helper\crimson-guide"
git pull
npx tsx scripts/run-eval.ts
```

**Expected output:** `Recall@10: 54.4%   MRR: 0.283`. Zero variance across consecutive runs. If you see different numbers, **something has changed in either the corpus or the classifier — investigate before proceeding**.

## API key location

- **Anthropic key:** `%USERPROFILE%\.anthropic_key` (Windows). The `phase1c-classify.ts` resolver auto-loads it via 3-step fallback (env var → Windows Credential Manager → file).
- **Voyage + Supabase keys:** `.env.local` in the project root (gitignored). Mirror to other PC if needed.
- **Verify resolver works:** `npx tsx scripts/phase1c-classify.ts` prints `[phase1c] Anthropic key resolved (length=NNN)` if the resolver finds a key.

## First action when resuming — pick ONE

### Option A — Phase 1d trailing-boilerplate stripper
- **Spec:** `known_issues/phase1d_trailing_boilerplate.md`
- **Scope:** ~6,400 chunks with "real content + Fextralife footer" concatenated
- **Method:** find earliest sentinel string (`Retrieved from "https://`, `POPULAR WIKIS`, etc), truncate, re-embed via Voyage
- **Cost:** ~$0.03 Voyage (~1.3M tokens)
- **Estimated wall time:** 6-7 min
- **Eval signal:** Reed Devil and similar boss queries that have substantive content but don't rank — likely Phase 1d targets

### Option B — Phase 1e nav-only deletion
- **Scope:** 587 URLs already queued in `phase1e_nav_only_candidates_20260425`
- **Method:** DELETE FROM knowledge_chunks WHERE source_url IN (SELECT source_url FROM phase1e_nav_only_candidates_20260425). Add backup first.
- **Wall time:** seconds
- **Eval signal:** likely flat — these are nav-only chunks that shouldn't be ranking anyway. Real wins are corpus shrinkage (less IVFFlat noise) and reduced fallback noise.

### Option C — Tier-list retrieval work
- **Trigger:** "best one-handed weapons" still 0% with new seed `fa85ee79` (the literal ranked weapon list)
- **Hypothesis:** null-classifier pool=8 is too narrow for tier-list queries; need keyword boost on "best" + matchCount tuning
- **Files:** `src/app/api/chat/route.ts` `isRecommendationQuery()` and pool sizing
- **Eval signal:** would unlock both "best one-handed weapons" (0% → ?) and "best body armor" (already 67%, potentially higher)

## Anything else to know cold

- **Eval has its own copy of `classifyContentType()` in `scripts/run-eval.ts`** — not imported from `route.ts`. Any classifier change must be mirrored in both files or the eval measures the wrong thing.
- **Probes setting is inside the SQL function body**, not a session variable. The `set_config('ivfflat.probes', '10', true)` runs on every RPC call. Changing it = `CREATE OR REPLACE FUNCTION`.
- **`maintenance_work_mem` matters for IVFFlat builds.** Default Supabase 32MB is insufficient for 63K × 1024-dim. Use `SET maintenance_work_mem = '256MB'` before any future REINDEX.
- **MCP `apply_migration` has a ~2-min client-side timeout.** Long DDL (CREATE INDEX) needs `execute_sql` + polling `pg_stat_activity` for completion.
- **The 2 unresolved 0% eval queries are not seed bugs** (audited last session). Reed Devil = Phase 1d signal; best one-handed weapons = tier-list retrieval signal. Treat them as honest measurements until those rounds happen.
- **`.phase1c-batches/` is committed** — these are the SQL inserts used for Bucket A apply. Useful audit trail; safe to delete if cleaning up later.
- **Big files in repo:** `phase1c-corpus-urls.json` (3.8M), `phase1c-corpus-classifications.json` (1.1M). Worth keeping for reproducibility of session 26 audit findings.
- **Memory at `C:\Users\William Power\.claude\projects\...\memory\`** — older entries (e.g. project_crimson_guide.md from session 3) may be stale. Don't trust dated memory without verifying against PROJECT_STATUS.md.
