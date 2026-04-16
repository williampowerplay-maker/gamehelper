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
    <div className={`${className}`} ref={adRef}>
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider">Advertisement</span>
        <Link
          href="/upgrade"
          className="text-[10px] text-red-500/70 hover:text-red-400 transition-colors"
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
