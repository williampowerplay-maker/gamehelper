import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Load .env.local manually for local dev (Next.js 16 / Node 24 workaround)
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

// Failed-attempt throttle: max 5 failures per IP per 15 minutes
// Prevents brute-forcing the admin secret
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

  // Check if IP is throttled
  if (record && now < record.resetAt && record.count >= MAX_FAILS) {
    return { ok: false, response: NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429 }) };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();

  // Timing-safe comparison — prevents timing attacks that could leak the secret
  // character-by-character by measuring microsecond response time differences
  let authorized = false;
  if (ADMIN_SECRET && token.length === ADMIN_SECRET.length) {
    try {
      authorized = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_SECRET));
    } catch { authorized = false; }
  }

  if (!ADMIN_SECRET || !authorized) {
    // Record failed attempt
    const existing = failedAttempts.get(ip);
    if (!existing || now >= existing.resetAt) {
      failedAttempts.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS });
    } else {
      existing.count++;
    }
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // Clear failed attempts on successful auth
  failedAttempts.delete(ip);
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (!auth.ok) return auth.response!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    totalQueriesRes,
    queriesTodayRes,
    tierBreakdownRes,
    last7DaysRes,
    recentQueriesRes,
    tokensRes,
    totalUsersRes,
    premiumUsersRes,
    waitlistRes,
    knowledgeRes,
    recentErrorsRes,
    errorsLast24hRes,
  ] = await Promise.all([
    supabase.from("queries").select("id", { count: "exact", head: true }),
    supabase.from("queries").select("id", { count: "exact", head: true }).gte("created_at", `${today}T00:00:00`),
    supabase.from("queries").select("spoiler_tier"),
    supabase.from("queries").select("created_at").gte("created_at", sevenDaysAgo),
    supabase.from("queries")
      .select("id, question, spoiler_tier, tokens_used, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("queries").select("tokens_used"),
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("tier", "premium"),
    supabase.from("waitlist").select("id", { count: "exact", head: true }),
    supabase.from("knowledge_chunks").select("content_type"),
    supabase.from("error_logs").select("id, error_type, message, context, client_ip, created_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", oneDayAgo),
  ]);

  // Tier breakdown (2-tier system; legacy "guide" rows folded into "full")
  const tierCounts = { nudge: 0, full: 0 };
  for (const row of tierBreakdownRes.data ?? []) {
    const t = row.spoiler_tier as string;
    if (t === "nudge") tierCounts.nudge++;
    else if (t === "full" || t === "guide") tierCounts.full++;
  }

  // Last 7 days
  const dayMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    dayMap[d] = 0;
  }
  for (const row of last7DaysRes.data ?? []) {
    const d = (row.created_at as string).split("T")[0];
    if (d in dayMap) dayMap[d]++;
  }
  const last7Days = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

  // Total tokens
  const totalTokens = (tokensRes.data ?? []).reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

  // Knowledge chunks by type
  const typeMap: Record<string, number> = {};
  for (const row of knowledgeRes.data ?? []) {
    const t = row.content_type as string;
    typeMap[t] = (typeMap[t] ?? 0) + 1;
  }

  return NextResponse.json({
    overview: {
      totalQueries: totalQueriesRes.count ?? 0,
      queriesToday: queriesTodayRes.count ?? 0,
      totalUsers: totalUsersRes.count ?? 0,
      premiumUsers: premiumUsersRes.count ?? 0,
      waitlistCount: waitlistRes.count ?? 0,
      totalTokens,
      errorsLast24h: errorsLast24hRes.count ?? 0,
    },
    tierBreakdown: tierCounts,
    last7Days,
    recentQueries: recentQueriesRes.data ?? [],
    knowledgeStats: {
      total: knowledgeRes.data?.length ?? 0,
      byType: typeMap,
    },
    recentErrors: recentErrorsRes.data ?? [],
  });
}
