# Learnings & Notes

Things discovered during development that are worth remembering across sessions.

---

## RAG: Phase 1c URL-Variant content_type Orphans Hid in Eval Seeds (Session 27 — comprehensive audit pass)

- **Phase 1c content_type updates targeted canonical URLs but didn't catch URL-variant duplicates** (e.g., `/Foo+Bar` vs `/Foo_Bar`). When the canonical URL was retagged, the variant URL kept its pre-1c content_type, and chunks at the variant URL stayed in the eval seed arrays as orphans — filtered out by the post-1c classifier. Phase 1d's comprehensive audit caught 3 of these in a single pass: New Game Plus (`09c7c77e` quest-tagged at `/New_Game_Plus`), Faded Abyss Artifact (`6db9fcd5` mechanic-tagged at `/Faded_Abyss_Artifact`), Hearty Grilled Seafood (`6147dcf9` item-tagged at `/Hearty+Grilled+Seafood`). Each query jumped 67%→100% or 33%→100% just by dropping the orphan.
- **The Phase 2 ingest rewrite must canonicalize URLs at ingest time.** Until then, future content_type bulk operations should explicitly scan for URL variants of every URL touched (`Foo+Bar` vs `Foo_Bar` vs `Foo Bar`), not just the canonical form.
- **Multi-seed eval arrays should reflect the genuine best answers for the query, not "every seed found at any time."** Including peripheral chunks dilutes the signal — a 6-seed array where 2 are strong and 4 are weak measures `33%` even when retrieval correctly finds the best 2. The Kailok hybrid (4-seed: 1 working Fextralife substantive-strategy chunk + 3 YouTube actionable-strategy chunks) is a cleaner pattern than 6-seed all-of-the-above. The audit verdict was binary in the script ("substantive → ADD, peripheral → SWAP"), but reality was mixed (1 substantive + 2 peripheral). The hybrid path — keep the working signal, swap the peripheral, add the better source — produced 100% recall with 4-of-4 ranking.
- **Comprehensive audit caught 4 fixes in one pass that incremental audits would have caught one-at-a-time over multiple rounds.** Phase 1d's first pass only re-seeded the 2 visibly-regressing queries (Oongka, Reed Devil). The comprehensive pass — running the full retrieval pipeline against all 15 queries and capturing top-10 with content heads — caught the 3 URL-variant orphans plus the Kailok pattern in one pass. Pattern: after major corpus mutations, do one comprehensive audit (not just regressed queries) once recall stabilizes.

---

## RAG: Routine Eval Seed Audits After Embedding-Mutating Phases (Session 27 — eval seed audit pass)

- **Phase 1d revealed an under-discussed eval pattern: when a chunk gets re-embedded with cleaner content, OTHER chunks on the same page may now rank higher because they're more semantically focused. The eval seed measures one specific chunk by ID, so a chunk losing its size advantage looks like a regression even though retrieval improved.** Both Oongka (100→0) and Reed Devil (0→0, "didn't move") fit this pattern. Updating their seeds to reference the now-#1-ranking chunks lifted measured recall by +14.1pp (52.6% → 66.7%) without touching any retrieval code.
- **Routine eval seed audits should follow any phase that touches embeddings, not just any phase that changes content_type.** Pattern checklist after an embedding mutation: (1) for each query whose recall dropped, check if expected chunks were in the mutation's candidate set, (2) pull the new top-10 and visually compare to seeds, (3) if top-10 has better content than the seeds, re-seed.
- **The "didn't move" diagnosis can be a misdiagnosis.** Reed Devil was the predicted Phase 1d target. When it stayed at 0% after 1d, my first read was "Phase 1d didn't help here, must be a different problem." Wrong. The diagnostic LEFT JOIN on `phase1d_candidates_20260426` revealed Reed Devil's seeds had `action = NULL` — they had no sentinel strings, were never 1d candidates. The reason recall stayed 0% was the eval was already wrong (had been wrong since session-26's seed audit didn't catch it), and 1d wasn't going to fix it because it didn't touch those chunks. **Always pull the candidate-set membership check before drawing conclusions about why a query "didn't move."**
- **Eval seeds for `re_embedded_at = NULL` chunks are paradoxically more reliable than seeds for re-embedded chunks.** New Oongka seeds (`204d0beb`, etc.) and new Reed Devil seeds (`c6f21822`, etc.) all have `re_embedded_at = NULL` — they were untouched by Phase 1d. They've always existed. Their ranking improved because the previously-#1 chunks lost their boilerplate-padding size advantage. **Stable seeds = chunks that haven't been mutated. Unstable seeds = chunks that have been mutated.** This argues for biasing eval seeds toward "untouched substantive content" chunks where possible.
- **Multi-seed arrays absorb embedding shifts gracefully.** Reed Devil pre-audit seeds were 3 chunks but they all happened to be the same kind of chunk (info-box / boss-list-tail / specific-skill). Post-audit seeds span phase-1 strategy + phase-2 strategy + game8 canonical — three different framings of the answer. If any retrieval round causes one chunk's embedding to shift, the others still cover the query.

---

## RAG: Phase 1d Trailing-Boilerplate Stripper Worked, But Surfaced Eval Sensitivity (Session 27)

- **Trailing-boilerplate stripping requires per-chunk truncation logic, not bulk deletion.** The 150-char minimum-after-truncation threshold cleanly separated "thin remainder = page title only or sibling-link nav" (DELETE) from "real content with trailing footer" (TRUNCATE + re-embed). 0/20 DELETE-bucket spot-check showed any real content lost. 2,914 truncated, 748 deleted, 0 failures, 42 sec wall time, $0.006 Voyage cost.
- **Pagination without ORDER BY produces non-deterministic results.** Two consecutive `--dry-run` calls returned 3,194 vs 3,662 candidates because `.range(offset, offset+999)` without `.order("id")` lets Postgres pick any physical-order. Always order by a stable column when paginating with `.range()`. The instability was small (3% drift) but enough to confuse "did the candidate set just change underneath us?" debugging.
- **Anon-client statement_timeout (8s) is too short for ILIKE+ORDER BY scans over 60K+ rows.** First `--execute` attempt failed at Phase A with "canceling statement due to statement timeout" — the `.ilike("source_url", "%fextralife%").ilike("content", "%sentinel%").order("id")` plan does a sequential scan + sort, which exceeds 8s for 63K rows. Service-role client has higher timeout (likely 60s+) and ran the same query in 1-2 seconds. **Pattern: any analytics-style read scan from scripts should use service-role**, not anon. Anon's timeout is a production-protection feature for the chat API, not a script-friendly default.
- **Eval seeds are fragile to corpus mutations even when the corpus mutation is "good."** Phase 1d truncated Oongka's expected_chunk_id from 832 → 249 chars. The truncation removed boilerplate but also removed the size advantage that was making this chunk rank #1 for "who is Oongka?". Post-1d, OTHER Oongka chunks (which always existed but never ranked first) now rank above it because they have actually-descriptive content like "Oongka is a character that..." while the truncated one is mostly skill-list. **Result: eval recall went 100% → 0% on Oongka while retrieval got better, not worse.** Lesson: any time a single-chunk eval seed gets touched by a corpus mutation, expect the seed to need re-auditing. Multi-seed arrays absorb this kind of shift gracefully; single-seed arrays are brittle.
- **Voyage's 16M TPM / 2,000 RPM rate limit is generous enough to be irrelevant at our scale.** 2,914 chunks × 32 batch = 92 calls. Even at concurrency=4 we never tripped the rate-limit pool's pause logic. The infrastructure was kept for safety on future larger runs (full corpus re-embed, etc.).
- **`maintenance_work_mem` matters for embedding upserts too, not just CREATE INDEX.** Wasn't a problem this round but worth noting — when we eventually do a full corpus re-embed, the IVFFlat index doesn't get rebuilt mid-flight; new vectors are inserted into existing clusters. After ~5% of rows shift, query quality may drift. Plan for a REINDEX after major embedding-mutating phases.

---

## RAG: IVFFlat with lists=sqrt(rows) is REQUIRED for stable retrieval (Session 26 — REINDEX round)

- **At lists=100 against 63K rows, probe tuning could not stabilize the eval.** Every probes value tested (10, 20, 30) had pathological behavior: 10 had cluster-shift regressions after content_type churn, 20 had ±6.7pp run-to-run variance from Voyage embedding micro-variation, 30 had statement timeouts. Rebuilding the index with `lists=237` (≈ sqrt(63,552)) eliminated all three problems simultaneously: 0pp variance across 3 consecutive runs, no timeouts, +15.6pp recall on the lower bound.
- **Saving REINDEX "until end of Phase 1" was a mistake** — should have rebuilt sooner once the corpus shape stabilized after Phase 1c. The 2-3 sessions spent on probes tuning were chasing a problem the actual fix would resolve in 5 minutes of CREATE INDEX.
- **Lesson: IVFFlat is sized for the data shape, not the final-target shape. Resize whenever you've removed >10% of rows.** Phase 1a removed 19,634 rows (22%), Phase 1b removed 7,209 more (10%), Phase 1c retagged 11,669 chunks (didn't change row count but invalidated cluster centroids). Cumulatively the index was 32% mis-sized before this REINDEX.
- **Two unexpected eval wins emerged after REINDEX**: Toll of Hernand (0% → 67%) and best body armor (0% → 67%). Both queries had been at the "cluster boundary" — the right chunks existed in the corpus but lived in clusters that probes=10 at lists=100 wasn't reliably scanning. Smaller, tighter clusters at lists=237 surfaced them deterministically. **Translation: a portion of every "still-failing" query in earlier rounds was actually index-sizing failure, not a content/classifier failure.** Always REINDEX before drawing conclusions about what content or classifier changes a corpus needs.
- **`maintenance_work_mem` matters for IVFFlat builds.** Default Supabase setting (32MB) was insufficient for 63K × 1024-dim — Postgres errored with "memory required is 61 MB". Bumping to 256MB worked. For an HNSW migration this would be even higher.
- **MCP `apply_migration` wraps DDL in a transaction with a default timeout that's too short for IVFFlat CREATE INDEX.** Workaround: drop via execute_sql (atomic), then issue CREATE via execute_sql with `SET maintenance_work_mem` and `SET statement_timeout='15min'` in the same query. The MCP call itself will time out after ~2 minutes, but the build continues on Postgres independent of the connection. Poll `pg_stat_activity` for completion. Record the operation as an audit-only migration after the fact for changelog hygiene.

