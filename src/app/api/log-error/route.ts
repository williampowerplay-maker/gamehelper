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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// Simple rate limit: max 10 error log submissions per IP per minute
// Prevents DB flooding via this unauthenticated endpoint
const logRateMap: Map<string, { count: number; resetAt: number }> = new Map();

function isLogRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = logRateMap.get(ip);
  if (!record || now >= record.resetAt) {
    logRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  record.count++;
  return record.count > 10;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (isLogRateLimited(ip)) {
      return NextResponse.json({ ok: true }); // Silently drop — don't reveal the limit
    }

    const body = await req.json();
    const { errorType, message, stack, context } = body;

    if (!errorType || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Truncate stack to 2000 chars max
    const trimmedStack = stack ? String(stack).slice(0, 2000) : null;

    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from("error_logs").insert({
      error_type: String(errorType).slice(0, 50),
      message: String(message).slice(0, 500),
      stack: trimmedStack,
      context: context || null,
      client_ip: getClientIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Don't log errors about logging errors — just return ok
    console.error("log-error endpoint failure:", err);
    return NextResponse.json({ ok: true });
  }
}
