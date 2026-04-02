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

function escapeCSV(val: string | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get("authorization");
  if (!ADMIN_SECRET || authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // "waitlist" | "users"

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

  return NextResponse.json(
    { error: 'Missing ?type= param. Use type=waitlist or type=users' },
    { status: 400 }
  );
}