---

## RAG: Eval Seed Quality Is Part of the System (Session 26 — eval audit round)

- **A "failing" query with a boilerplate seed measures the seed, not the system.** Phase 1 caught 4 bad seeds across 15 queries (Q1 Saint's Necklace originally, Q4 Toll of Hernand replaced earlier, Q11 best one-handed weapons, Q13 Faded Abyss Artifact). When chasing remaining 0%-recall queries through retrieval/classifier/index changes, every dollar of effort spent before auditing the seeds produces at best a misattributed win (system change "fixes" a query that the seed itself was preventing) and at worst no movement at all (system change does nothing because the seed will never be reachable regardless of retrieval quality).
- **Routine eval seed audits should happen after every major corpus change.** Phase 1c retagged 11,669 chunks across content_types — many of those chunks were eval seeds whose neighbors in the chunk-content-type pool changed dramatically. Phase 1d will re-embed ~6,000 chunks; an audit pass after that is non-negotiable. **Pattern: corpus mutation → eval seed audit → measurement → next phase.**
- **The audit's value isn't the recall number bump (+7.7pp this round) — it's that subsequent phases now produce trustworthy attribution.** When Reed Devil stayed at 0% after a 3-seed extension with all-substantive content chunks, that is *information*: it tells us the residual failure is Phase 1d territory (trailing-boilerplate dilution) and not seed-quality. Without the audit, that diagnosis would have been muddied by the lingering question "is the seed even right?".
- **Audit pattern that works**: pull every chunk on the seed's source_url ordered by content length, visually compare each first-200 chars to the query, identify the actual best-answer chunk(s). Most pages have 5–15 chunks ranging from substantive content (~600+ chars) to pure nav/footer (~250–300 chars). The right seed is almost never the single longest chunk (often that's a real-content + trailing-boilerplate concatenation) — it's the chunk whose first 200 chars contain a direct answer to the query.
- **Multi-seed arrays are more robust than single-seed.** Where the source page has 2-3 substantive content chunks (description + walkthrough + drops), seed all of them. Multi-seed gives the eval a "any of these found = success" semantic, which matches what users actually want from retrieval. Single-seed forces a specific chunk to rank, which is fragile to corpus shifts.
- **Sometimes the right move is to SHRINK the seed array.** Sanctum of Temperance had 3 seeds where one was pure boilerplate; replacing it with another boilerplate chunk would have been worse than dropping the boilerplate entirely and letting the eval measure honesty (1/2 = 50% is a real signal; 1/3 = 33% with one impossible-to-rank chunk in the denominator is noise).
- **Cross-subdomain canonicalization matters more than expected.** Faded Abyss Artifact's best functional-description chunk (`6db9fcd5`) lives at the `/Faded_Abyss_Artifact` URL but is `mechanic`-tagged, while `a1cf377e` and `58537084` at the *same URL* are `item`-tagged. Phase 1c canonicalized URLs to one content_type but missed the dual-subdomain pattern (`crimsondesert.wiki.fextralife.com` vs `crimsondesertgame.wiki.fextralife.com`). This is a Phase 2+ ingest concern — when re-crawling, dedupe across subdomains before chunking.

---

## REINDEX rollback artifact (session 26)

If the lists=237 REINDEX needs to be reverted, recreate with the previous lists=100 definition:

```sql
DROP INDEX IF EXISTS idx_chunks_embedding;
CREATE INDEX idx_chunks_embedding
  ON public.knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
-- Then re-set probes inside match_knowledge_chunks() to 20:
-- PERFORM set_config('ivfflat.probes', '20', true);
```

The probes=20 vs probes=10 setting is independent of the index lists — both can be tuned separately.

---

## RAG: IVFFlat Probe Tuning Cannot Compensate for Bad `lists` Sizing (Session 26 — probes round)

- **Mass content_type changes (>~10% of a pool) trigger IVFFlat cluster instability that requires probe tuning. The pattern recurs at higher density thresholds** — probes=10 was sufficient post-Phase-1a (removed 19,634 chunks across all types) but insufficient post-Phase-1c (removed ~5,000 chunks from character alone). Future bulk reclassification or deletion should anticipate a probes adjustment as part of the round.
- **Probes-bumping past a point introduces statement timeouts.** probes=30 at threshold=0.25 made the IVFFlat scan slow enough that the first warm-up RPC after a `CREATE OR REPLACE FUNCTION` triggered a 30s statement timeout. probes=20 didn't have this issue. The right-of-way isn't more probes — it's smaller `lists` so each cluster is closer to query centroids on average.
- **Triple-run stability check is the right diagnostic for IVFFlat queries.** Single-run results lie when probe coverage is borderline. At probes=20, the same Oongka query produced pool=28 success in 1/3 runs and pool=8 fallback in 2/3 runs across consecutive eval invocations. Voyage embedding micro-variation (<0.001 between calls) is enough to shift IVFFlat's cluster ordering when the relevant cluster centroid is near the boundary of the top-N probed clusters. Always run an eval ≥3 times when comparing probes settings; report the distribution, not the point.
- **The actual fix is REINDEX with `lists=237` (≈ rows/1000 for 63K rows).** Current `lists=100` was set when the DB had ~17K rows and is undersized for 63K. With `lists=100` each cluster averages 635 vectors — too many for the centroid to be representative; some clusters become "topic mixtures" that match no query well. Smaller buckets (≈265 vectors per cluster at lists=237) tighten cluster cohesion. Deferred to end of Phase 1.
- **Probes setting interacts with `match_threshold`.** At threshold=0.25, the SQL has to filter many candidates per cluster — slow. At threshold=0.5 (the function default), much fewer candidates pass — fast even with high probes. The eval intentionally uses 0.25 to surface marginal candidates for analysis; production may want 0.5 for stability.
- **Net result**: Settled on probes=20 because probes=30 has timeouts, probes=10 has the Oongka regression. probes=20 has variance — recall ranges 31.1%–37.8% across runs depending on whether Oongka's cluster gets scanned. **Lower bound (31.1%) is unchanged from probes=10 era; upper bound (37.8%) is new.** Real fix is REINDEX, not probe tuning.

---

## RAG: Eval Seed Quality Is Independent of Classifier And Retrieval (Session 26 — Faded Abyss Artifact diagnosis)

- **A seed that points at a real chunk is not the same as a seed that points at the *right* chunk for the query.** Faded Abyss Artifact's seed `a417c884` was the longest chunk on the Faded_Abyss_Artifact URL (942 chars) but contained zero functional description of what the artifact does — it's a trailing list of related items + a "notes/tips/trivia goes here" placeholder + a navigation list of all gatherables. Even at perfect retrieval the eval would correctly NOT rank this chunk for "how does the Faded Abyss Artifact work?", because the chunk doesn't answer the query.
- **Eval seed audit pattern that works**: pull top-10 chunks at the same source_url ordered by content length, visually compare each to the query, identify the actual best-answer chunk(s). The right seed for "how does X work?" is the chunk whose first 200 chars contain a functional description of X.
- **Re-seeding after Phase 1c is a pattern to expect**, because URL retags can shift which chunks live in the right content_type pool. The original seed for Faded Abyss Artifact may have been chosen when the chunk was mechanic-typed pre-1c; after the retag to item, better-content chunks at the same URL are now also item-typed and should be the new seed.
- **Two of Faded Abyss Artifact's substantive chunks are still mechanic-typed** post-1c — likely because they came from the `crimsondesertgame.wiki.fextralife.com` subdomain (different from the canonical `crimsondesert.wiki.fextralife.com`) and weren't enumerated in Phase 1c's distinct-URL fetch. **Cross-subdomain URL canonicalization is a Phase 2+ ingest concern** that this round surfaces but doesn't address.

---

## RAG: Classifier Waterfalls Have Ordering Dependencies (Session 26 — classifier alignment round)

- **Corpus alignment and classifier alignment are TWO halves of the same fix; doing only one delivers a fraction of the gain.** Faded Abyss Artifact was the textbook case: corpus right (`item` after Phase 1c retag), classifier wrong (`mechanic` regex caught `abyss artifact` keyword + `how does .+ work`), query still failed. Saint's Necklace was the inverse — classifier had been routing it to item but `getItemPhrases`' `where (is|are) the` was too greedy, scoping a too-narrow item subpool that excluded the canonical chunks. Removing that one phrase pattern + reordering exploration above item lifted it from 0% → 100% recall.
- **Moving EXPLORATION before ITEM was required for Sanctum-style location queries.** "Where is the Sanctum of Temperance?" matches both `where (is|are) the` (item) AND `sanctum` (exploration). With item first, every Sanctum query was scoping to a subpool that didn't contain location chunks. The reorder is the entire fix; no keyword change required for that query specifically.
- **Adding new keywords (`artifact`) at the right layer of the waterfall is more reliable than broadening earlier layers.** The original instinct was to narrow the mechanic regex (remove `how does .+ work`) — but that breaks legitimate "how does the parry system work" queries. Better fix: add `artifact` to itemKeywords AND reorder so item fires before mechanic. Each layer keeps its broad rule; the order resolves the ambiguity.
- **When you reorder a waterfall, audit for downstream interactions.** Moving ITEM above MECHANIC for the artifact fix accidentally meant RECOMMENDATION fired AFTER ITEM, so "best one-handed weapons" matched `weapon` in itemKeywords and routed to item before recommendation could null-out. Caught the bug before measuring; required also lifting RECOMMENDATION + BEST [modifier] above ITEM. Lesson: the safe order is null-returning patterns first, then specific-type patterns last; never let a `return "type"` block precede a `return null` block that depends on the same keywords.
- **Eval has its own copy of `classifyContentType()` in `scripts/run-eval.ts`** — it is NOT imported from `route.ts`. Any classifier change must be mirrored in both files or the eval will measure the OLD classifier against the new corpus, producing meaningless numbers. Add a comment marker to remind future-you, or refactor to a shared module (deferred — not blocking).
- **Cluster instability after large content_type churn**: post-Phase-1c, the `character` content_type lost ~5,000 chunks (mostly retagged to item/exploration/quest). The remaining 33 Oongka chunks are still character-typed but the IVFFlat cluster centroid for the `character` filter shifted enough that the filtered RPC at probes=10 returned 0 results for "who is Oongka?", forcing fallback. Pre-1c: pool=28, top-sim 0.775. Post-classifier-alignment: pool=8 (fallback), top-sim 0.540. Same pattern as the Phase 1a NG+ regression (cluster shift after mass change). **Bumping probes 10→20 is the likely fix; deferred to a separate measured round so the impact is attributable.**
- **Net classifier-alignment delta**: +2.2pp recall (28.9% → 31.1%), +0.066 MRR (0.171 → 0.237). MRR jump is bigger than recall jump because Saint's Necklace went 0% → 100% with all 3 expected chunks in top-4 (RR=1.000), so the round produced one big rank-1 win. Two clean wins (Saint's Necklace, Sanctum), one regression (Oongka), zero changes elsewhere.

