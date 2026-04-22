"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export default function UpgradeSuccessPage() {
  const { refreshProfile, user } = useAuth();
  const [refreshed, setRefreshed] = useState(false);

  // Refresh the user's tier from Supabase — the webhook may have already fired
  useEffect(() => {
    if (user && !refreshed) {
      // Give the webhook a moment to process, then re-fetch the profile
      const timer = setTimeout(async () => {
        await refreshProfile();
        setRefreshed(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [user, refreshed, refreshProfile]);

  return (
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", background: "#0e0e16", color: "#e5e7eb" }}>
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="flex justify-center mb-6">
          <Image src="/logo.webp" alt="Crimson Desert Guide" width={72} height={72} />
        </div>

        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 mb-6">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-100 mb-2">You're Premium!</h1>
        <p className="text-gray-400 text-sm mb-2">
          Your subscription is active. You now have 200 questions per day,
          ad-free responses, and full access to the Solution spoiler tier.
        </p>
        <p className="text-xs text-gray-600 mb-8">
          If your account doesn't reflect Premium immediately, sign out and back in — it updates within a minute.
        </p>

        <Link
          href="/"
          className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl px-8 py-3 transition-colors"
        >
          Start asking questions →
        </Link>

        <p className="mt-6 text-xs text-gray-600">
          Need to manage or cancel your subscription?{" "}
          <Link href="/upgrade" className="text-gray-500 hover:text-gray-300 underline underline-offset-2">
            Billing settings
          </Link>
        </p>
      </div>
    </div>
  );
}
