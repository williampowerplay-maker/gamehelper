"use client";

import { useEffect, useState } from "react";

type Rating = "up" | "down";
type Reason = "wrong_info" | "spoiled_answer" | "unhelpful" | "other";

interface MessageFeedbackProps {
  queryId: string;          // FK to public.queries.id (DB row this message corresponds to)
  mode: "nudge" | "full";   // pass message.spoilerTier through; analytics-critical
}

const REASONS: { value: Reason; label: string }[] = [
  { value: "wrong_info",     label: "Wrong info" },
  { value: "spoiled_answer", label: "Spoiled answer" },
  { value: "unhelpful",      label: "Unhelpful" },
  { value: "other",          label: "Other" },
];

/**
 * Per-response thumbs feedback with categorized downvote reasons.
 * Mounted only when message.queryId is present (real Q+A responses).
 *
 * Behavior:
 * - Hydrates on mount via GET /api/feedback?message_id=<queryId>
 * - Doesn't render anything until hydration completes (avoids flicker)
 * - Click-the-already-selected = no-op (users switch by clicking the other thumb)
 * - In-flight POST disables buttons (prevents rapid-click races)
 * - All failures (GET 4xx, POST non-2xx, network errors) are silent — never block
 *   the user from reading the response itself. Only console.warn for debugging.
 */
export default function MessageFeedback({ queryId, mode }: MessageFeedbackProps) {
  const [hydrated, setHydrated] = useState(false);
  const [rating, setRating] = useState<Rating | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [saving, setSaving] = useState(false);

  // Initial hydration: fetch this session's existing vote for this queryId.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/feedback?message_id=${encodeURIComponent(queryId)}`)
      .then((res) => (res.ok ? res.json() : { feedback: null }))
      .then((data) => {
        if (cancelled) return;
        const fb = data?.feedback;
        if (fb && (fb.rating === "up" || fb.rating === "down")) {
          setRating(fb.rating);
          setReason(fb.reason ?? null);
        }
        setHydrated(true);
      })
      .catch((err) => {
        // Silent — feedback is non-critical
        console.warn("[MessageFeedback] hydrate failed:", err);
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [queryId]);

  async function submit(newRating: Rating, newReason: Reason | null) {
    // Snapshot previous state for revert on failure
    const prevRating = rating;
    const prevReason = reason;

    // Optimistic update — UI snaps to new state immediately
    setRating(newRating);
    setReason(newReason);
    setSaving(true);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: queryId,
          rating: newRating,
          reason: newReason,
          mode,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Silent revert — no user-visible error
      console.warn("[MessageFeedback] save failed:", err);
      setRating(prevRating);
      setReason(prevReason);
    } finally {
      setSaving(false);
    }
  }

  function handleThumbsUp() {
    if (saving || rating === "up") return;
    submit("up", null);
  }
  function handleThumbsDown() {
    if (saving || rating === "down") return;
    // Initial down-vote with no reason yet (user picks reason below)
    submit("down", null);
  }
  function handleReason(r: Reason) {
    if (saving || (rating === "down" && reason === r)) return;
    submit("down", r);
  }

  // Don't render anything until we know whether there's an existing vote
  if (!hydrated) return null;

  return (
    <div className="mt-2">
      <div
        className={`flex items-center gap-3 transition-opacity ${
          saving ? "opacity-50 pointer-events-none" : ""
        }`}
      >
        {/* Thumbs up */}
        <button
          type="button"
          onClick={handleThumbsUp}
          disabled={saving}
          title="Helpful"
          aria-label="Mark response as helpful"
          aria-pressed={rating === "up"}
          className={`transition-colors ${
            rating === "up"
              ? "text-green-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M7.493 18.5c-.425 0-.82-.236-.975-.632A7.48 7.48 0 016 15.125c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23h-.777zM2.331 10.977a11.969 11.969 0 00-.831 4.398 12 12 0 00.52 3.507c.26.85 1.084 1.368 1.973 1.368H4.9c.445 0 .72-.498.523-.898a8.963 8.963 0 01-.924-3.977c0-1.708.476-3.305 1.302-4.666.245-.403-.028-.959-.5-.959H4.25c-.832 0-1.612.453-1.918 1.227z" />
          </svg>
        </button>

        {/* Thumbs down */}
        <button
          type="button"
          onClick={handleThumbsDown}
          disabled={saving}
          title="Not helpful"
          aria-label="Mark response as not helpful"
          aria-pressed={rating === "down"}
          className={`transition-colors ${
            rating === "down"
              ? "text-red-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M15.73 5.5h1.035A7.465 7.465 0 0118 9.625a7.465 7.465 0 01-1.235 4.125h-.148c-.806 0-1.534.446-2.031 1.08a9.04 9.04 0 01-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 00-.322 1.672V21a.75.75 0 01-.75.75 2.25 2.25 0 01-2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H3.622c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 01-.068-1.285c0-2.848.992-5.464 2.649-7.521C4.537 4.247 5.136 4 5.754 4H9.77a4.5 4.5 0 011.423.23l3.114 1.04a4.5 4.5 0 001.423.23zM21.669 13.023c.536-1.362.831-2.845.831-4.398 0-1.22-.182-2.398-.52-3.507-.26-.85-1.084-1.368-1.973-1.368H19.1c-.445 0-.72.498-.523.898.591 1.2.924 2.55.924 3.977a8.958 8.958 0 01-1.302 4.666c-.245.403.028.959.5.959h1.053c.832 0 1.612-.453 1.918-1.227z" />
          </svg>
        </button>
      </div>

      {/* Reason picker — only shown when a down-vote is active */}
      {rating === "down" && (
        <div
          className={`mt-2 flex flex-wrap items-center gap-1.5 transition-opacity ${
            saving ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => handleReason(r.value)}
              disabled={saving}
              aria-pressed={reason === r.value}
              className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                reason === r.value
                  ? "bg-red-500/15 text-red-300 border-red-500/40"
                  : "bg-transparent text-gray-500 border-[#2a2a3a] hover:text-gray-300 hover:border-[#3a3a4a]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
