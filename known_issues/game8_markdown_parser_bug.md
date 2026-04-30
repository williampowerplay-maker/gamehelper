# Game8 Markdown Parser: Hyphenated Title Continuation Bug

**Status:** Data corrected for 4 known URLs (slot-1 only). Parser fix queued. Slot-2 fix queued.

**First identified:** Session 32 (2026-04-30) while diagnosing 0% recall on `"what are the best one-handed weapons?"`.

## Symptom

Game8 page titles containing hyphens get truncated during ingestion. Each affected chunk's content has the page title prepended in a "title prefix" slot, and the page's own scraped H1 in a second slot. Both slots are corrupted by the same parser bug.

## Affected URLs (verified via SQL scan)

| URL | Truncated → Correct title | Chunks |
|-----|----------------------------|--------|
| `https://game8.co/games/Crimson-Desert/archives/595314` | `Best One` → `Best One-Handed Weapons` | 34 |
| `https://game8.co/games/Crimson-Desert/archives/595374` | `Best Two` → `Best Two-Handed Weapons` | 33 |
| `https://game8.co/games/Crimson-Desert/archives/586776` | `List of All One` → `List of All One-Handed Weapons` | 39 |
| `https://game8.co/games/Crimson-Desert/archives/586777` | `List of All Two` → `List of All Two-Handed Weapons` | 66 |
| **Total** | | **172** |

Scope verified: a regex scan for any other game8 first-line ending in word fragments (`One$`, `Two$`, `Self$`, `Pre$`, `Anti$`, `Half$`, etc.) returned zero additional matches. No other game8 pages currently exhibit this pattern.

## Root cause (theory)

The original page title in HTML is something like:

```html
<h1>Best One-Handed Weapons</h1>
```

Game8's HTML-to-markdown step appears to introduce a line-break inside the title (likely because the browser's text-wrap or a `<wbr>` or a soft-hyphen converted to a hard newline at the hyphen):

```
Best One
-Handed Weapons
```

A standard markdown parser (probably `marked` or similar) sees a line starting with `-` followed by a space (or what it interprets as a list item) and interprets `-Handed Weapons` as the start of an unordered list. The remainder gets treated as list content (or stripped), leaving only `Best One` as the title.

This corruption happens at INGEST time, BEFORE the page-title-prefix is prepended to each chunk. Result: every chunk from the affected page has the corrupted title in TWO slots:

1. **Slot 1 (prepended prefix):** the corrupted `"Best One\n\n"` is prepended to each chunk's content as the canonical page title.
2. **Slot 2 (page H1 inside chunk):** the corrupted `"Best One\n\n"` also appears INSIDE the chunk content as the scraped H1 of the page itself.

Voyage embeddings see the corrupted title in both slots and lose the semantic anchor "one-handed weapons" / "two-handed weapons".

## Data correction

`scripts/fix-game8-titles.ts` is a one-time data-correction artifact. It:

1. Reads chunks from `knowledge_chunks_backup_titlefix_20260430` (the pre-fix backup, 172 rows).
2. Verifies each chunk's CURRENT state in `knowledge_chunks` (skips already-fixed for idempotency).
3. Replaces only **slot-1** (the prepended prefix at chunk start): `"Best One\n\n"` → `"Best One-Handed Weapons\n\n"`, etc.
4. Re-embeds via Voyage `voyage-3.5-lite`, `input_type=document` (matches corpus).
5. UPDATEs `content`, `embedding`, `re_embedded_at` for each chunk.

**Slot-2 is NOT fixed by this script.** Slot-2 (the H1 inside the chunk content) remains as `"Best One\n\n"` because its position is variable and replacing every occurrence in content would risk false positives.

### Cost / runtime
- 172 chunks, ~16,511 tokens, ~$0.0003 Voyage cost.
- 1.6 second wall time at concurrency=4 / batch=32.
- Idempotent: second `--execute` run reports 0 planned, 172 skipped ("already fixed").

### Eval impact
- Recall@10 unchanged (80.0% pre and post).
- Tier-list queries unchanged: best-one-handed-weapons 0%, best-body-armor 67%.
- Raw vector similarity DID improve (expected chunks moved from below top-100 to raw top-25 for "best one-handed weapons"; all 3 expected chunks rank 2/3/4 raw for "best body armor"). But the post-rerank pipeline's URL-match and content-start boosts dominate, favoring fextralife pages whose URLs literally contain "armor"/"weapons". Slot-1 fix's ~0.005 sim gain is insufficient to overcome the reranker boost gap.

## Next steps queued

1. **Slot-2 data fix.** Find `"Best One\n\n"` inside chunk content (not at start) for the 4 affected URLs and replace with `"Best One-Handed Weapons\n\n"`. Re-embed. Same approach as slot-1 but with `String.prototype.replace` rather than prefix-replacement, scoped strictly to chunks whose source_url is one of the 4. Estimated cost: same ~$0.0003.

2. **Parser fix in `scripts/ingest-*.ts`.** Find the markdown-conversion step that's eating hyphenated continuations. Likely fix: pre-process the HTML to replace `<h1>X-Y</h1>` patterns where Y starts on a new visual line, or post-process markdown output to detect orphan `-` continuations. Without this fix, re-ingesting these 4 URLs (or any future Crimson Desert game8 page with a hyphenated title) would re-introduce the bug.

## Related files

- `scripts/fix-game8-titles.ts` — slot-1 data fix
- `scripts/probe-tier-list-retrieval.ts` — diagnostic probe for tier-list query top-10 inspection
- `knowledge_chunks_backup_titlefix_20260430` — DB backup table, 172 rows, full schema
- `LEARNINGS.md` — meta-learning entry on two-slot corruption requiring two-slot fixes
