"use client";

export default function UpgradeCTA({ rateLimitHit = false }: { rateLimitHit?: boolean }) {
  return (
    <div className="my-4 mx-auto max-w-md bg-gradient-to-r from-red-600/10 to-amber-500/10 border border-red-500/20 rounded-2xl px-5 py-4 text-center">
      <p className="text-sm font-medium text-gray-200 mb-1">
        {rateLimitHit ? "You've reached your free limit" : "Enjoying the guide?"}
      </p>
      <p className="text-xs text-gray-400 mb-3">
        {rateLimitHit
          ? "Upgrade to Premium for higher limits, ad-free experience, and full solutions."
          : "Go premium for ad-free, unlimited full solutions, and premium voice."}
      </p>
      <button className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl px-5 py-2 transition-colors">
        Upgrade — $4.99/mo
      </button>
    </div>
  );
}
