/**
 * compute-coverage-stats.ts
 *
 * Queries knowledge_chunks for per-content_type page counts and transforms
 * them to user-facing labels. Used by the /api/coverage-stats route and
 * as a standalone CLI tool.
 *
 * Usage:  npx tsx scripts/compute-coverage-stats.ts
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// ── Env ───────────────────────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  try {
    const envPath = path.join(__dirname, "..", ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    content.split("\n").forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch { return {}; }
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// ── Label mapping ─────────────────────────────────────────────────────────────
// Internal content_type → user-facing label.
// Order here is the display order (highest count first).
const LABEL_MAP: { type: string; label: string }[] = [
  { type: "item",        label: "Items & Equipment" },
  { type: "mechanic",    label: "Game Mechanics"    },
  { type: "quest",       label: "Quests"            },
  { type: "character",   label: "Characters & NPCs" },
  { type: "exploration", label: "Locations"         },
  { type: "recipe",      label: "Recipes"           },
  { type: "boss",        label: "Bosses"            },
  { type: "puzzle",      label: "Puzzles"           },
];

const MIN_PAGES = 50;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CoverageCategory {
  label: string;
  count: number; // distinct page (URL) count
}

export interface CoverageStats {
  categories: CoverageCategory[];
  totalSources: number;
  youtubeGuides: number;
}

// ── Core query ────────────────────────────────────────────────────────────────
export async function computeCoverageStats(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<CoverageStats> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Use SECURITY DEFINER RPCs — do COUNT DISTINCT server-side, bypasses RLS row limits.
  const [{ data: typeRows, error }, { data: ytCount }] = await Promise.all([
    supabase.rpc("coverage_stats_by_type"),
    supabase.rpc("coverage_youtube_count"),
  ]);

  if (error) throw new Error(`Supabase RPC error: ${error.message}`);

  const pageCountMap: Record<string, number> = {};
  for (const row of (typeRows ?? []) as { content_type: string; page_count: number }[]) {
    pageCountMap[row.content_type] = row.page_count;
  }

  const categories: CoverageCategory[] = LABEL_MAP
    .map(({ type, label }) => ({ label, count: pageCountMap[type] ?? 0 }))
    .filter(({ count }) => count >= MIN_PAGES);

  const totalSources = Object.values(pageCountMap).reduce((a, b) => a + b, 0);
  const youtubeGuides = Number(ytCount ?? 0);

  return { categories, totalSources, youtubeGuides };
}

// ── CLI mode ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE env vars");
    process.exit(1);
  }
  computeCoverageStats(SUPABASE_URL, SUPABASE_KEY)
    .then((stats) => {
      console.log(JSON.stringify(stats, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
