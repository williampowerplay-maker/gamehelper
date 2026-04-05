import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const env: Record<string, string> = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf-8").split("\n").forEach((l) => {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
});
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
  for (const pattern of ["%Saint%Necklace%", "%Azure+Moon%", "%Labyrinth%", "%Hornsplitter%", "%Kailok%"]) {
    const { data } = await s
      .from("knowledge_chunks")
      .select("source_url, content_type")
      .ilike("source_url", pattern)
      .limit(5);
    const uniq = new Set((data || []).map((r) => r.source_url));
    console.log(`\n${pattern}: ${data?.length || 0} chunks, ${uniq.size} unique URLs`);
    for (const u of uniq) console.log("  ", u);
  }
})();
