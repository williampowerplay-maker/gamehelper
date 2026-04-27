import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Load .env.local for local dev (same pattern as other routes)
function loadEnv(): Record<string, string> {
  try {
    if (process.env.VERCEL) return {};
    const fs = require("fs");
    const path = require("path");
    const envPath = path.join(process.cwd(), ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    const vars: Record<string, string> = {};
    content.split("\n").forEach((line: string) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch { return {}; }
}

const envVars = loadEnv();
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL    || envVars.NEXT_PUBLIC_SUPABASE_URL    || "";
const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY   || envVars.SUPABASE_SERVICE_ROLE_KEY   ||
                     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// ── Label mapping (internal content_type → user-facing label, display order) ──
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

// ── Module-level 24-hour cache ────────────────────────────────────────────────
// Persists within a server process (works locally; Vercel cold starts re-query,
// which is fine since the data changes only on ingest runs).
interface CachedStats {
  data: { categories: { label: string; count: number }[]; totalSources: number; youtubeGuides: number };
  expiresAt: number;
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache: CachedStats | null = null;

async function fetchStats() {
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Use SECURITY DEFINER RPCs so the anon key bypasses RLS row limits.
  // Both functions do COUNT DISTINCT server-side — no row-by-row fetch.
  const [{ data: typeRows, error }, { data: ytCount }] = await Promise.all([
    supabase.rpc("coverage_stats_by_type"),
    supabase.rpc("coverage_youtube_count"),
  ]);

  if (error) throw new Error(`Supabase RPC error: ${error.message}`);

  const pageCountMap: Record<string, number> = {};
  for (const row of (typeRows ?? []) as { content_type: string; page_count: number }[]) {
    pageCountMap[row.content_type] = row.page_count;
  }

  const categories = LABEL_MAP
    .map(({ type, label }) => ({ label, count: pageCountMap[type] ?? 0 }))
    .filter(({ count }) => count >= MIN_PAGES);

  const totalSources = Object.values(pageCountMap).reduce((a, b) => a + b, 0);
  const youtubeGuides = Number(ytCount ?? 0);

  return { categories, totalSources, youtubeGuides };
}

export async function GET() {
  try {
    const now = Date.now();
    if (cache && now < cache.expiresAt) {
      return NextResponse.json(cache.data, {
        headers: { "X-Cache": "HIT", "Cache-Control": "public, max-age=3600" },
      });
    }

    const data = await fetchStats();
    cache = { data, expiresAt: now + CACHE_TTL_MS };

    return NextResponse.json(data, {
      headers: { "X-Cache": "MISS", "Cache-Control": "public, max-age=3600" },
    });
  } catch (e) {
    console.error("coverage-stats error:", e);
    return NextResponse.json({ error: "Failed to load coverage stats" }, { status: 500 });
  }
}
