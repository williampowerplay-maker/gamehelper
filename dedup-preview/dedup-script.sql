-- ============================================================================
-- Phase 1a — URL deduplication (byte-identical cross-type collapse)
-- Generated: 2026-04-22
--
-- Rule: For each (content, source_url) group on a fextralife URL where
-- identical text appears under multiple content_types, keep ONE row and
-- delete the rest. The canonical type is selected by priority order from
-- the types actually present on that URL.
--
-- Priority: boss > quest > character > exploration > recipe > item > puzzle > mechanic
--
-- Scope: 8,576 byte-identical groups across 714 URLs. Expected deletions: 19,634.
--        Updates: 0 (kept row always already has the canonical type).
--
-- NOT executed automatically — inspect the preview before running.
-- Backup table: knowledge_chunks_backup_20260422 (76,123 rows).
-- ============================================================================

-- Step 0 (already done): backup the fextralife subset
-- CREATE TABLE knowledge_chunks_backup_20260422 AS
-- SELECT * FROM knowledge_chunks WHERE source_url LIKE '%fextralife%';

-- Step 1: Build a "rows to keep" list — one id per (content, source_url)
-- group, chosen as MIN(id) among rows whose content_type equals the
-- canonical keep_type for that group.
WITH dup_groups AS (
  SELECT content, source_url, array_agg(DISTINCT content_type) AS types_present
  FROM knowledge_chunks
  WHERE source_url LIKE '%fextralife%'
  GROUP BY content, source_url
  HAVING COUNT(DISTINCT content_type) > 1
),
with_keep_type AS (
  SELECT content, source_url,
    CASE
      WHEN 'boss'        = ANY(types_present) THEN 'boss'
      WHEN 'quest'       = ANY(types_present) THEN 'quest'
      WHEN 'character'   = ANY(types_present) THEN 'character'
      WHEN 'exploration' = ANY(types_present) THEN 'exploration'
      WHEN 'recipe'      = ANY(types_present) THEN 'recipe'
      WHEN 'item'        = ANY(types_present) THEN 'item'
      WHEN 'puzzle'      = ANY(types_present) THEN 'puzzle'
      WHEN 'mechanic'    = ANY(types_present) THEN 'mechanic'
    END AS keep_type
  FROM dup_groups
),
rows_to_keep AS (
  SELECT MIN(kc.id) AS keep_id, w.content, w.source_url
  FROM with_keep_type w
  JOIN knowledge_chunks kc
    ON kc.content = w.content
   AND kc.source_url = w.source_url
   AND kc.content_type = w.keep_type
  GROUP BY w.content, w.source_url
)
-- Step 2: DELETE all rows in the dup groups EXCEPT the keep_id for each group.
DELETE FROM knowledge_chunks kc
USING (
  SELECT kc2.id
  FROM knowledge_chunks kc2
  JOIN (
    SELECT content, source_url FROM (
      SELECT content, source_url
      FROM knowledge_chunks
      WHERE source_url LIKE '%fextralife%'
      GROUP BY content, source_url
      HAVING COUNT(DISTINCT content_type) > 1
    ) g
  ) dup
    ON kc2.content = dup.content
   AND kc2.source_url = dup.source_url
  WHERE kc2.source_url LIKE '%fextralife%'
    AND kc2.id NOT IN (SELECT keep_id FROM rows_to_keep)
) target
WHERE kc.id = target.id;

-- Rollback (if needed, restore fextralife subset from backup):
-- TRUNCATE knowledge_chunks WHERE source_url LIKE '%fextralife%'; -- not valid; use DELETE
-- DELETE FROM knowledge_chunks WHERE source_url LIKE '%fextralife%';
-- INSERT INTO knowledge_chunks SELECT * FROM knowledge_chunks_backup_20260422;
