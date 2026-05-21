"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

interface AdBannerProps {
  slot: string;
  format?: "horizontal" | "rectangle";
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle: Record<string, unknown>[];
  }
}

export default function AdBanner({ slot, format = "horizontal", className = "" }: AdBannerProps) {
  const adRef = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      // AdSense not loaded or blocked
    }
  }, []);

  const sizeClass = format === "rectangle"
    ? "min-h-[250px] w-[300px]"
    : "min-h-[100px] w-full";

  return (
    // border-top + py-2 gives a clear visual separator between chat content and
    // ad inventory (AdSense policy: ads must be distinguishable from site content).
    <div className={`${className} border-t border-[#2a2a3a] pt-3`} ref={adRef}>
      {/* "Advertisement" label per AdSense policy 2.1 — bumped from 10px gray-600
          to 12px gray-500 for clearer disclosure on the dark background. */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Advertisement</span>
        <Link
          href="/upgrade"
          className="text-xs text-red-500/80 hover:text-red-400 transition-colors"
        >
          Remove ads — Upgrade
        </Link>
      </div>
      <div className="flex justify-center">
        <ins
          className={`adsbygoogle block ${sizeClass}`}
          style={{ display: "block" }}
          data-ad-client={process.env.NEXT_PUBLIC_ADSENSE_ID || ""}
          data-ad-slot={slot}
          data-ad-format={format === "rectangle" ? "auto" : "horizontal"}
          data-full-width-responsive="true"
        />
      </div>
    </div>
  );
}
