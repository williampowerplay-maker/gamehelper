import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Load .env.local manually for local dev (Next 16 / Node 24 workaround).
// In production (Vercel), process.env is populated directly. Matches the
// pattern used by every other API route in this project.
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

const FEEDBACK_SESSION_COOKIE = "feedback_session";
const ALLOWED_RATINGS = ["up", "down"] as const;
const ALLOWED_REASONS = ["wrong_info", "spoiled_answer", "unhelpful", "other"] as const;
const ALLOWED_MODES = ["nudge", "full"] as const;

type Rating = (typeof ALLOWED_RATINGS)[number];
type Reason = (typeof ALLOWED_REASONS)[number];
type Mode = (typeof ALLOWED_MODES)[number];

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Non-blocking error_logs insert — same pattern used elsewhere.
async function recordError(supabase: SupabaseClient, message: string, context: Record<string, unknown>, clientIp: string) {
  try {
    await supabase.from("error_logs").insert({
      error_type: "api_feedback",
      message,
      context,
      client_ip: clientIp,
    });
  } catch { /* swallow logging errors */ }
}

// ───────────────────────────────────────────────────────────────────
// POST /api/feedback
// Body: { message_id, rating, reason?, mode }
// Upserts the (message_id, session_id) row. On up-vote, reason is
// explicitly forced to null (so a prior down-vote's reason doesn't
// linger after the user changes their mind).
// ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const clientIp = getClientIp(req);

  try {
    const sessionId = req.cookies.get(FEEDBACK_SESSION_COOKIE)?.value;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing feedback_session cookie" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const message_id = (body as Record<string, unknown>).message_id;
    const rating = (body as Record<string, unknown>).rating;
    const reason = (body as Record<string, unknown>).reason;
    const mode = (body as Record<string, unknown>).mode;

    if (typeof message_id !== "string" || message_id.length === 0) {
      return NextResponse.json({ error: "Missing or invalid message_id" }, { status: 400 });
    }
    if (typeof rating !== "string" || !ALLOWED_RATINGS.includes(rating as Rating)) {
      return NextResponse.json({ error: "Invalid rating (must be 'up' or 'down')" }, { status: 400 });
    }
    if (typeof mode !== "string" || !ALLOWED_MODES.includes(mode as Mode)) {
      return NextResponse.json({ error: "Invalid mode (must be 'nudge' or 'full')" }, { status: 400 });
    }

    // Resolve `reason`:
    // - up-vote → ALWAYS null (overrides any client-supplied value so a prior
    //   down-vote's reason is cleared on the same row).
    // - down-vote with no reason → null (user thumb-downed but hasn't picked yet).
    // - down-vote with reason → must be in allowed set; otherwise 400.
    let resolvedReason: Reason | null = null;
    if (rating === "down" && reason !== undefined && reason !== null) {
      if (typeof reason !== "string" || !ALLOWED_REASONS.includes(reason as Reason)) {
        return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
      }
      resolvedReason = reason as Reason;
    }

    const { data, error } = await supabase
      .from("feedback")
      .upsert(
        {
          message_id,
          session_id: sessionId,
          rating,
          reason: resolvedReason,
          mode,
        },
        { onConflict: "message_id,session_id" }
      )
      .select()
      .single();

    if (error) {
      // FK violation on message_id (queries row doesn't exist)
      if (error.code === "23503") {
        return NextResponse.json({ error: "Unknown message_id" }, { status: 400 });
      }
      // CHECK constraint violation (shouldn't happen since we validated, but defensive)
      if (error.code === "23514") {
        return NextResponse.json({ error: "Constraint violation" }, { status: 400 });
      }
      await recordError(supabase, error.message, { code: error.code, stage: "POST.upsert" }, clientIp);
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    return NextResponse.json({ feedback: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordError(supabase, msg, { stage: "POST.catch" }, clientIp);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ───────────────────────────────────────────────────────────────────
// GET /api/feedback?message_id=<uuid>
// Returns the current session's vote for that message_id (or null).
// Used by the MessageFeedback UI on mount to hydrate state across
// page loads + navigation.
// ───────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const clientIp = getClientIp(req);

  try {
    const sessionId = req.cookies.get(FEEDBACK_SESSION_COOKIE)?.value;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing feedback_session cookie" }, { status: 400 });
    }

    const messageId = req.nextUrl.searchParams.get("message_id");
    if (!messageId) {
      return NextResponse.json({ error: "Missing message_id query parameter" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("feedback")
      .select("rating, reason, mode, created_at, updated_at")
      .eq("message_id", messageId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      await recordError(supabase, error.message, { stage: "GET", message_id: messageId }, clientIp);
      return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });
    }

    return NextResponse.json({ feedback: data ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordError(supabase, msg, { stage: "GET.catch" }, clientIp);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
