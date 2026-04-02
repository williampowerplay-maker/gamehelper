"use client";

import { useEffect } from "react";
import { logClientError } from "@/lib/logError";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logClientError(
      "unhandled",
      error?.message || "Unhandled Next.js error",
      error?.stack,
      { digest: error?.digest, url: typeof window !== "undefined" ? window.location.pathname : "" }
    );
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e0e16] px-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">💀</div>
        <h1 className="text-2xl font-bold text-gray-100 mb-2">
          <span className="text-red-500">Crimson</span> Desert Guide
        </h1>
        <p className="text-gray-400 mb-2 text-sm">
          Something went wrong on our end.
        </p>
        <p className="text-gray-600 text-xs mb-8 font-mono">
          {error?.message || "Unknown error"}
          {error?.digest && (
            <span className="block mt-1 text-gray-700">ref: {error.digest}</span>
          )}
        </p>
        <button
          onClick={reset}
          className="bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg px-6 py-2.5 transition-colors text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
