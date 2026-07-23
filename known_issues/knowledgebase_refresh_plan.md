# Knowledgebase Refresh Plan (Phase 2 Ingest Rewrite)

**Status:** Queued. Do NOT re-crawl with the current scripts — a naive re-crawl would clobber the Phase 1a–1f cleanup.
**First drafted:** 2026-07-23 (remote review session), from a full re-analysis of the ingest pipeline.

## Why the current scripts can't refresh safely

Every cleanup fix from phases 1a–1f lives **only in mutated DB rows** — none of it was ported back into the crawler/ingest code. The ingest path (`scripts/ingest-from-cache.ts:468-501`) does delete-by-`source_url`-then-insert, so re-crawling any cleaned URL would:

- Reintroduce duplicate URL variants (1a), boilerplate chunks (1b/1d), and Interactive Map junk (1e)
- Revert the 1,007 Haiku content-type reclassifications (1c) back to crude category-based types
- Re-corrupt the game8 titles (1f)
- Break eval seeds (they reference chunk UUIDs, which regenerate on reinsert)
- Churn the IVFFlat index back into non-deterministic recall

**Root-cause correction for the game8 title bug:** the live cause is NOT the markdown list-item theory in `game8_markdown_parser_bug.md` — it's the title-cleanup regex at `scripts/crawl-game8.ts:177`:

```js
.replace(/\s*[|｜\-–].*$/, "")
```

The character class includes a literal hyphen, so any title truncates at its first hyphen ("Best One-Handed Weapons" → "Best One"). Every future hyphenated game8 page would come in corrupted until this is fixed.

**⚠️ Related standing hazard:** `.github/workflows/wiki-reseed.yml` is scheduled weekly (Sundays 3am UTC) and runs `ingest-fextralife.ts --changed-only`. As of 2026-07-23 it has failed all 12 runs because the Actions secrets were never set — which is the only reason the cleaned corpus survived. Keep it disabled (or the secrets unset) until this plan is implemented.

## What a proper refresh needs (in order)

1. **Fix the crawlers in code first** — the `crawl-game8.ts:177` regex, port the phase-1d boilerplate-stripping sentinels into the chunker, skip known nav-only pages, canonicalize URLs (`+` vs `_` variants) at ingest.
2. **Stable chunk identity + non-clobbering upsert** — e.g. a deterministic key from canonical URL + section index, plus `content_hash`/`crawled_at` columns on `knowledge_chunks`, so a refresh only replaces pages whose wiki content actually changed and never touches manually-cleaned rows it doesn't need to.
3. **Per-chunk content-type classification at ingest** (or a step that re-applies the 1c reclassifications after insert).
4. **Run it with the phase-script safety pattern already established:** backup table → dry-run diff → scoped execute → depth + breadth eval gate → REINDEX at `lists≈√rows`.
5. **Migrate eval seeds off raw UUIDs** (to URL + content-fingerprint matching) so refreshes stop being eval-breaking events.

## Suggested rollout order

Disable/keep-disabled the reseed workflow → fix the two crawler bugs + URL canonicalization → add chunk identity/hash columns and a changed-only upsert path → pilot refresh on ~20 URLs behind a backup + eval gate → full re-crawl → REINDEX + re-run depth (`scripts/run-eval.ts`, expect ≥86.7%/0.536) and breadth (`scripts/coverage-breadth-eval.ts --seed=42`, expect ~96.7%) evals.

Estimated effort: 2–3 focused sessions.

## Related files

- `scripts/crawl-wiki.ts` · `scripts/crawl-game8.ts` (esp. `:177`) · `scripts/ingest-from-cache.ts` (esp. `:468-501`) · `scripts/ingest-fextralife.ts` (legacy `page_hashes` path)
- `scripts/phase1d-strip-boilerplate.ts` (sentinel + safety-pattern reference implementation)
- `known_issues/game8_markdown_parser_bug.md` · `known_issues/phase1d_trailing_boilerplate.md`
- `phase1-complete-summary.md:83-88` (original Phase-2 ingest-rewrite scope)
- `.github/workflows/wiki-reseed.yml` (standing hazard until implemented)
