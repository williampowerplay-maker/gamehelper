# Phase 1d — Trailing-Boilerplate Stripper

**Status:** Identified 2026-04-23 during Phase 1b scoping. Not yet built.
**Prerequisite for:** REINDEX at end of Phase 1 cleanup.

---

## Problem

A non-trivial slice of fextralife chunks contain **real game content at the top** followed by **Fextralife footer boilerplate concatenated in-place at the bottom**. Single chunk, mixed payload. Deleting them would destroy real game data (bow stats, skill descriptions, quest lore, patch notes, item descriptions); keeping them as-is pollutes embeddings with 500+ chars of ad/nav text.

**This is why `p3 ∧ p5` (POPULAR WIKIS + Retrieved-from) was dropped from Phase 1b's delete rule** — spot-checking 30 chunks at `length ≥ 700` showed 73% were mixed-content, far exceeding the 20% safety threshold.

## Example: Oongka survivor chunk `034f6c4f-ed92-4358-a739-5159af226739`

```
Oongka

[...] Dual Wielding Mastery                      ←─┐
- Evasive Shot                                     │
- Lariat                                           │  ~250 chars of REAL CONTENT
- Marksmanship                                     │  (Oongka's skill list — the whole
- Quaking Fury                                     │   reason this chunk exists)
- Rampage                                          │
- Spinning Slash                                   │
                                                   │
### Crimson Desert Oongka Notes, Tips & Trivia     │
- Notes, Tips & Trivia for Oongka goes here.    ←─┘

Characters Damiane Kliff Oongka                 ←─┐
Retrieved from "https://crimsondesertgame.wiki     │
   .fextralife.com/index.php?title=Oongka..."      │
Join the page discussion                          │  ~580 chars of BOILERPLATE
POPULAR WIKIS Elden Ring 4,426 pages Elden Ring    │  (pure Fextralife footer —
   Nightreign 1,430 pages Expedition 33 977        │   no Oongka content anywhere)
   pages Dark Souls 3 2,169 pages All Wikis...     │
- Home / All Wikis / Forum / About Us / Contact    │
- Advertising / Careers / Terms / Privacy          │
FextraLife is part of the Valnet Publishing       │
   Group Copyright © Valnet Inc.                ←─┘
```

832 chars total, ~30% real / ~70% boilerplate. This is the survivor chunk from Phase 1a URL dedup — it IS the expected answer for the "who is Oongka?" eval query.

## Scope estimate

Chunks matching `p3 ∧ p5` (POPULAR WIKIS + Retrieved-from), post-Phase-1b:

| Length band | Count | Spot-check verdict |
|---|--:|---|
| ≥ 700 chars | ~1,332 | 73% mixed-content (sampled 30) |
| < 700 chars | ~1,364 | Not yet sampled — likely mostly pure boilerplate |
| **Total** | **~2,696** | |

Plus adjacent uncertain buckets that Phase 1b also deferred:
- `p1` alone (MediaWiki-only, no co-occurrence): 3,082 — at least some contain real content (e.g. `/Equestrian_II` has "+2 Horse EXP Gain / Sells for 3.52" after nav)
- `p5` alone (Retrieved-from only, no co-occurrence): 651 — includes Flame_Rush, Quick_Reload-type skill chunks with footer tails

**Total candidate-for-Phase-1d scope: 2,696 + 3,082 + 651 = ~6,429 chunks** (conservative ceiling).

## Proposed fix: truncate + re-embed

Instead of deleting the whole chunk, **find the first occurrence of a boilerplate sentinel string and truncate everything from that point onward**. Preserve the real content at the top, discard the footer.

### Sentinel strings to truncate at (in priority order)

```
1.  'Retrieved from "https://'     ← strongest signal (always footer-start)
2.  'POPULAR WIKIS'                ← ad block start
3.  'Join the page discussion'     ← comment-section link
4.  'FextraLife is part of the Valnet'  ← final footer line
5.  '© 2012-2025 Fextralife'      ← (not in our corpus — pattern doc'd case)
6.  'Copyright © Valnet Inc'       ← very last line
```

