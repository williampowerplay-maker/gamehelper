"use client";

import { useRouter } from "next/navigation";
import { type SpoilerTier } from "@/lib/supabase";

const tiers: { id: SpoilerTier; label: string; desc: string; icon: string; premiumOnly: boolean }[] = [
  {
    id: "nudge",
    label: "Nudge",
    desc: "A gentle hint — preserves discovery",
    icon: "\u{1F441}",
    premiumOnly: false,
  },
  {
    id: "full",
    label: "Solution",
    desc: "Complete answer — requires sign-in",
    icon: "\u{1F4A1}",
    premiumOnly: true,
  },
];

export default function SpoilerTierSelector({
  selected,
  onChange,
  isPremium = false,
  isSignedIn = false,
  onSignInRequest,
}: {
  selected: SpoilerTier;
  onChange: (tier: SpoilerTier) => void;
  isPremium?: boolean;
  isSignedIn?: boolean;
  onSignInRequest?: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex gap-2">
      {tiers.map((tier) => {
        const locked = tier.premiumOnly && !isPremium;
        const isSelected = selected === tier.id;

        return (
          <button
            key={tier.id}
            onClick={() => {
              if (locked) {
                if (!isSignedIn && onSignInRequest) {
                  onSignInRequest();
                } else {
                  router.push("/upgrade");
                }
              } else {
                onChange(tier.id);
              }
            }}
            title={locked
              ? isSignedIn
                ? "Premium only — click to upgrade"
                : "Sign in to access Solution mode"
              : tier.desc}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${locked
                ? "bg-[#1a1a24] text-gray-600 border border-[#2a2a3a] hover:border-amber-500/40 hover:text-amber-500/70 cursor-pointer"
                : isSelected
                  ? "bg-red-600/20 text-red-400 border border-red-500/40"
                  : "bg-[#1a1a24] text-gray-400 border border-[#2a2a3a] hover:border-gray-500 hover:text-gray-300"
              }`}
          >
            <span>{tier.icon}</span>
            <span>{tier.label}</span>
            {locked && <span className="text-[10px] text-amber-500/60">★</span>}
          </button>
        );
      })}
    </div>
  );
}
