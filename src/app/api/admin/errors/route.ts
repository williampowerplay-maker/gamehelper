import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  } catch {
    return {};
  }
}

const envVars = loadEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || envVars.ADMIN_SECRET || "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const WINDOWS: Record<string, number> = {
  "1h":  1 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!ADMIN_SECRET || authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const window = searchParams.get("window") ?? "24h";
  const ms = WINDOWS[window] ?? WINDOWS["24h"];
  const since = new Date(Date.now() - ms).toISOString();

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: errors, error } = await supabase
    .from("error_logs")
    .select("id, error_type, message, stack, context, client_ip, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = errors ?? [];

  // Breakdown by type
  const byType: Record<string, number> = {};
  for (const row of rows) {
    const t = row.error_type as string;
    byType[t] = (byType[t] ?? 0) + 1;
  }

  // Group into hourly buckets for sparkline (up to 48 buckets)
  const bucketMs = ms <= WINDOWS["1h"] ? 5 * 60 * 1000       // 5-min buckets for 1h
                 : ms <= WINDOWS["24h"] ? 60 * 60 * 1000      // 1-hr buckets for 24h
                 : 6 * 60 * 60 * 1000;                        // 6-hr buckets for 7d

  const bucketCount = Math.ceil(ms / bucketMs);
  const buckets: { label: string; count: number }[] = [];
  const now = Date.now();

  for (let i = bucketCount - 1; i >= 0; i--) {
    const bucketStart = now - (i + 1) * bucketMs;
    const bucketEnd   = now - i * bucketMs;
    const label = new Date(bucketStart).toISOString();
    const count = rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= bucketStart && t < bucketEnd;
    }).length;
    buckets.push({ label, count });
  }

  return NextResponse.json({
    window,
    since,
    total: rows.length,
    byType,
    buckets,
    errors: rows,
  });
}