---

## RAG: Phase 1a Byte-Identical Dedup Is Necessary But Insufficient (Session 26)

- **Multi-category crawl pollution survives byte-identical dedup**: when a single Fextralife page is enumerated under N category indexes (e.g. `/Bosses`, `/Quests`, `/Characters`), the crawler produces N cached JSON files. The chunker may produce *near-identical-but-not-byte-identical* text from each, so Phase 1a's `(content, source_url)` byte-identical group-by leaves them in place, each tagged with a different `content_type`. Phase 1c's audit caught this in **69 URLs / 1,230 chunks** out of the 1,007 reclassified URLs. The page would partially-update under Phase 1c's matched-old-type safety check, leaving residual chunks at non-target types.
- **Symptom to look for**: after a content_type UPDATE that uses a matched-old-type safety clause, a non-trivial slice of URLs end up in a "mixed_partial" state — they have the new type AND other types simultaneously. Audit query: `GROUP BY source_url HAVING COUNT(DISTINCT content_type) > 1 AND BOOL_OR(content_type = new_type)`.
- **Spot-check before re-running UPDATE without the safety clause**: 15-chunk visual inspection across (largest residual URL, semantic-far residuals, random) showed ~80% real content / 7% boilerplate / 13% mixed. Real-content dominance justified relabeling; boilerplate/mixed minorities deferred to Phase 1d's trailing-boilerplate stripper. Without the spot-check, blind UPDATE would have been correct anyway here, but the discipline prevents over-confidence — same discipline that saved 1,300 chunks in Phase 1b's `p3∧p5` cutoff.
- **Phase 2+ ingest must canonicalize at URL level, not chunk level**: the right long-term fix is enforcing one URL = one canonical content_type at ingest, before chunking. Chunk-level canonicalization is doomed because near-identical chunks from different category crawls embed slightly differently.
- **Page-level vs chunk-level content_type is a forced choice with trade-offs**: Phase 1c assumes one URL = one canonical type. For pages whose content actually spans types (e.g. `/Mystical_Key` documented as both a key item AND a quest objective; `/Greymane_Camp` as both a location AND home to characters), chunk-level tagging would be more accurate. **This is a Phase 2+ refinement, not a Phase 1c blocker** — page-level canonicalization gets you most of the win at a fraction of the engineering cost. Revisit when we have a corpus where chunk-level disambiguation is the dominant remaining error mode.
- **Bucket A apply on 1,007 URLs / 11,669 chunks delivered +2.2pp recall** (26.7% → 28.9%). Modest delta; most of the projected lift is pending classifier alignment. Did-NOT-move analysis on the 9 previously-failing queries showed 4 of 6 still-failing are direct classifier-alignment targets (Sanctum of Temperance, Faded Abyss Artifact, best-X tier-list queries), 2 are eval-seed/Phase-1d targets (Kailok, Reed Devil). This split confirms the "measure corpus update in isolation, then classifier alignment in isolation" methodology — without the split we'd attribute everything to "Phase 1c" and miss that the classifier knobs are the bigger remaining lever.

---

## Meta: Measure in Isolation Before Optimizing

Hypotheses are cheap, measurements are truth. Every round in this project that produced a measurable win came from (1) forming a specific hypothesis, (2) making one change, (3) measuring against a stable eval set, (4) investigating regressions before proceeding. Every round that produced noise came from stacking fixes without measurement between them.

---

## RAG: Boilerplate Deletion Without Destroying Mixed-Content Chunks (Session 25)

- **Spot-check before committing to a pattern at scale**: what reads like "clearly boilerplate" in a 20-sample spot-check may be 73% false-positives at 1,000+ samples. Specifically, `POPULAR WIKIS + Retrieved-from` co-occurrence looks like pure-boilerplate at first but at length ≥ 700 is dominantly mixed-content (real game content at the top, Fextralife footer concatenated at the bottom). Always sample at the length band you're about to act on, not an arbitrary 20 rows across all lengths.
- **Chunk content is allowed to be partially boilerplate**: RAG chunks are ~500–800 chars and are produced by a naive text extractor, so it's common for a chunk to contain 300 chars of real content + 500 chars of trailing nav/ad/footer text. DELETE of these chunks is destructive; the correct fix is a content-level UPDATE (truncate at the first boilerplate sentinel) followed by re-embedding. Don't conflate "chunk matches a boilerplate pattern" with "chunk IS boilerplate."
- **Sentinel-based truncation is more reliable than regex-of-whole-chunk**: for mixed-content chunks, find the first occurrence of a high-confidence sentinel string (`Retrieved from "https://`, `POPULAR WIKIS`, `Join the page discussion`, `FextraLife is part of the Valnet`, `Copyright © Valnet Inc`) and truncate from that point. This is a surgical edit that preserves real content. Sentinel priority matters — put `Retrieved from "https://` first since it's extremely unlikely to appear in legitimate game content.
- **"Nav sidebar" (p7) is reliably pure**: a chunk where ≥3 of {General Information, World Information, Equipment, Character Information, Interactive Map} appear is 15/15 pure navigation in spot-checks. These chunks are artifacts of the extractor grabbing the whole left-sidebar-nav once per page, no content bleed. Safe to DELETE.
- **"Login prompt" (p6) is reliably pure**: chunks containing both `anonymous` and `Sign in`/`Log in` are the Fextralife "login required" block at the top of every page. Also safe to DELETE.
- **Co-occurrence of MediaWiki + another boilerplate pattern is safe; MediaWiki alone is NOT**: MediaWiki's "Recent changes / Random page" nav can appear in the middle of a chunk that also contains real content (e.g. `/Equestrian_II`: nav + "Equestrian II / Abyss Core / +2 Horse EXP Gain"). Require p1 to co-occur with p3 or p5 before trusting it as pure boilerplate.
- **Ever-tightening rules produce small safe wins rather than one big unsafe win**: we started with 13,733 candidates (too loose), tightened to 9,879 (safer), then tightened again to 7,209 (safe). Each tightening removed a specific risk class (p5-alone → Flame_Rush risk, p3∧p5 → bow stats risk). Final ruleset is slower to delete but zero false-positives in spot-checks.
- **Eval seeds can themselves be boilerplate**: during the session-25 eval-collision check, 2 of 3 Toll of Hernand expected_chunk_ids turned out to be pure nav sidebar text. They were "valid" seeds in the sense that they pointed at real chunk IDs, but the chunks contained no quest content. **Spot-check the CONTENT of eval seeds before trusting a 0% recall as a real failure signal** — sometimes the 0% just means retrieval correctly avoided the broken eval target. The Q1 Myurdin case from session 24 was the first instance; Toll of Hernand is the second.
- **When a mass-DELETE has flat eval impact, don't read that as "no value"**: Phase 1b deleted 7,209 chunks with zero per-query eval delta. This doesn't mean the delete was useless — it means the deleted chunks weren't already displacing real content at rank ≤10 for our 15 test queries. The wins land in (a) broader arbitrary user queries not in the eval set, (b) reduced IVFFlat cluster noise, (c) tighter fallback candidate pools, (d) smaller corpus for the eventual REINDEX. Don't only judge cleanup by the ~15-query recall metric.

## RAG: IVFFlat Index Tuning (Session 24)

- **Verify the index type before tuning** — we had documentation claiming HNSW since session 17 but `\d knowledge_chunks` showed **IVFFlat lists=100**. Wrong index type = wrong tuning knob. `SELECT indexdef FROM pg_indexes WHERE tablename='knowledge_chunks'` is the source of truth, not memory or old docs.
- **IVFFlat `probes=1` default is too sparse** for 70K+ chunks with `lists=100`. Each query examines only 1% of vectors; deletions from specific clusters can shift which cluster "wins" for a given query, causing expected chunks to drop out of top-N. Bump to **probes=10** as a baseline; consider probes=20 if queries miss frequently.
- **Supabase blocks `ALTER DATABASE ... SET ivfflat.probes`** and also blocks `SET ivfflat.probes = ...` as a function attribute (CREATE FUNCTION ... SET ivfflat.probes = 10). Permission denied. The only working persistent mechanism is `PERFORM set_config('ivfflat.probes', '10', true)` inside the function body — runtime, transaction-local, applied on every call.
- **IVFFlat is sensitive to mass DELETEs** — the cluster assignments are baked into the index at build time, but the centroids shift their "best-matching-neighbors" ranking as members are removed. If you delete 10%+ of rows, expect per-query recall to drift in either direction. Schedule a REINDEX after large deletions.
- **`lists` should be tuned to row count**: pgvector recommends `lists = rows / 1000` for up to 1M rows, `sqrt(rows)` above that. With 70K rows we should have `lists ≈ 237`; we have `lists=100` (undersized). REINDEX with the corrected `lists` deferred to end of cleanup phase so the rebuild happens against the final row count.

## RAG: Corpus Pollution from Multi-Category Crawls (Session 24)

