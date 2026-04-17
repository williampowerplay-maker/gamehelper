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

function escapeCSV(val: string | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const ALLOWED_EXPORT_TYPES = ["waitlist", "users", "content-gaps"] as const;

export async function GET(req: NextRequest) {
  const auth = checkAdminAuth(req);
  if (!auth.ok) return auth.response!;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");

  // Explicit allowlist — reject unknown export types
  if (!type || !ALLOWED_EXPORT_TYPES.includes(type as typeof ALLOWED_EXPORT_TYPES[number])) {
    return NextResponse.json({ error: "Invalid ?type= param. Use type=waitlist or type=users" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (type === "waitlist") {
    const { data, error } = await supabase
      .from("waitlist")
      .select("email, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const csv = [
      "email,signed_up_at",
      ...rows.map((r) => `${escapeCSV(r.email)},${escapeCSV(r.created_at)}`),
    ].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  if (type === "content-gaps") {
    const { data, error } = await supabase
      .from("queries")
      .select("question, spoiler_tier, created_at")
      .eq("content_gap", true)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = data ?? [];
    const csv = [
      "question,spoiler_tier,asked_at",
      ...rows.map((r) =>
        [escapeCSV(r.question), escapeCSV(r.spoiler_tier), escapeCSV(r.created_at)].join(",")
      ),
    ].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="content-gaps-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  if (type === "users") {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, tier, queries_today, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const csv = [
      "id,email,tier,queries_today,signed_up_at",
      ...rows.map((r) =>
        [
          escapeCSV(r.id),
          escapeCSV(r.email),
          escapeCSV(r.tier),
          escapeCSV(String(r.queries_today ?? 0)),
          escapeCSV(r.created_at),
        ].join(",")
      ),
    ].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

}
