"use client";

import { type SpoilerTier } from "@/lib/supabase";

const tiers: { id: SpoilerTier; label: string; desc: string; icon: string }[] =
  [
    {
      id: "nudge",
      label: "Nudge",
      desc: "A gentle hint",
      icon: "\u{1F441}",
    },
    {
      id: "guide",
      label: "Guide",
      desc: "Step-by-step help",
      icon: "\u{1F4D6}",
    },
    {
      id: "full",
      label: "Full Solution",
      desc: "Complete answer",
      icon: "\u{1F4A1}",
    },
  ];

export default function SpoilerTierSelector({
  selected,
  onChange,
}: {
  selected: SpoilerTier;
  onChange: (tier: SpoilerTier) => void;
}) {
  return (
    <div className="flex gap-2">
      {tiers.map((tier) => (
        <button
          key={tier.id}
          onClick={() => onChange(tier.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
            ${
              selected === tier.id
                ? "bg-red-600/20 text-red-400 border border-red-500/40"
                : "bg-[#1a1a24] text-gray-400 border border-[#2a2a3a] hover:border-gray-500 hover:text-gray-300"
            }`}
          title={tier.desc}
        >
          <span>{tier.icon}</span>
          <span>{tier.label}</span>
        </button>
      ))}
    </div>
  );
}