- **Flat-URL wikis get double-ingested when the crawler enumerates by category**: if the same page (e.g. `/Myurdin`) is linked from `/Bosses`, `/Quests`, `/Characters`, and `/Skills` index pages, a category-scoped crawler will follow the link from each index and save four separate cached JSON files, each tagged with a different `content_type`. The downstream ingest then produces 4× the chunks, all byte-identical in content but distinguished only by the category they were discovered from.
- **Symptoms**: a single URL with 5–7 distinct `content_type` labels. Running `GROUP BY source_url HAVING COUNT(DISTINCT content_type) > 1` quickly identifies the polluted set.
- **Byte-identical cross-type dedup is safe**: collapse `(content, source_url)` groups that span multiple types to a single row. Pick the canonical type by a priority order; any priority is fine as long as it's deterministic. Content-type label on a deduped boilerplate chunk barely matters because it'll usually get deleted in the next phase (boilerplate removal).
- **When `retrieval_eval.expected_chunk_ids` points at byte-identical dupes**, collapse the array to just the surviving UUID *before* the dedup runs. Otherwise the eval recall denominator stays at 3 while only 1 chunk remains, causing apparent recall regression when retrieval is actually fine.
- **Semantic HTML5 nav stripping is insufficient for div-based wikis**: `stripHtml()` that removes `<nav>`/`<footer>`/`<header>` doesn't help when Fextralife wraps its sidebar and footer in `<div class="col-sm-3">` and similar class-based containers. Need CSS-class-aware end markers in `extractMainContent()` or a switch to a DOM parser that respects selectors.
- **`extractMainContent()` end markers are fragile**: a regex that cuts content at `.side-bar-right` or `#fxt-footer` only works if that exact marker appears *after* the content start marker. If the sidebar div is nested inside the content wrapper, the cut-off triggers at the start of the sidebar and the real content is lost; OR if the marker doesn't appear at all, every byte of the page (including ads and footer) flows into the extracted text.
- **URL-encoding variants are a duplicate-page vector**: `/New_Game_Plus` and `/New+Game+Plus` are both live on Fextralife as separate pages with slightly different chunking. Any URL-canonicalization pass should normalize both to one form before dedup.
- **Interactive map deep-links proliferate**: `/Interactive+Map?id=N&code=mapA` with 32 different `id` values all produce near-identical chunks of map-nav text. Should be filtered at crawler or ingest time.

## RAG: Eval Hygiene & Scorecard Methodology (Session 24)

- **Measure recall on a fixed eval set, not ad-hoc queries**: a 15-query eval in a SQL table (`retrieval_eval` with `query text, expected_chunk_ids uuid[]`) is enough signal to detect 6pp-level regressions. Running it before and after every retrieval change surfaces accidental regressions immediately.
- **"Expected chunk IDs" drift when the corpus changes**: every ingest, re-crawl, or dedup can invalidate the eval's expected IDs. Build a backup table of the eval BEFORE any destructive change: `CREATE TABLE retrieval_eval_backup_<date> AS SELECT * FROM retrieval_eval`.
- **Eval seeds can be wrong in silent ways**: Q1 of our eval was pointing at a nav-boilerplate chunk that was easy to retrieve. It scored 100% recall but the retrieval was garbage. Spot-check eval seeds by reading the expected content — if it looks like "© 2012-2025 Fextralife Popular Wikis Elden Ring 4,426 pages", the seed is broken.
- **Keep a Recall@10 + MRR scorecard across sessions**: MRR catches ranking regressions that Recall@10 misses (a chunk moving from rank 1 to rank 10 has the same Recall@10 but a 10× worse MRR). When one goes up and the other goes down, investigate the specific query.
- **A single regressed query can tank MRR while Recall@10 stays flat**: Phase 1a dedup made Myurdin +67% and NG+ -67% — recall cancelled out at 20% flat, but MRR dropped 0.189 → 0.165 because NG+'s hit had been at rank 2 (RR=0.500) and Myurdin's new hits were at rank 7-8 (RR=0.143). Per-query deltas matter more than the mean.

## RAG: Safe-Ops Checklist for Mass DELETEs (Session 24)

Before running any bulk DELETE on a production table:
1. **Backup the affected subset** (`CREATE TABLE <name>_backup_<date> AS SELECT ...`). Confirm row count equals live.
2. **Stage the delete IDs in a temp table** (`CREATE TABLE <op>_to_delete_<date> AS SELECT id ...`). Makes rollback a trivial INSERT-FROM-backup and lets you re-audit what would be deleted without re-running the query logic.
3. **Check for eval collisions** (any `retrieval_eval.expected_chunk_ids` in the delete staging). Stop and reconcile before proceeding.
4. **Rollback smoke-test**: DELETE 1 sample row → INSERT it back from backup → confirm count matches and row contents restored. Catches backup-table schema mismatches or missing columns.
5. **Execute with timestamp around the DELETE**: record `now()` before and after so you have a reliable execution-time measurement for future capacity planning.
6. **Spot-check N samples from the "winners"** (rows that survive when dupes are collapsed). Verify the kept row contains real content, not boilerplate.
7. **Re-run eval immediately after DELETE** — don't batch multiple destructive changes between evals, it makes regression attribution impossible.

## RAG: Query Classifier Ordering & Edge Cases

- **Food + boss co-occurrence breaks naive ordering**: A query like "what food should I eat before a boss fight" contains "fight" (a boss verb) AND food-related terms. If the food classifier comes AFTER the boss classifier, the query routes to boss content. Fix: food/consumable classifier must come **before** the boss classifier. General rule: classifiers that are easily confused with more-specific classifiers must precede them.
- **Versus/comparison queries are a separate classifier, not a recommendation**: "Hwando vs Sielos Longsword" and "sword or spear which is better" contain item keywords that would filter to `content_type = "item"`. But these queries need tier-list/guide content from `mechanic` to answer which is better. Add an explicit versus classifier BEFORE the item classifier that returns `null` (full search). Pattern: `\b(vs\.?|versus)\b|better than\b|(sword|spear|...) (or|vs) \w`.
- **Off-topic detection must not false-positive on game terms**: The off-topic guard must check for game context FIRST before applying the off-topic regex. A query like "how do I fight the boss" contains "fight" which might match off-topic patterns. Solution: check for any game noun (boss, weapon, skill, quest, abyss, etc.) first — if found, skip the off-topic check entirely.
- **Off-topic check must come AFTER `randomNoInfo()` is defined**: In a function body, `const randomNoInfo = () => ...` is not hoisted. If the off-topic short-circuit calls `randomNoInfo()` before that const is declared, it will throw `ReferenceError`. Place the off-topic check immediately after `randomNoInfo` is assigned.
- **List queries need a dramatically higher matchCount**: "List all bosses" needs 15–20 candidates to be useful; with the normal 8-chunk cap the response covers only a fraction of bosses. Add an `isListQuery()` helper and set `effectiveMatchCount = 20` for those queries. Normal recommendation query boost (+4) is insufficient for catalogue-style questions.
- **Test your classifiers in isolation with a unit test file**: Create a `.mjs` unit test (e.g. `scripts/test-classifiers.mjs`) that runs the classifier functions against a matrix of expected inputs/outputs and prints ✅/❌. This catches ordering bugs and regex escaping errors before they hit the pipeline. Run with `node scripts/test-classifiers.mjs` — no build required, near-instant feedback.
- **New system-level content types need their own classifier entry**: When adding game8 tier-list / guide content as `mechanic` type, ensure queries about camps, mounts, factions, and endgame are routed to `mechanic`. Without explicit entries, these fall through to `null` (fine for retrieval quality but wastes vector search time scanning all types). Each new game system you add content for should have a corresponding classifier entry.

## RAG: Admin Dashboard + Service Role Key

- **Anon key is blocked by RLS on admin-accessed tables**: The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is blocked by RLS policies on sensitive tables like `users`, `queries`, and `error_logs`. Admin routes that use the anon key silently return empty arrays — no error, just 0 rows. **Fix: admin routes must use `SUPABASE_SERVICE_ROLE_KEY`** to bypass RLS. This key must be server-side only (never `NEXT_PUBLIC_`).
- **Symptom is silent**: The admin dashboard shows "0 queries today", "0 users", "0 errors" even when data clearly exists. The Supabase JS client returns `{ data: [], error: null }` — the RLS policy silently filters all rows. There is no warning that results are being filtered.
- **Service role key must be in Vercel env vars, not just `.env.local`**: Local dev works fine with `.env.local`, but Vercel won't see it unless explicitly added via Vercel dashboard → Settings → Environment Variables. After adding, a redeploy is required.

## Stripe Integration with Supabase Auth

- **Use `metadata.supabase_user_id` to bridge Stripe and Supabase**: Stripe webhooks don't know which Supabase user triggered the payment. Pass `supabase_user_id` in the Checkout Session `metadata` field at creation time. The webhook then reads `session.metadata.supabase_user_id` to update the correct user row.
- **Persist `stripe_customer_id` on first checkout, reuse on subsequent checkouts**: Before creating a new Checkout Session, look up the user's `stripe_customer_id` in Supabase. If it exists, pass it as the `customer` param to Stripe — this links all subscriptions, invoices, and portal sessions to one Stripe customer. If not, let Stripe create a new customer and save the resulting ID back to Supabase.
- **Raw request body is required for webhook signature verification**: `stripe.webhooks.constructEvent()` requires the raw, unparsed request body (not `req.json()`). Use `await req.text()` to get the raw string, then pass it alongside the `Stripe-Signature` header. If you pass a parsed JSON object, the HMAC signature will not match and every webhook call will be rejected.
- **Billing Portal requires activation in Stripe dashboard**: The `/api/stripe/portal` route will fail with a Stripe API error until you enable the Customer Portal in Stripe Settings → Billing → Customer Portal. It's not on by default.
- **`force-dynamic` is required on webhook routes**: Vercel may attempt to statically optimize API routes that have no dynamic data. Add `export const dynamic = "force-dynamic"` to webhook routes so they're always server-rendered and never cached.

## RAG: Chunk Count vs DB Size Relationship

- **~111k chunks is the current DB size** — classify queries that scan all types carefully. Full unfiltered vector search over 111k chunks is significantly more expensive (IO, latency) than filtered search over 10–15k chunks for a specific content type. Each new content type added should come with a corresponding classifier entry.
- **game8 pages are numeric archive IDs in URLs** — `game8.co/games/Crimson-Desert/archives/584395`. URL-match keyword boost works on Fextralife (URLs contain page names like `/Hwando+Sword`) but NOT on game8 archive IDs. For game8 content, rely on content-start boosting (page title is prepended to chunk text during ingest) rather than URL matching.

## RAG: Chunk Splitting & Overlap