Truncation strategy: find the earliest position where any sentinel appears, cut at that position, trim trailing whitespace. If the remaining chunk is < 100 chars, the whole chunk was boilerplate and should be DELETEd rather than UPDATEd (these are chunks we missed in Phase 1b because they weren't caught by p6/p7).

### Re-embedding requirement

Truncating content invalidates the stored embedding — it was generated from the *full* chunk including footer. The re-embedding step is essential:

1. Export truncated content as a list: `(id, new_content)` rows
2. Batch through Voyage AI (`voyage-3.5-lite`, ~1,000 chunks/batch)
3. UPDATE `knowledge_chunks` SET content = new_content, embedding = new_embedding WHERE id = ?
4. Wrap in transaction per batch so partial failures don't leave inconsistent state

### Cost estimate (Voyage re-embedding)

- Scope: ~6,429 chunks × ~800 chars avg × ~1 token per ~4 chars ≈ **~1.3M tokens**
- Voyage `voyage-3.5-lite` pricing: **$0.02 per 1M tokens**
- Cost: **~$0.026** (trivial)
- Latency: Voyage API handles ~1,000 chunks/minute, so ~6–7 minutes total

## Implementation sketch

```typescript
// scripts/phase1d-strip-trailing-boilerplate.ts (NOT BUILT)
const SENTINELS = [
  'Retrieved from "https://',
  'POPULAR WIKIS',
  'Join the page discussion',
  'FextraLife is part of the Valnet',
  'Copyright © Valnet Inc',
];

function findTruncationPoint(content: string): number | null {
  let earliest = content.length;
  let found = false;
  for (const s of SENTINELS) {
    const idx = content.indexOf(s);
    if (idx !== -1 && idx < earliest) {
      earliest = idx;
      found = true;
    }
  }
  return found ? earliest : null;
}

// Iteration:
// 1. SELECT chunks matching p3∧p5 or p1-alone or p5-alone
// 2. For each: compute truncation point, preview before/after length
// 3. Dry-run: print N samples
// 4. Batch re-embed truncated content via Voyage
// 5. UPDATE content + embedding in Supabase
// 6. Re-run eval to verify no regressions
```

## Why this is deferred (not fixed this round)

- **Out of scope for Phase 1b** (deletion phase) — this needs UPDATE + re-embed, not DELETE
- **Requires Voyage API spend** (~$0.03) plus the operational care of batched re-embeds
- **Requires integration-level testing** — we need to confirm re-embedding one chunk at a time doesn't break the IVFFlat index mid-flight
- **Should happen BEFORE the REINDEX** so the rebuild is against final clean content
- **Order of operations: 1b (done) → 1c (content-type reclassification) → 1d (trailing-boilerplate stripper) → REINDEX with lists=237**

## Known risks

- **Truncation at wrong position**: if a real game page happens to contain the string "POPULAR WIKIS" as part of legitimate content (unlikely but possible), we'd cut mid-content. Mitigation: sentinel `'Retrieved from "https://'` is extremely high-confidence (no legitimate game content includes that quote-delimited URL pattern); other sentinels are secondary.
- **Re-embedding quality drift**: small embedding distance shifts are expected but should be measured — re-run eval immediately after a batch to catch any Myurdin/NG+-style ranking disruption.
- **Partial batch failures**: if Voyage API rate-limits mid-batch, some chunks get new embeddings and others don't. Track `re_embedded_at` timestamp column so we can resume.

## Eval reference

Q5 "who is Oongka?" will likely still fail after Phase 1d alone — the root cause is `content_type='quest'` mismatching the `character` classifier (Phase 1c issue). But Phase 1d should:

- Shrink Oongka's chunk from 832 → ~300 chars (pure skill-list content)
- Bring the chunk's embedding closer to the query vector (no more footer-text diluting it)
- Improve ranking of similar "real content + trailing footer" chunks across the corpus
