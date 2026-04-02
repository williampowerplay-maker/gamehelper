"use client";

import { useEffect, useRef } from "react";

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
    <div className={`flex justify-center ${className}`} ref={adRef}>
      <ins
        className={`adsbygoogle block ${sizeClass}`}
        style={{ display: "block" }}
        data-ad-client={process.env.NEXT_PUBLIC_ADSENSE_ID || ""}
        data-ad-slot={slot}
        data-ad-format={format === "rectangle" ? "auto" : "horizontal"}
        data-full-width-responsive="true"
      />
    </div>
  );
}