- **Target chunk size ~500 chars for voyage-3.5-lite**: Larger chunks (>800 chars) dilute the embedding signal — the vector tries to represent too many concepts at once. Splitting into 500-char sub-chunks gives each embedding a focused meaning.
- **Intra-section overlap (150 chars)**: When a long section splits, carry the last 150 chars forward as the start of the next sub-chunk. This ensures facts that span the split boundary appear in at least one chunk that contains both sides.
- **Inter-section overlap (120 chars)**: Prepend the tail of the previous `### Section` to the next section's first chunk. This captures cross-boundary facts — e.g. an item's effect described at the end of "Overview" and referenced in "Stats".
- **Break at natural boundaries**: When splitting, try paragraph break (`\n\n`) first, then sentence end (`.!?`), then line break (`\n`), then word boundary (` `). Never cut mid-word.
- **Item pages are the main chunking problem**: avg 666 chars, 303 over 1500 chars. Other content types (boss, quest, exploration) are already short enough at 250-300 avg chars.
- **Dry-run validate before re-ingesting**: Use `--dry-run --category <name>` to verify chunk counts and sample content before burning Voyage API credits on a full re-ingest.

## RAG: Metadata Pre-filtering

- **Content type filter pattern**: Add an optional `content_type_filter TEXT DEFAULT NULL` to the RPC. When set, it narrows the cosine similarity search to a single content type — boss questions only scan ~400 chunks instead of 6000+. pgvector's IVFFlat index still applies within the filtered set.
- **Always add an unfiltered fallback**: If the filtered RPC returns 0 results, retry without the filter before giving up. Some items live in unexpected categories (e.g. Crow's Pursuit is `abyss-gear` not generic `item`).
- **Classifier ordering matters — specific before generic**: Check boss names/verbs first (very specific), then recipe (before item, since "how to craft" could match item too), then item, then quest, etc. First match wins — ambiguous questions should return `null`. **Specifically: put exploration ABOVE mechanic.** A bare `\bhow do\b` in the mechanic regex will happily match "How do I solve the Azure Moon Labyrinth?" and misroute to mechanic. Either put exploration first so `labyrinth` catches it, or remove the bare catch-alls from mechanic and keep only specific phrasings like `how does .+ work`.
- **Beware catch-all verb phrases in specific regexes**: A `/how do/` or `/how does/` token inside a topic-specific regex will swallow questions that are about specific items/locations/bosses. Prefer specific companion terms (`how does the .+ work`, `how do i (solve|get|reach)`) over bare verb fragments.
- **`character` is a reserved word in PostgreSQL**: Quoting as `"character"` is required in both the RETURNS TABLE and SELECT inside the function body.
- **Don't create overloaded RPC functions via `CREATE OR REPLACE FUNCTION` with different signatures**: Supabase's `CREATE OR REPLACE` only replaces the exact signature — if you add a new parameter, the old version stays in the DB as a second function. PostgREST then can't decide which to call when the caller passes N arguments and errors: `Could not choose the best candidate function`. Fix: explicitly `DROP FUNCTION ... (old signature)` before creating the new signature.

## RAG: Nudge Tier Chunk Count Scaling

- **As the DB grows, Nudge chunk count needs to grow too**: Started at 2 chunks for Nudge tier when the DB had ~17k chunks. Fine then — 2 top results were reliably correct. After adding 21k more chunks (38k total), 2 chunks became too narrow: grappling and fast travel queries ranked their answer 3rd or 4th and got cut off. Raised to 4. Lesson: **revisit chunk counts whenever the DB roughly doubles in size**.
- **Cache can mask newly ingested content**: If a query was cached before new content was added, the stale "I don't know" response gets served for 7 days even though the answer is now in the DB. When ingesting new categories that fix known retrieval gaps, **always clear the cache for those specific failing queries** via `DELETE FROM queries WHERE question = '...'` in Supabase.
- **Nudge token budget doesn't need to grow with chunk count**: Increasing from 2→4 chunks doesn't require increasing `maxTokens` — Claude Haiku is still capped at 100 tokens and will synthesize from whichever chunks are most relevant. More chunks = more retrieval candidates, not necessarily more output.

## RAG: Item Location Re-ranking

- **Item pages contain both stats AND location data — but stats sections are often first**: Fextralife item pages have a "Where to Find" section, but the page's opening sections (name, stats, effects) generate chunks that are semantically close to "where is X" queries. Without a location-specific boost, stats/refinement chunks outscore the location chunk.
- **Location-intent boost pattern**: In the Step C re-ranking loop, detect whether the query is asking for location (`where do i find`, `how to get`, `where to obtain`, etc.). If yes, add +0.15 to chunks containing location signal phrases: `where to find`, `can be found`, `obtained from`, `merchant`, `boss drop`, `chest`, `dropped by`, `found in`, `sold by`, `purchase from`, `reward from`. This promotes the location-data chunk above surrounding stats chunks.
- **Fextralife has ~1,330 chunks with "where to find"** — good coverage of weapons/armor/shields/accessories. If a query returns no location info, the item may be a true content gap (e.g. White Lion Necklace — no location data in either source).
- **Keep location-intent classifier broad**: The `getItemPhrases` regex must catch `how to get`, `how do I obtain`, `where can I obtain` in addition to `where do I find`. These patterns should route to `content_type = 'item'` rather than falling through to mechanic/exploration classifiers that would pick the wrong content.

## RAG: Wiki Domain Fragmentation

- **Fextralife wiki has two subdomains**: `crimsondesert.wiki.fextralife.com` (original, most content) and `crimsondesertgame.wiki.fextralife.com` (newer migration). Some pages redirect across domains — e.g. `/Grappling` on the original domain 301s to the new domain. The ingest script uses a fixed `BASE_URL` and may not follow cross-domain redirects, resulting in sparse or empty chunk extraction for those pages. Workaround: the linked skill pages (Restrain, Throw, Lariat etc.) are crawled via BFS from the redirect target and do get ingested correctly. The overview page itself may be thin.
- **Check for redirects when a category produces unexpectedly few chunks**: If an index page returns far fewer chunks than expected, fetch it manually in Node and check for a 301 response with a `Location` header pointing to a different domain.

## RAG: Classifier Keyword Coverage

- **Add new content category keywords to the classifier immediately**: When a new wiki category is ingested (e.g. "challenges"), add its keywords to `classifyContentType()` at the same time. If the classifier doesn't recognize "challenge" as a mechanic question, it returns `null` and the search runs unfiltered across all 17,000+ chunks — correct chunks rarely win.
- **"challenge" questions belong in the mechanic content type**: Challenges in Crimson Desert are game mechanics (life skills, exploration tasks, minigames). Classifier regex: `challenge|challenges|mastery|minigame|mini-game` added to mechanic regex.

## RAG: Ingest DELETE Silently Fails with Anon Key (RLS)

- **The DELETE step in ingest-from-cache.ts uses supabase-js with the anon key** — but RLS restricts DELETE on `knowledge_chunks` to `service_role` only. The DELETE silently succeeds (returns no error, 0 rows deleted), then INSERT adds new chunks alongside the old ones. You end up with duplicates: same source_url, same text, but two different `content_type` labels.
- **Symptom**: After a re-ingest you see the same source_url appearing under two content_type values in the DB. Query: `SELECT source_url, array_agg(DISTINCT content_type) FROM knowledge_chunks WHERE source_url LIKE '%game8%' GROUP BY source_url HAVING COUNT(DISTINCT content_type) > 1`.
- **Fix**: Use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) in `.env.local` for ingest scripts. Or use the Supabase MCP `apply_migration` / `execute_sql` to run the DELETE as service_role.
- **Content_type must match classifier**: When ingesting a new category, check what `content_type` the classifier routes those queries to (`classifyContentType()`) and use that exact value. Mismatch = chunks invisible to filtered searches. E.g. game8-puzzles must be `"puzzle"` not `"mechanic"` because puzzle queries filter by `content_type = 'puzzle'`.

## RAG: Threshold Sensitivity — It Doesn't Matter Much

- **Threshold (0.10–0.35) is rarely the retrieval bottleneck**: Per-category sensitivity sweep across all failing questions showed that questions either find their answer at ALL thresholds or at NONE. Tuning threshold does not recover missing answers — if the content isn't returned at 0.25 (production value), lowering to 0.10 won't help either (and may cause Supabase timeouts on large categories like `item`).
- **Supabase statement timeouts at threshold=0.10 with item filter**: The `item` content_type has the most chunks (~12k+). At threshold=0.10, too many rows pass the similarity check and the query times out. Keep minimum threshold at 0.15 for item queries; 0.25 (current production) is safe for all categories.
- **Real bottlenecks in order of impact**: (1) stale cached no-info responses, (2) wrong content_type classifier routing, (3) true content gaps. Threshold tuning is rarely #1.
- **Diagnosis script**: `scripts/test-sensitivity-by-category.ts` — queries Supabase + Voyage AI directly (bypasses HTTP API) with a threshold sweep and matchCount sweep per question. Shows whether each question's answer is in the DB at all, and at what rank. Useful after major content changes.

## RAG: Cache Poisoning from Stale Responses

- **7-day cache causes stale "no info" responses after content ingestion**: When new content is added to the KB (e.g. game8 puzzle solutions), queries that were cached before with "I don't have info" responses will keep returning stale answers for up to 7 days. After any major content ingestion, run `DELETE FROM queries WHERE response ILIKE '%don''t have specific%' OR response ILIKE '%no information%' ...` to wipe stale negative-cache entries.
- **Don't cache "no info" responses** ✅ IMPLEMENTED: `isMissingOrDefaultResponse(text)` in `route.ts` detects no-info/content-gap answers via regex before the cache insert. If matched, the query is logged with `response: null` (so rate limiting still counts it) but the cache lookup only returns rows where `response IS NOT NULL`, so the null row is never served. Patterns detected: "I don't have information", "not in the provided context", "context doesn't contain/mention/cover", "I can't find information", "no relevant information available/found/provided", plus fallback text like "couldn't generate an answer".
- **Cache is exact-match on question string**: "where is the white lion necklace" and "where to find darkbringer sword?" are different cache keys. Test suites that vary question phrasing will bypass cache and generate fresh (and potentially failing) responses.

## RAG: URL-Match Keyword Boost

