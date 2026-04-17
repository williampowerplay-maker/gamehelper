import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

const WINDOWS: Record<string, number> = {
  "1h":  1 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
};

// Failed-attempt throttle: max 5 failures per IP per 15 minutes
const failedAttempts: Map<string, { count: number; resetAt: number }> = new Map();
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function checkAdminAuth(req: NextRequest): { ok: boolean; response?: NextResponse } {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (record && now < record.resetAt && record.count >= MAX_FAILS) {
    return { ok: false, response: NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429 }) };
  }
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "").trim();
  let authorized = false;
  if (ADMIN_SECRET && token.length === ADMIN_SECRET.length) {
    try { authorized = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_SECRET)); } catch { authorized = false; }
  }
  if (!ADMIN_SECRET || !authorized) {
    const existing = failedAttempts.get(ip);
    if (!existing || now >= existing.resetAt) failedAttempts.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS });
    else existing.count++;
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  failedAttempts.delete(ip);
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (!auth.ok) return auth.response!;

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
