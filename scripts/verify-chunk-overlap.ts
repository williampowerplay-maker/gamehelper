import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const env: Record<string, string> = {};
try {
  fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}
const get = (k: string) => process.env[k] || env[k] || "";
const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("NEXT_PUBLIC_SUPABASE_ANON_KEY"));

(async () => {
  const { count } = await supabase.from("knowledge_chunks").select("*", { count: "exact", head: true });
  console.log("total rows:", count);

  const { data } = await supabase.from("knowledge_chunks").select("source_url, content_type, content").limit(3);
  for (const r of data || []) {
    console.log("---");
    console.log("url:", r.source_url);
    console.log("type:", r.content_type);
    console.log("content[0..300]:", (r.content || "").slice(0, 300));
  }

  // Per-content_type stats
  const types = ["boss", "quest", "item", "exploration", "mechanic", "recipe", "character"];
  console.log("\ncontent_type   | rows  | avgLen | maxLen");
  console.log("---------------+-------+--------+-------");
  for (const t of types) {
    const { data: rows } = await supabase
      .from("knowledge_chunks")
      .select("content")
      .eq("content_type", t)
      .limit(3000);
    if (!rows || !rows.length) { console.log(`${t.padEnd(14)} | (none)`); continue; }
    let total = 0, max = 0;
    for (const r of rows) { const l = (r.content || "").length; total += l; if (l > max) max = l; }
    console.log(`${t.padEnd(14)} | ${String(rows.length).padStart(5)} | ${String(Math.round(total/rows.length)).padStart(6)} | ${String(max).padStart(6)}`);
  }
})();