- **When the user names a page, that page should dominate**: The URL-match boost finds chunks whose `source_url` contains a multi-word proper noun from the question (e.g. "Azure Moon Labyrinth" → `ilike %Azure+Moon+Labyrinth%`). Baseline similarity for URL matches must be high enough to beat typical filtered-vector scores on unrelated-but-semantically-near pages. Previous values (0.55 baseline + 0.15 rerank boost = 0.70 final) lost to 0.78–0.90 filtered vector results about wrong pages. Bumped to 0.88 baseline + 0.25 rerank = 1.13 final — URL matches now reliably win.
- **Possessive apostrophes break naive multi-word regexes**: `/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g` fails on "Saint's Necklace" because `'s` isn't `\s+[A-Z]`. Fix: `/[A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+(?:'s)?)+/g`. This single character blocked all URL-match boosts for possessive-form item/boss names. Very easy to miss because vector search still returns *something*, just the wrong thing (Crossroads Necklace instead of Saint's Necklace).
- **URL encoding for Fextralife wiki**: spaces become `+`, but apostrophes stay literal (`/Saint's+Necklace`). The `ilike` pattern has to preserve the apostrophe verbatim.
- **All-lowercase questions get zero boost keywords if you filter by uppercase-first**: The original `boostKeywords` filter kept only words starting with a capital letter (to find proper nouns). A question like "how to do feather of the earth challenge" has no capital letters → zero boost terms → falls back to pure vector search → wrong page wins. Fix: replace the uppercase-first filter with a stop-word Set. Any word >3 chars not in the stop list is a boost candidate, regardless of case.
- **Strip question boilerplate to extract the core topic name**: After removing stop words, also strip common question prefixes ("how to do/get/find/complete", "where is", "what is") and topic suffixes ("challenge", "quest", "boss", "fight", "location") from the raw question string. The remaining phrase ("feather of the earth") is the actual page name and can be used for URL-match `ilike` lookup. Without this stripping, the full phrase "how to do feather of the earth challenge" doesn't match the URL `/Feather+of+the+Earth`.
- **Single-word URL terms are too broad**: "necklace" (8 chars) qualifies as a URL match term but matches every necklace page (`limit(10)` may return 10 wrong-necklace chunks with no White Lion Necklace in sight). Fix: when multi-word phrases are available, use ONLY those for URL matching — skip single words. Multi-word phrases like "white+lion+necklace" target exactly the right page.
- **Keyword boost must respect content_type filter**: The URL-match and content-ILIKE boost queries were previously unfiltered — they added any chunk whose URL/content matched boost terms, regardless of content type. When a `content_type_filter` is active (e.g. "puzzle"), adding fextralife exploration chunks at synthetic sim=0.88 causes them to outscore correct game8 puzzle chunks at real sim=0.67. Fix: apply `eq("content_type", contentTypeFilter)` to both URL and content boost queries when the filter is set.
- **Build queries need cross-type search**: "Best build for X" requires equipment data (content_type="item"/"character") for stats AND guide content (content_type="mechanic"). Using mechanic-only filter misses weapons/accessories with critical rate/attack stats. Fix: add a BUILD classifier at the top that returns `null` (no filter) for any query containing "best build", "build for", etc., ensuring cross-type retrieval.
- **TypeScript: `RegExpMatchArray` is not assignable to `string[]` for push**: `const x = str.match(/regex/g) || []` infers `x` as `RegExpMatchArray | never[]`, which TS narrows to `RegExpMatchArray`. That type has a readonly-like push signature of `(item: never) => number` — pushing any string causes a type error. Fix: explicitly annotate: `const x: string[] = str.match(/regex/g) || [];`

## Cost Optimisation: RAG Pipeline

- **Run cache check before any external API call**: The Voyage embedding call costs ~$0.0001 per query. If the cache hit rate is 30–50%, moving the cache check before the Voyage call saves that cost on every hit. One DB query (fast, cheap) can eliminate the embedding call entirely. Order: cache check → Voyage → vector search → Claude.
- **Claude output token caps should reflect actual answer length, not headroom**: Sonnet was capped at 1,024 tokens but good answers average 200–400 tokens. Setting the cap to 650 saves ~35% of output cost without users noticing. Check `tokens_used` in the `queries` table to see real output distribution before deciding where to cap.
- **Nudge tier input tokens matter too**: Haiku is cheap per token but nudge queries are high-volume. Sending 6 chunks instead of 4, and a long BASE_SYSTEM_PROMPT instead of a 1-liner, wastes input tokens on every nudge. Trim both aggressively — Haiku produces good hints with minimal context.
- **Track cache hit rate from day one**: Add `cache_hit boolean` to the queries log. Without it you can't tell if your normalization is working or if your most common questions are being served from cache. Target 30%+ at steady state for a game guide (users tend to ask similar questions).
- **Solution tier costs ~10x more than nudge per query**: Sonnet + 8 chunks + long prompt vs Haiku + 4 chunks + short prompt. For free users, a separate solution-tier daily cap (e.g. 10/day) is worth more than an equivalent raise to the overall query limit. It protects against the worst-case cost scenario (free user who only uses solution tier all day).
- **Ad revenue covers ~10–15% of API costs**: At $2 RPM and 1 ad per 6 responses, each ad impression earns ~$0.002 vs ~$0.003 cost per query. Ads alone never break even — premium subscriptions are the only path to profitability. Ads serve better as conversion pressure than as a revenue source at early scale.

## Google OAuth with Supabase: Production Setup

- **Supabase Site URL is the root cause of localhost redirects in production**: Supabase uses the Site URL as the base for OAuth redirects. If it's still `http://localhost:3000`, Google sends users back to localhost even when the `redirectTo` in code says the production URL. Fix: update Site URL to the production domain in Supabase → Authentication → URL Configuration.
- **Two separate redirect URI configs required**: (1) Supabase needs the app callback URL in its "Redirect URLs" list (`https://your-domain.com/auth/callback`). (2) Google Cloud Console needs Supabase's own auth endpoint as an authorized redirect URI (`https://[project-ref].supabase.co/auth/v1/callback`) — this is NOT the app URL. These are different and both are required.
- **`window.location.origin` in `redirectTo` is correct for multi-environment setups**: Using `window.location.origin + "/auth/callback"` dynamically picks up localhost in dev and the production domain in prod without any env var needed. The fix is always in the dashboard configs, not the code.
- **Vercel project name ≠ GitHub repo name**: The Vercel project is named `crimson-guide` (URL: `crimson-guide.vercel.app`) while the GitHub repo is `gamehelper`. The Vercel project name determines the deployment URL — it doesn't auto-update when the repo is renamed.

## Content Gap Tracking

- **Store unanswered questions automatically for KB improvement**: When the RAG pipeline returns a fallback/no-info response, log the query with `content_gap: true`. Over time this builds a prioritised list of exactly what users are asking that the KB can't answer — far more valuable than guessing what to add next.
- **`content_gap` boolean column beats `response IS NULL` for distinguishing gap queries**: `response: null` is also set for rate-limited queries and other non-cached cases. A dedicated boolean column is unambiguous, filterable, and self-documenting.
- **Add the column with `IF NOT EXISTS` so the migration is safe to re-run**: `ALTER TABLE queries ADD COLUMN IF NOT EXISTS content_gap boolean DEFAULT false;` — no risk of failure if accidentally run twice.
- **The admin CSV export is the key workflow**: The point isn't just to store gaps — it's to periodically download the CSV, sort by frequency (most-asked unanswered questions), and use those as a crawl/ingest target list. The `question, spoiler_tier, asked_at` columns give enough context to prioritise by recency and user intent.

## RAG: Action Verb Contamination in Keyword Boost

- **Bare action verbs at the start of a question contaminate multi-word phrase extraction**: "find tauria curved sword" → `cleanedForPhrase` = "find tauria curved sword" → URL boost term = `find+tauria+curved+sword` → `ilike %find+tauria+curved+sword%` → no match against `/Tauria+Curved+Sword`. The same query capitalised ("Tauria curved sword") worked because no prefix verb was present.
- **Two-part fix**: (1) Add action verbs (`find`, `locate`, `get`, `buy`, `farm`, `obtain`, `craft`, `make`, `use`, `equip`, `upgrade`, `unlock`, `show`, `tell`, `give`) to `boostStopWords` so they're filtered from keyword lists. (2) Add a `.replace(/^(find|locate|get|buy|...)\ s+/i, "")` step to `cleanedForPhrase` so the verb is stripped before multi-word phrase extraction.
- **Order of replacements in `cleanedForPhrase` matters**: Strip compound question prefixes ("how to find", "where is") first, then bare action verbs, then articles ("the", "a", "an"). This ensures "how to upgrade tauria sword" correctly strips "how to" then "upgrade" in sequence → "tauria sword".
- **Action verbs survive `boostKeywords` length filter without stop-word coverage**: "find" is 4 chars (passes `> 3`) and was not in the original stop-word set — so it appeared in boost keyword lists AND in URL match terms.

## Rate Limiting Design

- **Daily cap is critical for cost protection at flat-rate pricing**: Per-minute and per-hour limits prevent burst abuse but don't stop a determined user from consistently querying 60/hr × 8hrs = 480 queries/day. At ~$0.004/query, one power user on a $4.99/mo plan costs ~$1.92/day = $57.60/month. A daily cap (free: 30, premium: 200) prevents this while still feeling unlimited to normal players.
- **Show upgrade CTA immediately when a free user hits a limit**: The rate-limit error message is the highest-intent conversion moment — the user just hit a wall and is still engaged. Add `showUpgradeCTA: userTier === "free"` to the JSON response and render `<UpgradeCTA rateLimitHit />` directly below the error bubble. Use different copy from the mid-conversation CTA ("You've reached your free limit" vs "Enjoying the guide?").
- **Three-tier check (min/hr/day) can run in a single `Promise.all`**: All three window checks are independent Supabase count queries — run them in parallel. The day check adds one DB round-trip but no sequential latency.
- **Flag rate-limited responses in the Message type**: Add `showUpgradeCTA?: boolean` to the `Message` interface. The API sets this flag; the frontend reads it to conditionally render the CTA. Keeps the UI logic clean — the CTA knows why it's appearing and can show contextual copy.

## Admin Dashboard: Abuse Detection

