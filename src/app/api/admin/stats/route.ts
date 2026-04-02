import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "").trim();

  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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
  ]);

  // Tier breakdown
  const tierCounts = { nudge: 0, guide: 0, full: 0 };
  for (const row of tierBreakdownRes.data ?? []) {
    const t = row.spoiler_tier as keyof typeof tierCounts;
    if (t in tierCounts) tierCounts[t]++;
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
    },
    tierBreakdown: tierCounts,
    last7Days,
    recentQueries: recentQueriesRes.data ?? [],
    knowledgeStats: {
      total: knowledgeRes.data?.length ?? 0,
      byType: typeMap,
    },
  });
}
