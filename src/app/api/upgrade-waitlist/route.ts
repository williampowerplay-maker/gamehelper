import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Load .env.local manually for local dev (Next 16 / Node 24 workaround).
// Matches the pattern used by every other API route in this project.
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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

const ALLOWED_SOURCES = new Set([
  "upgrade-banner",
  "upgrade-page",
  "settings",
  "auth-callback",
]);

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function recordError(
  supabase: SupabaseClient,
  message: string,
  context: Record<string, unknown>,
  clientIp: string,
) {
  try {
    await supabase.from("error_logs").insert({
      error_type: "api_upgrade_waitlist",
      message,
      context,
      client_ip: clientIp,
    });
  } catch { /* swallow logging errors */ }
}

// Resolves the authenticated user from the Bearer token. Returns null if
// the token is missing or invalid. Same approach as /api/chat (line 290–298).
async function getAuthedUser(req: NextRequest, supabase: SupabaseClient) {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ?? null;
}

// ───────────────────────────────────────────────────────────────────
// POST /api/upgrade-waitlist
// Body: { source?: string }
// Requires a valid Supabase session (Bearer token). Email is pulled
// from the authenticated user — never trusted from client input.
// Insert is idempotent via ON CONFLICT (user_id) DO NOTHING.
// Returns { joined: true, alreadyOnList: boolean }.
// ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const clientIp = getClientIp(req);

  try {
    const user = await getAuthedUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!user.email) {
      // Edge case — Supabase user without email (some OAuth providers can
      // produce these). We require an email to make the export useful.
      return NextResponse.json(
        { error: "Account has no email; cannot join waitlist." },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawSource = (body && typeof body === "object")
      ? (body as Record<string, unknown>).source
      : undefined;
    const source = typeof rawSource === "string" && ALLOWED_SOURCES.has(rawSource)
      ? rawSource
      : null;

    // Idempotent insert. Postgres returns the inserted row if it actually
    // inserted, OR an empty array if the conflict target matched. We use
    // that to tell the client whether they were already on the list.
    const { data, error } = await supabase
      .from("upgrade_waitlist")
      .insert({
        user_id: user.id,
        email: user.email,
        source,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation on user_id — already on the list.
      // Treat as success; the action is idempotent by design.
      if (error.code === "23505") {
        return NextResponse.json({ joined: true, alreadyOnList: true });
      }
      // 23503 = FK violation on auth.users — shouldn't happen after
      // getUser() succeeded, but defensive.
      if (error.code === "23503") {
        return NextResponse.json({ error: "Unknown user" }, { status: 400 });
      }
      await recordError(
        supabase,
        error.message,
        { code: error.code, stage: "POST.insert", user_id: user.id },
        clientIp,
      );
      return NextResponse.json({ error: "Failed to join waitlist" }, { status: 500 });
    }

    return NextResponse.json({ joined: true, alreadyOnList: false, row: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordError(supabase, msg, { stage: "POST.catch" }, clientIp);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ───────────────────────────────────────────────────────────────────
// GET /api/upgrade-waitlist
// Requires Bearer token. Returns { onList: boolean }.
// Used as a fallback when the auth-context check hasn't loaded yet,
// or for components that don't have access to AuthContext.
// ───────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const clientIp = getClientIp(req);

  try {
    const user = await getAuthedUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { count, error } = await supabase
      .from("upgrade_waitlist")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (error) {
      await recordError(
        supabase,
        error.message,
        { stage: "GET.count", user_id: user.id },
        clientIp,
      );
      return NextResponse.json({ error: "Failed to check waitlist" }, { status: 500 });
    }

    return NextResponse.json({ onList: (count ?? 0) > 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordError(supabase, msg, { stage: "GET.catch" }, clientIp);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
