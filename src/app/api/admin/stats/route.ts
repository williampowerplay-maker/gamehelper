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
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

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

// ── API pricing (as of 2025) ──────────────────────────────────────────────────
// claude-haiku-4-5-20251001  → nudge tier
// claude-sonnet-4-20250514   → full tier
// voyage-3.5-lite            → all embeddings
const PRICING = {
  haiku:  { input: 0.80 / 1_000_000, output: 4.00  / 1_000_000 },
  sonnet: { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  voyage: 0.02 / 1_000_000,
};
// Fallback avg input token counts for historical rows (input_tokens column defaulted 0)
const AVG_INPUT = { nudge: 1_500, full: 2_800 };
// Avg Voyage tokens per query (short question text ~15-20 tokens)
const AVG_VOYAGE_TOKENS = 20;

interface RawCostWindow {
  nudge_output_tokens: number;
  nudge_input_tokens:  number;
  full_output_tokens:  number;
  full_input_tokens:   number;
  total_queries:       number;
  nudge_queries:       number;
  full_queries:        number;
}

function calcCost(w: RawCostWindow) {
  // Use actual input tokens if they look real (avg ≥ 200 tokens/query means recorded data).
  // For historical rows where input_tokens defaulted to 0, fall back to avg estimates.
  const avgNudgeInput = w.nudge_queries > 0 ? w.nudge_input_tokens / w.nudge_queries : 0;
  const avgFullInput  = w.full_queries  > 0 ? w.full_input_tokens  / w.full_queries  : 0;
  const nudgeInput = avgNudgeInput >= 200 ? w.nudge_input_tokens : w.nudge_queries * AVG_INPUT.nudge;
  const fullInput  = avgFullInput  >= 200 ? w.full_input_tokens  : w.full_queries  * AVG_INPUT.full;

  const haiku  = nudgeInput * PRICING.haiku.input  + w.nudge_output_tokens * PRICING.haiku.output;
  const sonnet = fullInput  * PRICING.sonnet.input + w.full_output_tokens  * PRICING.sonnet.output;
  const voyage = w.total_queries * AVG_VOYAGE_TOKENS * PRICING.voyage;
  const total  = haiku + sonnet + voyage;

  const perQueryNudge   = w.nudge_queries > 0 ? (haiku  + w.nudge_queries * AVG_VOYAGE_TOKENS * PRICING.voyage) / w.nudge_queries : 0;
  const perQueryFull    = w.full_queries  > 0 ? (sonnet + w.full_queries  * AVG_VOYAGE_TOKENS * PRICING.voyage) / w.full_queries  : 0;
  const perQueryOverall = w.total_queries > 0 ? total / w.total_queries : 0;

  return { haiku, sonnet, voyage, total, perQueryNudge, perQueryFull, perQueryOverall };
}

export async function GET(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (!auth.ok) return auth.response!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

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
    queriesLastHourRes,
    ipLast24hRes,
    contentGapsRes,
    cacheHitsRes,
    totalCachedWindowRes,
    activeUsersRes,
    costStatsRes,
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
    supabase.from("queries").select("id", { count: "exact", head: true }).gte("created_at", oneHourAgo),
    supabase.from("queries").select("client_ip").gte("created_at", oneDayAgo),
    supabase.from("queries")
      .select("id, question, spoiler_tier, created_at")
      .eq("content_gap", true)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("queries").select("id", { count: "exact", head: true }).eq("cache_hit", true).gte("created_at", sevenDaysAgo),
    supabase.from("queries").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    supabase.from("users").select("id, queries_today, tier").gt("queries_today", 0).order("queries_today", { ascending: false }).limit(10),
    supabase.rpc("get_cost_stats"),
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

  // Cache hit rate (last 7 days)
  const cacheHits = cacheHitsRes.count ?? 0;
  const totalCached = totalCachedWindowRes.count ?? 0;
  const cacheHitRate = totalCached > 0 ? Math.round((cacheHits / totalCached) * 100) : 0;

  // Query rate averages (rolling windows)
  const queriesLastHour = queriesLastHourRes.count ?? 0;
  const queriesLast24h = ipLast24hRes.data?.length ?? 0;
  const queriesLast7d = last7DaysRes.data?.length ?? 0;
  const queryRates = {
    avgPerMinute: parseFloat((queriesLastHour / 60).toFixed(2)),
    avgPerHour:   parseFloat((queriesLast24h / 24).toFixed(1)),
    avgPerDay:    parseFloat((queriesLast7d / 7).toFixed(1)),
    lastHourTotal:  queriesLastHour,
    last24hTotal:   queriesLast24h,
  };

  // Top IPs by query count (last 24h) — flag outliers above free daily limit (30)
  const ipMap: Record<string, number> = {};
  for (const row of ipLast24hRes.data ?? []) {
    const ip = (row.client_ip as string | null) ?? "unknown";
    ipMap[ip] = (ipMap[ip] ?? 0) + 1;
  }
  const topIps = Object.entries(ipMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([ip, count]) => ({
      ip,
      count,
      // suspicious = exceeds free daily limit; likely abuse or needs premium
      suspicious: count > 30,
    }));

  // ── Cost stats ────────────────────────────────────────────────────────────
  const rawCost = costStatsRes.data as {
    allTime:   RawCostWindow;
    last7Days: RawCostWindow;
    today:     RawCostWindow;
  } | null;

  const zeroWindow: RawCostWindow = {
    nudge_output_tokens: 0, nudge_input_tokens: 0,
    full_output_tokens: 0,  full_input_tokens: 0,
    total_queries: 0, nudge_queries: 0, full_queries: 0,
  };

  const allTimeCost   = calcCost(rawCost?.allTime   ?? zeroWindow);
  const sevenDayCost  = calcCost(rawCost?.last7Days ?? zeroWindow);
  const todayCost     = calcCost(rawCost?.today     ?? zeroWindow);

  const totalUsersCount   = totalUsersRes.count ?? 1;
  const activeUsersCount  = Math.max(activeUsersRes.data?.length ?? 0, 1);
  const premiumCount      = premiumUsersRes.count ?? 0;
  const freeCount         = Math.max(totalUsersCount - premiumCount, 0);

  const costStats = {
    allTime: {
      total:   allTimeCost.total,
      haiku:   allTimeCost.haiku,
      sonnet:  allTimeCost.sonnet,
      voyage:  allTimeCost.voyage,
      perQueryNudge:   allTimeCost.perQueryNudge,
      perQueryFull:    allTimeCost.perQueryFull,
      perQueryOverall: allTimeCost.perQueryOverall,
    },
    last7Days: {
      total:   sevenDayCost.total,
      haiku:   sevenDayCost.haiku,
      sonnet:  sevenDayCost.sonnet,
      voyage:  sevenDayCost.voyage,
      // avg per user per day over the 7-day window
      avgPerUserPerDay: totalUsersCount > 0 ? sevenDayCost.total / totalUsersCount / 7 : 0,
      avgPerActiveUserPerDay: sevenDayCost.total / activeUsersCount / 7,
      projectedMonthly: (sevenDayCost.total / 7) * 30,
    },
    today: {
      total:   todayCost.total,
      haiku:   todayCost.haiku,
      sonnet:  todayCost.sonnet,
      voyage:  todayCost.voyage,
      // avg cost per user who queried today
      avgPerActiveUser: todayCost.total / activeUsersCount,
      // rough per-tier user cost estimate (split total proportionally by model usage)
      avgPerFreeUser:    freeCount  > 0 ? todayCost.haiku  / Math.max(freeCount,    1) : 0,
      avgPerPremiumUser: premiumCount > 0 ? todayCost.sonnet / Math.max(premiumCount, 1) : 0,
    },
    pricing: {
      haikuInputPerMToken:   PRICING.haiku.input  * 1_000_000,
      haikuOutputPerMToken:  PRICING.haiku.output * 1_000_000,
      sonnetInputPerMToken:  PRICING.sonnet.input * 1_000_000,
      sonnetOutputPerMToken: PRICING.sonnet.output * 1_000_000,
      voyagePerMToken:       PRICING.voyage       * 1_000_000,
    },
  };

  // Active users today — join public.users.queries_today with auth emails
  const activeUsersRaw = activeUsersRes.data ?? [];
  let activeUsers: { email: string; queries_today: number; tier: string }[] = [];
  if (activeUsersRaw.length > 0) {
    try {
      const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const emailById: Record<string, string> = {};
      for (const u of authData?.users ?? []) {
        emailById[u.id] = u.email ?? "unknown";
      }
      activeUsers = activeUsersRaw.map((u) => ({
        email: emailById[u.id] ?? "unknown",
        queries_today: u.queries_today as number,
        tier: (u.tier as string) ?? "free",
      }));
    } catch {
      // Non-fatal — return empty if auth admin call fails
      activeUsers = [];
    }
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
    queryRates,
    topIps,
    contentGaps: contentGapsRes.data ?? [],
    cacheHitRate,
    cacheHits,
    activeUsers,
    costStats,
  });
}
