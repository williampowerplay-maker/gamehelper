"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

const FREE_FEATURES = [
  "5 questions per day",
  "Nudge spoiler tier only",
  "Boss strategies, item locations, puzzles",
  "Ads between responses",
];

const PREMIUM_FEATURES = [
  "200 questions per day",
  "Ad-free experience",
  "Nudge & Solution spoiler tiers",
  "Priority answers",
  "Support development of the guide",
];

export default function UpgradePage() {
  const { user, tier } = useAuth();
  const router = useRouter();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  // Email notify form — for signed-out visitors
  const [email, setEmail] = useState("");
  const [notifyStatus, setNotifyStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleSubscribe = async () => {
    if (!user) {
      // Shouldn't happen — button is hidden for logged-out users — but just in case
      router.push("/");
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, userEmail: user.email }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setCheckoutError("Something went wrong. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManageBilling = async () => {
    if (!user) return;
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setPortalLoading(false);
    }
  };

  const handleNotify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setNotifyStatus("submitting");
    const { error } = await supabase
      .from("waitlist")
      .upsert({ email: email.trim().toLowerCase() }, { onConflict: "email" });
    setNotifyStatus(error ? "error" : "success");
  };

  return (
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", background: "#0e0e16", color: "#e5e7eb" }}>
      <div className="max-w-3xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-2 mb-6 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            ← Back to guide
          </Link>
          <div className="flex justify-center mb-4">
            <Image src="/logo.webp" alt="Crimson Desert Guide" width={56} height={56} />
          </div>
          <h1 className="text-3xl font-bold mb-2">
            <span className="text-red-500">Crimson</span>{" "}
            <span className="text-gray-100">Desert Guide</span>
          </h1>
          <p className="text-gray-400 text-sm">Upgrade to Premium for the full experience</p>
        </div>

        {/* Plan comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">

          {/* Free */}
          <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-2xl p-6">
            <div className="mb-4">
              <span className="inline-block bg-gray-700 text-gray-400 text-xs font-medium px-2.5 py-1 rounded-full mb-3">Free</span>
              <p className="text-3xl font-bold text-gray-100">$0</p>
              <p className="text-xs text-gray-500 mt-1">forever</p>
            </div>
            <ul className="space-y-2.5">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-400">
                  <span className="text-gray-600 mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Premium */}
          <div className="bg-gradient-to-b from-red-600/10 to-[#1a1a24] border border-red-500/30 rounded-2xl p-6 relative">
            {tier === "premium" && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-amber-500 text-white text-xs font-semibold px-3 py-1 rounded-full">Your Plan</span>
              </div>
            )}
            <div className="mb-4">
              <span className="inline-block bg-amber-500/20 text-amber-400 text-xs font-medium px-2.5 py-1 rounded-full mb-3">Premium</span>
              <p className="text-3xl font-bold text-gray-100">$4.99<span className="text-base font-normal text-gray-500">/mo</span></p>
              <p className="text-xs text-gray-500 mt-1">cancel anytime</p>
            </div>
            <ul className="space-y-2.5 mb-6">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                  <span className="text-red-400 mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {/* CTA — varies by auth + tier state */}
            {tier === "premium" ? (
              <button
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="w-full bg-[#2a2a3a] hover:bg-[#333345] disabled:opacity-50 text-gray-300 text-sm font-medium rounded-xl py-2.5 transition-colors"
              >
                {portalLoading ? "Loading..." : "Manage billing"}
              </button>
            ) : (
              <div>
                <button
                  disabled
                  className="w-full bg-[#2a2a3a] text-gray-500 text-sm font-semibold rounded-xl py-3 cursor-not-allowed"
                >
                  Coming Soon
                </button>
                <p className="text-xs text-gray-600 text-center mt-2">Premium subscriptions launching soon</p>
              </div>
            )}
          </div>
        </div>

        {/* Notify form — only for signed-out users who aren't subscribed */}
        {!user && (
          <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-2xl p-6 text-center max-w-md mx-auto">
            {notifyStatus === "success" ? (
              <div>
                <p className="text-green-400 font-medium mb-1">You're on the list!</p>
                <p className="text-sm text-gray-500">We'll email you with updates.</p>
                <Link href="/" className="inline-block mt-4 text-sm text-red-400 hover:text-red-300 transition-colors">
                  Back to guide →
                </Link>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-200 mb-1">Get notified about updates</p>
                <p className="text-xs text-gray-500 mb-4">Drop your email to stay in the loop.</p>
                <form onSubmit={handleNotify} className="flex gap-2">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="flex-1 bg-[#0e0e16] border border-[#2a2a3a] rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-red-500/50"
                  />
                  <button
                    type="submit"
                    disabled={notifyStatus === "submitting"}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors whitespace-nowrap"
                  >
                    {notifyStatus === "submitting" ? "..." : "Notify me"}
                  </button>
                </form>
                {notifyStatus === "error" && (
                  <p className="text-xs text-red-400 mt-2">Something went wrong. Try again.</p>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
