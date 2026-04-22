import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
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
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || envVars.STRIPE_SECRET_KEY || "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

export async function POST(req: NextRequest) {
  if (!STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const { userId } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: userData } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (!userData?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const origin = req.headers.get("origin") || "https://crimson-guide.vercel.app";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: userData.stripe_customer_id,
    return_url: `${origin}/`,
  });

  return NextResponse.json({ url: portalSession.url });
}
