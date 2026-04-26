// Build a structured printout of each query's seeds vs top-10 for human review.
// No judgment — just lays out the data.
import { readFileSync, writeFileSync } from "node:fs";

interface Audit {
  query: string;
  classifier: string | null;
  fallback: boolean;
  recall: number;
  expected_chunk_ids: string[];
  expected_chunks: Array<{ id: string; rank: number | null; in_top10: boolean; content_type: string; source_url: string; len: number; head: string }>;
  top10: Array<{ rank: number; id: string; similarity: number; is_expected: boolean; content_type: string; source_url: string; len: number; head: string }>;
}

const audit: Audit[] = JSON.parse(readFileSync("./phase1d-eval-audit-comprehensive.json", "utf-8"));

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+\//, "/").substring(0, 50);
}

let out = "";
for (const a of audit) {
  out += `\n${"━".repeat(70)}\n`;
  out += `QUERY: ${a.query}\n`;
  out += `Classifier: ${a.classifier ?? "none"}${a.fallback ? " (FALLBACK)" : ""} | Recall: ${(a.recall * 100).toFixed(0)}%\n`;
  out += `\nExpected seeds (${a.expected_chunk_ids.length}):\n`;
  for (const e of a.expected_chunks) {
    const rank = e.rank ? `rank ${e.rank}` : "NOT IN TOP-10";
    out += `  [${e.id.substring(0, 8)}] ${rank} | ${e.content_type} | len=${e.len} | ${shortUrl(e.source_url)}\n`;
    out += `    "${e.head.substring(0, 140)}..."\n`;
  }
  out += `\nActual top-3:\n`;
  for (const t of a.top10.slice(0, 3)) {
    const tag = t.is_expected ? "✅ EXPECTED" : "  ";
    out += `  ${tag} #${t.rank} [${t.id.substring(0, 8)}] sim=${t.similarity.toFixed(3)} | ${t.content_type} | len=${t.len} | ${shortUrl(t.source_url)}\n`;
    out += `       "${t.head.substring(0, 140)}..."\n`;
  }
}

writeFileSync("./phase1d-eval-audit-formatted.txt", out, "utf-8");
console.log(out);
console.log(`\nWrote phase1d-eval-audit-formatted.txt (${out.length} chars)`);