- **Group by IP in JS, not SQL, for the admin dashboard**: Supabase JS client doesn't support `GROUP BY` in select queries. Fetch `client_ip` for the time window (`select("client_ip").gte("created_at", oneDayAgo)`) and aggregate in a `Record<string, number>` map. Fast enough for thousands of rows; avoids needing an RPC function.
- **Use the free daily limit as the abuse threshold**: Flagging IPs at `count > 30` (the free tier daily cap) surfaces users who are over-quota without rate limiting being enabled yet, and distinguishes them from normal premium usage. When rate limiting goes live, this table becomes a way to confirm it's working.
- **Rolling rate averages reveal traffic patterns**: `avg/min = queriesLastHour / 60`, `avg/hr = queriesLast24h / 24`, `avg/day = last7dTotal / 7`. These three numbers together show whether traffic is growing, what the sustained load is, and whether a spike is an outlier or a new baseline. More useful for operational awareness than point-in-time totals.
- **Reuse existing fetches for derived metrics**: The IP fetch for abuse detection (`select("client_ip").gte(oneDayAgo)`) has `.data.length` equal to the 24h query count — no need for a separate count query. Similarly, `last7DaysRes.data.length` gives the 7d total without an extra DB call.

## Next.js 16 + Node 24

- **`.env.local` not loading in API routes**: Next.js 16 running on Node 24 had issues where `process.env` didn't pick up `.env.local` values in server-side route handlers. Workaround: built a manual `loadEnv()` function in `route.ts` that reads and parses the file directly. The function checks `process.env.VERCEL` to skip file reads in production (where Vercel injects env vars natively).

## Supabase + pgvector

- **`match_knowledge_chunks` RPC**: This is a custom Postgres function that must exist in Supabase for vector search to work. It takes `query_embedding` (vector), `match_threshold` (float), and `match_count` (int). Make sure the function is created in the Supabase SQL editor before testing vector search.
- **Embedding dimensions**: Voyage AI `voyage-3.5-lite` produces embeddings of a specific dimension. The `embedding` column in `knowledge_chunks` must match this dimension. If switching embedding models, the column and all existing embeddings need to be regenerated.
- **CRITICAL — RPC parameter must be `vector(1024)` not `vector`**: If the `query_embedding` parameter is declared as untyped `vector` (no dimension), PostgREST's JSON→vector cast corrupts `input_type: "query"` embeddings from Voyage AI. The cosine similarity computation breaks silently — correct chunks score near-zero and wrong chunks float to the top. Fix: declare the parameter as `vector(1024)` to match the column type.
- **Passing `match_threshold: 0.0` via supabase-js may use the DEFAULT instead**: When `0.0` is serialized as JSON `0`, PostgREST may treat it as falsy/absent and fall back to the function's DEFAULT threshold. Use an explicit non-zero value or test with negative thresholds to verify the parameter is being received.

## RAG: Debugging Embedding Similarity

- **Always use the same model when manually testing similarity**: When debugging why vector search returns wrong results, use the production model (`voyage-3.5-lite`) to generate the test query embedding. Using a different model (`voyage-3-large`) produces near-zero cosine similarity against stored `voyage-3.5-lite` embeddings — making it look like all chunks are irrelevant when they're actually correct. This is extremely confusing. Double-check: look at `generateEmbeddings()` in ingest-from-cache.ts to see the stored model, and `route.ts` for the query model. They must match.
- **Similarity scores for good matches**: With `voyage-3.5-lite` and correct input types, expect sim=0.60–0.70 for highly relevant game guide chunks, 0.40–0.55 for related but not exact matches, and 0.25–0.40 for borderline relevant chunks. Scores below 0.25 usually indicate wrong content type or poor content quality.

## Voyage AI

- **Model choice**: Using `voyage-3.5-lite` for embeddings. It's the lightweight model — good balance of cost and quality for a game guide use case.
- **Use `input_type: "query"` for search queries, `"document"` for ingestion**: The earlier note about `"query"` being corrupted was actually a different bug (untyped `vector` parameter). With the `vector(1024)` fix in place, using the correct input types (query for search, document for storage) gives the best similarity scores.

## Spoiler Tier Prompt Engineering

- **Per-category examples are essential**: The nudge tier prompt needed explicit good/bad examples for each question type (puzzles, items, bosses, mechanics). Without these, the model would sometimes give full answers even when set to "nudge" mode.
- **Snarky no-info responses + scope explainer**: When the knowledge base has no relevant info, the system returns a snarky line followed by a structured "What I'm built for" block — bulleted examples of questions the app IS good at (boss strategies, weapon/armor stats, skill details, NPC info, region directions) and a note that broad overview queries are not well supported. This aligns user expectations with the current KB strengths instead of leaving them at a dead end. Applied both in the API short-circuit (before Claude call) and inside `BASE_SYSTEM_PROMPT` so Claude emits the same block when it falls back. The check happens before the Claude call for the short-circuit path — if relevance thresholds aren't met, we return the snarky+explainer string immediately and skip Claude entirely.
- **Two tiers beat three for this product**: Originally had Nudge / Guide / Full. In practice Guide and Full produced nearly identical output — both were walkthroughs at different token budgets, and users couldn't distinguish them. Collapsed to Nudge (hint, Haiku) + Solution/Full (complete answer, Sonnet). Simpler mental model ("hint me" vs "tell me"), cleaner paywall split, one less prompt to maintain. Lesson: if two tiers in a UX ladder don't produce visibly different outputs, they're the same tier.
- **Legacy tier values in DB**: When collapsing tiers, don't migrate historical data — accept legacy values at read time. Admin stats folds `guide` rows into `full`; chat API silently maps incoming `spoilerTier="guide"` requests to `"full"`. Zero-downtime, zero migration risk.

## Error Logging Pattern

- **Never let error logging crash the app**: Both the client-side `logClientError()` and the `/api/log-error` endpoint are wrapped in try/catch and swallow all exceptions. Logging is always fire-and-forget.
- **React Error Boundaries must be class components**: React's `componentDidCatch` lifecycle is only available in class components — function components cannot be error boundaries. Use `getDerivedStateFromError` for updating state + `componentDidCatch` for side effects (logging).
- **Next.js `error.tsx` vs React ErrorBoundary**: `error.tsx` in App Router catches errors from Server Components and async route handlers. It does NOT catch errors in client components during render — that still needs a React ErrorBoundary. Use both for full coverage.
- **`error_logs` context column (jsonb)**: Store structured metadata about the error — `question`, `tier`, `component`, `url`, `digest` etc. Makes it much easier to reproduce issues from the admin dashboard.
- **Time-bucketed sparklines without a timeseries DB**: Use JS to bucket raw rows into fixed intervals (5-min / 1-hr / 6-hr) client-side. No extra DB query needed — just filter the already-fetched rows. Works fine up to a few thousand rows.
- **Expandable table rows in React**: Use a `expandedId` state string. Render a second `<tr>` immediately after the main row when `id === expandedId`. Use `<>` fragment as the map return so both rows sit at the same level in the `<tbody>`.
- **Server-side error logging should be async and non-blocking**: In API routes, log errors with `.then(() => {})` or inside a separate try/catch after returning the response. Don't `await` the log insert before returning 500 — the user is already waiting.

## RAG Pipeline Design

- **CI env loading pattern**: Scripts that read `.env.local` via `fs.readFileSync` will throw in CI (no file present). Wrap in try/catch and fall back to `process.env`. GitHub Actions injects secrets as environment variables, so `process.env.VOYAGE_API_KEY` works there. Pattern: `process.env[key] || env[key] || ""`.
- **Content change detection via hashing**: Store `sha256(pageContent).slice(0,16)` in a `page_hashes` table keyed by URL. On re-crawl, hash the new content and compare — skip embedding if unchanged. This is the correct way to make scheduled re-ingestion cheap; don't rely on HTTP `Last-Modified` headers (Fextralife doesn't send them reliably).
- **Wiki nav exclusion list can hide entire sub-categories**: `/Abyss+Gear` was in the `navPages` exclusion set, so the ingestion script never crawled it and never followed links to it. When adding new wiki categories, check the exclusion set and remove any that should be crawled. The correct pattern: nav-only pages (index pages, UI pages) go in the exclusion set; content pages do not.
- **1-level crawl misses interconnected content**: The original script crawled Index → linked pages and stopped. Pages like Crow's Pursuit (linked from Abyss Gear, not from Items index) were invisible. Fix: BFS `--deep` mode follows links within level-1 pages to discover level-2 content.
- **Idempotent ingestion**: Use delete-by-source-url before inserting to safely re-run categories without duplicating chunks. Supabase `knowledge_chunks` has no unique constraint on `source_url`, so without this, re-runs multiply the data.
- **2-phase crawl+ingest pipeline (added 2026-04-09)**: Split the monolithic crawl→chunk→embed→upsert script into two separate scripts to avoid unnecessary re-crawling:
  - `scripts/crawl-wiki.ts` — fetches Fextralife wiki pages, saves extracted text + metadata to `wiki-cache/pages/{category}/{slug}.json` with a `manifest.json` index. Supports `--deep`, `--changed-only`, `--category`, `--dry-run`.
  - `scripts/ingest-from-cache.ts` — reads from `wiki-cache/`, chunks, embeds via Voyage AI, upserts to Supabase. Maintains `wiki-cache/ingest-state.json` to track what's been embedded. Supports `--changed-only` (re-embeds only pages whose cached content hash changed since last ingest).
  - **When to re-crawl**: Only when wiki content changes. Use `crawl-wiki.ts --changed-only` to fetch only updated pages.
  - **When to skip re-crawling**: Changing chunking logic, fixing extraction, or adjusting metadata — just run `ingest-from-cache.ts` directly from the existing cache (no wiki hits, no 800ms/page wait).
  - `wiki-cache/` is gitignored. Re-populate with a full crawl if it gets deleted.
  - Workflow: `crawl-wiki.ts` (once, or on wiki updates) → `ingest-from-cache.ts` (anytime after)

