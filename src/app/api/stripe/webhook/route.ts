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
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || envVars.STRIPE_WEBHOOK_SECRET || "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY || "";

// Next.js App Router: read raw body for Stripe signature verification
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  switch (event.type) {
    // Payment succeeded — upgrade user to premium
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (userId) {
        await supabase.from("users").update({
          tier: "premium",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        }).eq("id", userId);
      }
      break;
    }

    // Subscription renewed — keep premium active (no-op but good to handle)
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      await supabase.from("users").update({ tier: "premium" })
        .eq("stripe_customer_id", customerId);
      break;
    }

    // Payment failed — grace period; don't downgrade immediately
    // Stripe will retry; if it ultimately fails it fires customer.subscription.deleted
    case "invoice.payment_failed": {
      // No action — let Stripe's retry logic handle it
      break;
    }

    // Subscription cancelled or expired — downgrade to free
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      await supabase.from("users").update({
        tier: "free",
        stripe_subscription_id: null,
      }).eq("stripe_customer_id", customerId);
      break;
    }

    default:
      // Unhandled event type — ignore
      break;
  }

  return NextResponse.json({ received: true });
}
