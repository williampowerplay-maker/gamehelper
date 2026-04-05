"use client";

import { type SpoilerTier } from "@/lib/supabase";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  spoilerTier?: SpoilerTier;
  sources?: { title: string; url: string }[];
}

const tierBadge: Record<SpoilerTier, { label: string; color: string }> = {
  nudge: { label: "Nudge", color: "bg-green-500/20 text-green-400" },
  full: { label: "Solution", color: "bg-red-500/20 text-red-400" },
};

export default function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-red-600/20 border border-red-500/30 text-gray-100"
            : "bg-[#1a1a24] border border-[#2a2a3a] text-gray-200"
        }`}
      >
        {/* Spoiler tier badge for AI responses */}
        {!isUser && message.spoilerTier && (
          <div className="mb-2">
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tierBadge[message.spoilerTier].color}`}
            >
              {tierBadge[message.spoilerTier].label}
            </span>
          </div>
        )}

        {/* Message content */}
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>

        {/* Source links */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-2 border-t border-[#2a2a3a]">
            <p className="text-xs text-gray-500 mb-1">Sources:</p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((source, i) => (
                <a
                  key={i}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-red-400 hover:text-red-300 underline"
                >
                  {source.title}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Voice playback button for AI responses */}
        {!isUser && (
          <button
            className="mt-2 text-gray-500 hover:text-gray-300 transition-colors"
            title="Listen to response"
            onClick={() => {
              const utterance = new SpeechSynthesisUtterance(message.content);
              speechSynthesis.speak(utterance);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 01-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
              <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export type { Message };
