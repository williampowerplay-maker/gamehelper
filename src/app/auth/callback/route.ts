import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually for local dev (Next 16 / Node 24 workaround).
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
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

// Validates a relative path so we don't open-redirect to arbitrary hosts.
// Accept only paths that start with a single "/" and not "//" (which would
// be an authority-relative URL → external).
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const intent = searchParams.get("intent");
  const returnTo = safeReturnTo(searchParams.get("returnTo"));

  // Exchange code for session. The anon-key client is correct here — the
  // auth-code exchange is a public flow, not a privileged one.
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (code) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    userId = data?.user?.id ?? null;
    userEmail = data?.user?.email ?? null;
  }

  // Auto-join waitlist when the pre-sign-in click carried that intent.
  // Service-role insert; idempotent via the table's UNIQUE(user_id).
  if (intent === "waitlist" && userId && userEmail) {
    try {
      const admin = createClient(supabaseUrl, supabaseServiceKey);
      const { error } = await admin
        .from("upgrade_waitlist")
        .insert({
          user_id: userId,
          email: userEmail,
          source: "auth-callback",
        });
      // 23505 (already on list) is fine. Other errors: log to error_logs
      // best-effort, but don't block the redirect — we don't want a flaky
      // server-side insert to leave the user stuck on /auth/callback.
      if (error && error.code !== "23505") {
        await admin.from("error_logs").insert({
          error_type: "auth_callback_waitlist_autojoin",
          message: error.message,
          context: { code: error.code, user_id: userId },
        }).then(() => {}, () => {});
      }
    } catch {
      // Swallow — fall through to redirect.
    }
  }

  return NextResponse.redirect(new URL(returnTo, req.url));
}
