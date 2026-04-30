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
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || envVars.STRIPE_PRICE_ID || "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

export async function POST(req: NextRequest) {
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const { userId, userEmail } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://crimson-guide.vercel.app";

  // Look up existing Stripe customer ID for this user
  const { data: userData } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  let customerId: string = userData?.stripe_customer_id ?? "";

  // Create a Stripe customer if one doesn't exist yet
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userEmail ?? undefined,
      metadata: { supabase_user_id: userId },
    });
    customerId = customer.id;

    // Persist immediately so retries reuse the same customer
    await supabase
      .from("users")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);
  }

  // Create the Checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/upgrade`,
    // Store user ID in metadata so webhook can look up the right row
    metadata: { supabase_user_id: userId },
    subscription_data: {
      metadata: { supabase_user_id: userId },
    },
  });

  return NextResponse.json({ url: session.url });
}
