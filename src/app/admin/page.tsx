"use client";

import { useState, useCallback } from "react";

interface StatsData {
  overview: {
    totalQueries: number;
    queriesToday: number;
    totalUsers: number;
    premiumUsers: number;
    waitlistCount: number;
    totalTokens: number;
  };
  tierBreakdown: { nudge: number; guide: number; full: number };
  last7Days: { date: string; count: number }[];
  recentQueries: {
    id: string;
    question: string;
    spoiler_tier: string;
    tokens_used: number;
    created_at: string;
  }[];
  knowledgeStats: {
    total: number;
    byType: Record<string, number>;
  };
}

const TIER_COLORS: Record<string, string> = {
  nudge: "text-yellow-400",
  guide: "text-blue-400",
  full: "text-red-400",
};

const TIER_BAR_COLORS: Record<string, string> = {
  nudge: "bg-yellow-500",
  guide: "bg-blue-500",
  full: "bg-red-500",
};

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-100">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1.5 h-28">
      {data.map(({ date, count }) => {
        const heightPct = Math.max((count / max) * 100, count > 0 ? 4 : 0);
        const label = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <div key={date} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs text-gray-500">{count > 0 ? count : ""}</span>
            <div className="w-full flex items-end" style={{ height: "80px" }}>
              <div
                className="w-full bg-red-500/70 rounded-t transition-all"
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-600 whitespace-nowrap">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function HorizontalBar({
  label,
  value,
  total,
  colorClass,
}: {
  label: string;
  value: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400 capitalize">{label}</span>
        <span className="text-gray-500">
          {value.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-2 bg-[#2a2a3a] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<StatsData | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (type: "waitlist" | "users") => {
    setExporting(type);
    try {
      const res = await fetch(`/api/admin/export?type=${type}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) { setExporting(null); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  };

  const fetchStats = useCallback(
    async (secretToUse: string) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/stats", {
          headers: { Authorization: `Bearer ${secretToUse}` },
        });
        if (res.status === 401) {
          setError("Invalid secret.");
          setLoading(false);
          return;
        }
        const json = await res.json();
        setData(json);
        setSecret(secretToUse);
      } catch {
        setError("Failed to fetch stats. Check the console.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) fetchStats(input.trim());
  };

  // -- Login gate --
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0e0e16]">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-center mb-6">
            <span className="text-red-500">Crimson</span>{" "}
            <span className="text-gray-100">Desert Guide</span>
            <span className="block text-sm font-normal text-gray-500 mt-1">
              Admin Dashboard
            </span>
          </h1>
          <form
            onSubmit={handleSubmit}
            className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-6 flex flex-col gap-4"
          >
            <label className="text-sm text-gray-400">Admin Secret</label>
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter ADMIN_SECRET"
              className="bg-[#0e0e16] border border-[#2a2a3a] rounded-lg px-3 py-2 text-gray-200 text-sm outline-none focus:border-red-500/50 transition-colors"
              autoFocus
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors"
            >
              {loading ? "Loading..." : "View Dashboard"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -- Dashboard --
  const { overview, tierBreakdown, last7Days, recentQueries, knowledgeStats } = data;
  const totalTier = tierBreakdown.nudge + tierBreakdown.guide + tierBreakdown.full;
  const knowledgeEntries = Object.entries(knowledgeStats.byType).sort(([, a], [, b]) => b - a);
  const maxKnowledge = Math.max(...knowledgeEntries.map(([, v]) => v), 1);

  return (
    <div className="min-h-screen bg-[#0e0e16] text-gray-200">
      {/* Header */}
      <header className="border-b border-[#2a2a3a] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">
            <span className="text-red-500">Crimson</span>{" "}
            <span className="text-gray-100">Desert Guide</span>
            <span className="text-gray-500 font-normal ml-2 text-sm">/ Admin</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleExport("waitlist")}
            disabled={exporting === "waitlist"}
            title="Download waitlist emails as CSV"
            className="text-xs text-green-400 hover:text-green-300 border border-green-500/30 hover:border-green-500/60 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {exporting === "waitlist" ? "Exporting..." : "↓ Waitlist CSV"}
          </button>
          <button
            onClick={() => handleExport("users")}
            disabled={exporting === "users"}
            title="Download all users as CSV"
            className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-500/60 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {exporting === "users" ? "Exporting..." : "↓ Users CSV"}
          </button>
          <button
            onClick={() => fetchStats(secret)}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-gray-200 border border-[#2a2a3a] hover:border-[#3a3a4a] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={() => { setData(null); setSecret(""); setInput(""); }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Overview cards */}
        <section>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Overview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total Queries" value={overview.totalQueries} />
            <StatCard label="Today" value={overview.queriesToday} />
            <StatCard label="Total Users" value={overview.totalUsers} />
            <StatCard
              label="Premium"
              value={overview.premiumUsers}
              sub={`${overview.totalUsers > 0 ? Math.round((overview.premiumUsers / overview.totalUsers) * 100) : 0}% of users`}
            />
            <StatCard label="Waitlist" value={overview.waitlistCount} />
            <StatCard
              label="Total Tokens"
              value={
                overview.totalTokens > 1000000
                  ? `${(overview.totalTokens / 1000000).toFixed(1)}M`
                  : overview.totalTokens > 1000
                  ? `${(overview.totalTokens / 1000).toFixed(1)}K`
                  : overview.totalTokens
              }
            />
          </div>
        </section>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* 7-day chart */}
          <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-300 mb-4">Queries — Last 7 Days</h2>
            <BarChart data={last7Days} />
          </div>

          {/* Tier breakdown */}
          <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-300 mb-4">Spoiler Tier Usage</h2>
            <div className="space-y-3">
              {(["guide", "full", "nudge"] as const).map((tier) => (
                <HorizontalBar
                  key={tier}
                  label={tier}
                  value={tierBreakdown[tier]}
                  total={totalTier}
                  colorClass={TIER_BAR_COLORS[tier]}
                />
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-4">{totalTier.toLocaleString()} total queries</p>
          </div>
        </div>

        {/* Knowledge base breakdown */}
        <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-300">Knowledge Base</h2>
            <span className="text-xs text-gray-500">{knowledgeStats.total.toLocaleString()} chunks</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2">
            {knowledgeEntries.map(([type, count]) => {
              const pct = Math.round((count / maxKnowledge) * 100);
              return (
                <div key={type} className="mb-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400 capitalize">{type}</span>
                    <span className="text-gray-500">{count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 bg-[#2a2a3a] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500/60 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent queries */}
        <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
          <h2 className="text-sm font-medium text-gray-300 mb-4">
            Recent Queries
            <span className="text-gray-600 font-normal ml-2">(last 50)</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-600 border-b border-[#2a2a3a]">
                  <th className="pb-2 pr-4 font-medium">Question</th>
                  <th className="pb-2 pr-4 font-medium w-16">Tier</th>
                  <th className="pb-2 pr-4 font-medium w-16 text-right">Tokens</th>
                  <th className="pb-2 font-medium w-20 text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {recentQueries.map((q) => (
                  <tr
                    key={q.id}
                    className="border-b border-[#1e1e2e] hover:bg-[#0e0e16]/50 transition-colors"
                  >
                    <td className="py-2 pr-4 text-gray-300 max-w-xs">
                      <span className="line-clamp-1">{q.question}</span>
                    </td>
                    <td className={`py-2 pr-4 capitalize font-medium ${TIER_COLORS[q.spoiler_tier] ?? "text-gray-400"}`}>
                      {q.spoiler_tier}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 text-right">
                      {q.tokens_used?.toLocaleString() ?? "—"}
                    </td>
                    <td className="py-2 text-gray-600 text-right whitespace-nowrap">
                      {timeAgo(q.created_at)}
                    </td>
                  </tr>
                ))}
                {recentQueries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-600">
                      No queries yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}