- **Dual search strategy**: Vector search is primary, text search is fallback. This handles cases where embeddings miss something that simple keyword matching would catch.
- **Relevance gating**: Similarity threshold for vector results is 0.5 (with `input_type: "document"` embeddings, relevant chunks typically score 0.6–0.85 and unrelated chunks score < 0.4). Text search fallback requires >= 2 keyword matches. Without these gates, Claude would hallucinate from tangentially related chunks.
- **Keyword extraction**: Stop words list includes game-generic terms ("crimson", "desert") that would match everything and dilute search quality.
- **Response caching**: Before calling Voyage/Claude, check `queries` table for exact `question` + `spoiler_tier` match within 7 days. Returns cached `response` immediately, skipping all API calls. Only kicks in for identical question strings — not fuzzy.
- **Per-tier Claude config**: `TIER_CLAUDE` constant maps each tier to a model, maxTokens, and matchCount. Nudge uses Haiku (150 tokens, 3 chunks) — ~20x cheaper per query. Full/Solution uses Sonnet (1024 tokens, 8 chunks). Wire via `tierConfig = TIER_CLAUDE[spoilerTier]`.
- **Single Supabase client**: One `createClient()` call per request, used for rate limiting, cache check, vector search, and query logging. Avoids creating multiple TCP connections.

## Auth

- **Daily query reset**: The `queries_today_reset_at` field stores a date string. On each login, if the stored date doesn't match today, the counter resets to 0. This avoids needing a cron job.
- **User profile creation**: Currently relies on Supabase triggers or first-sign-in logic to create the user row. Need to verify the trigger exists in the DB.

## Voice Features

- **Browser compatibility**: Web Speech API (SpeechRecognition) only works reliably in Chrome and Edge. Firefox has partial support. Safari is inconsistent. The app shows an alert for unsupported browsers.
- **Type declarations**: Needed a custom `speech.d.ts` for TypeScript to recognize `webkitSpeechRecognition` and related types.

## Mobile Layout

- **`100vh` vs `100dvh` on mobile**: `h-screen` in Tailwind maps to `height: 100vh`, which on mobile browsers includes the browser chrome (address bar, bottom nav bar). The actual visible area is smaller, so a bottom-anchored input gets pushed just below the fold. Fix: use `h-[100dvh]` (dynamic viewport height) which tracks the true visible area. Safari 15.4+, Chrome 108+, Firefox 101+ support `dvh`.
- **Lock body scroll for app-shell layouts**: Add `height: 100%` + `overflow: hidden` to `html` and `body` so the flex container owns all scrolling. Without this, the page itself can scroll and break the fixed-input illusion.

## Windows: Running Detached Long-Running Processes

- **Bash background jobs (`&`) die when the shell closes on Windows**: Running `tsx script.ts >> log.log 2>&1 &` in Claude Code's bash tool will get killed the moment the bash session ends (the task completes but the child process is killed). The log gets truncated and nothing is inserted.
- **Use PowerShell `Start-Process` for truly detached processes**:
  ```powershell
  Start-Process -FilePath 'node_modules\.bin\tsx.cmd' -ArgumentList @('scripts/ingest-fextralife.ts', '--deep', '--category', 'accessories') -WorkingDirectory 'C:\path\to\project' -RedirectStandardOutput 'ingest.log' -NoNewWindow -PassThru | Select-Object Id
  ```
  This returns a PID and the process keeps running even after the shell closes.
- **Check ingest progress via Supabase SQL** when the output file is unavailable: `SELECT COUNT(*), MAX(created_at) FROM knowledge_chunks WHERE source_type = 'fextralife_wiki'` — if `MAX(created_at)` is recent and COUNT is growing, it's still running.
- **If the computer sleeps, in-flight HTTP requests time out**: The node process resumes on wake but any mid-request Voyage API or Fextralife fetches will have errored. Depending on error handling the script may skip that batch and continue, or halt. Check the log file and chunk count after waking to confirm status.

## Default Spoiler Tier

- **Set `nudge` as the default tier** (not `guide`): Nudge uses Haiku (cheapest model, 150 tok, 3 chunks) — ~20x cheaper per query than Sonnet. Most new users haven't chosen their preference yet, so defaulting to the cheapest tier saves significant API cost at scale. Users who want more detail can switch to Guide/Full.

## Database Maintenance

- **Duplicate chunks from multiple ingest runs**: The ingest script does delete-before-insert per URL, but if run multiple times or across different category flags, the same URL can end up with multiple sets of chunks. Fix: deduplicate with `DELETE WHERE id NOT IN (SELECT DISTINCT ON (source_url, md5(content)) id ... ORDER BY created_at DESC)`. Session 9 removed 72,702 dupes (73% of DB).
- **Nav-list junk chunks**: Fextralife wiki pages have sidebar navigation lists (`♦ item1 ♦ item2 ♦ item3...`) that get captured as chunks. These are pure noise — they contain no useful information about the page topic but compete in vector search results. Fix: `DELETE WHERE content LIKE '%♦%♦%♦%'`. Session 9 removed 9,527 junk chunks (36% of remaining).
- **Clear query cache after changes**: The `queries` table caches responses for 7 days. After any prompt, DB, or classifier change, `DELETE FROM queries` is required or users will get stale cached responses. Easy to forget.
- **Supplemental scraping pattern**: When the main crawler misses specific sections (e.g., "How to Obtain" on item pages), build a targeted supplemental scraper that: (1) queries existing URLs from the DB, (2) re-fetches each page, (3) extracts only the missing section, (4) inserts as a new chunk with embedding. Make it idempotent by checking for existing supplemented chunks. This is faster and cheaper than re-crawling everything.

## Prompt Engineering (RAG-specific)

- **Include game world context in system prompt**: Claude produces much better responses when the system prompt includes game-specific knowledge (world name, protagonist, factions, regions, combat systems). Without this, Claude sounds generic and misses connections between chunks.
- **"Share what you know" beats "only answer if directly relevant"**: An overly strict prompt ("If context doesn't directly answer, say you don't know") causes Claude to discard partially-relevant context. Better: "Share EVERY useful detail from the context, even if it doesn't perfectly match the question. Say what's missing."
- **Source metadata in context helps**: Prefixing each chunk with `[Source: PageName]` helps Claude identify where info comes from and prioritize.
- **Nudge tier needs explicit anti-leak rules**: When context contains detailed strategies (button inputs, phase breakdowns), Claude will leak them into nudge responses unless explicitly told not to. Good/bad examples in the prompt are essential. Also: fewer chunks (2 vs 3) and lower max tokens (100 vs 150) help.
- **Wiki section header variants break extraction**: Fextralife uses "How to Get", "How to Obtain", "How to Craft", "Where to Find" inconsistently across pages. Any regex-based extractor must account for all variants.

## Next.js App Router: Favicon & Icons

- **Drop files in `src/app/` to auto-serve icons**: Next.js App Router uses file-based icon conventions. `src/app/icon.png` → browser favicon, `src/app/apple-icon.png` → Apple touch icon, `src/app/icon-192.png` → high-res PWA icon. No `<link>` tags needed — Next.js injects them into `<head>` automatically. Routes show up as `○ /icon.png` in the build output confirming they're serving.
- **Use Sharp to generate icons from a source image**: Sharp is already a Next.js dependency (used for image optimization). Run it directly in Node: `sharp(src).resize(32, 32).png().toFile('./src/app/icon.png')`. No extra packages needed.
- **Transparent background webp/png works best for logos on dark themes**: The shield logo has a transparent background which renders cleanly on the dark header without needing a box or background treatment.

## Supabase: Vector Index Sizing

- **IVFFlat `lists` must scale with row count**: Formula is `sqrt(n_rows)` for datasets under 1M rows. At 94k rows, correct value is ~307. The original `lists=100` was set when the DB had ~17k rows and was never updated. With 100 lists and 94k vectors, each bucket holds ~940 vectors — oversized buckets cause more data to be scanned per query, increasing IO.
- **Vector index size can exceed compute RAM and cause IO alerts**: The IVFFlat index on 94k × 1024-dimension vectors is ~956 MB. On Supabase starter compute (1 GB RAM), this barely fits and any competing memory use causes the index to be paged to disk. Every similarity search then requires disk reads → IO alert. Fix: upgrade compute so index fits in RAM, AND rebuild index with correct `lists` value.
- **Rebuilding IVFFlat requires a brief table lock**: `DROP INDEX` then `CREATE INDEX USING ivfflat` takes the full table lock while building. Schedule during low-traffic window. For 94k rows the rebuild is fast (seconds to low minutes).
- **Index size dominates DB storage for vector tables**: `knowledge_chunks` has 76 MB of table data but 963 MB of indexes (956 MB vector + 7 MB btree). Total = 1,564 MB. When estimating DB storage, the vector index is typically 10–15× the raw table size.

## Supabase: RLS Performance

- **`auth.uid()` in RLS policies re-evaluates per row by default**: Postgres evaluates RLS policy expressions for every row scanned unless the expression is wrapped in a subquery. `auth.uid()` is a function call that hits the session context each time. At scale this becomes significant. Fix: replace `auth.uid()` with `(select auth.uid())` — the subquery form is evaluated once per query and the result is reused.
- **Supabase's advisor tool catches this**: The `auth_rls_initplan` lint fires on any policy using bare `auth.uid()` or `auth.role()`. Run the performance advisor after any schema change.

## Debugging Vercel Deployments

- **A broken deployment stays silently broken until you check logs**: Vercel shows `ERROR` state in the dashboard, but the git push doesn't fail and there's no email by default. After wiring a new repo, always verify the first deployment succeeded by checking the Vercel dashboard or using the MCP `get_deployment_build_logs` tool.
- **TypeScript errors that pass locally can fail on Vercel if tsconfig differs**: Vercel runs `next build` which includes a full TypeScript check. Locally, `next dev` skips strict type checking. Always run `npx tsc --noEmit` locally before pushing to confirm the build is clean.
- **`live: false` on a Vercel project means no successful production deployment has landed**: The project exists but has never successfully deployed, or all deployments are in ERROR state. Normal healthy projects show `live: true` with a valid `latestDeployment.readyState: "READY"`.

## Deployment

- **Vercel Hobby plan**: Does not support git-triggered deploys from collaborators. The git author's email must match the Vercel account owner. Fix: deploy via CLI (`npx vercel --prod`) instead of git integration.
- **Node.js 24.x breaks Vercel builds**: Next.js 16 doesn't support Node 24 yet. Set Node.js version to 20.x in Vercel Settings → General.
- **Vercel project config can break when changing git connections**: Disconnecting/reconnecting a git repo can corrupt project settings, causing 0ms build failures with no error message. Fix: redeploy a known-good deployment from the dashboard, then use CLI deploys going forward.
- **`.env.local` manual loader**: The `loadEnv()` function in the API route checks `process.env.VERCEL` to skip file-based env loading in production — Vercel provides env vars directly via `process.env`.
