"use client";

import { useState, useCallback, useEffect } from "react";

type ErrorWindow = "1h" | "24h" | "7d";

interface ErrorLogEntry {
  id: string;
  error_type: string;
  message: string;
  stack?: string | null;
  context: Record<string, unknown> | null;
  client_ip: string | null;
  created_at: string;
}

interface ErrorsData {
  window: ErrorWindow;
  total: number;
  byType: Record<string, number>;
  buckets: { label: string; count: number }[];
  errors: ErrorLogEntry[];
}

const ERROR_BADGE: Record<string, string> = {
  client_render: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  api_chat:      "bg-red-500/20 text-red-400 border-red-500/30",
  voyage:        "bg-purple-500/20 text-purple-400 border-purple-500/30",
  claude:        "bg-blue-500/20 text-blue-400 border-blue-500/30",
  unhandled:     "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const ERROR_BAR: Record<string, string> = {
  client_render: "bg-yellow-500",
  api_chat:      "bg-red-500",
  voyage:        "bg-purple-500",
  claude:        "bg-blue-500",
  unhandled:     "bg-orange-500",
};

interface StatsData {
  overview: {
    totalQueries: number;
    queriesToday: number;
    totalUsers: number;
    premiumUsers: number;
    waitlistCount: number;
    totalTokens: number;
    errorsLast24h: number;
  };
  tierBreakdown: { nudge: number; full: number };
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
  recentErrors: {
    id: string;
    error_type: string;
    message: string;
    context: Record<string, unknown> | null;
    client_ip: string | null;
    created_at: string;
  }[];
  queryRates: {
    avgPerMinute: number;
    avgPerHour: number;
    avgPerDay: number;
    lastHourTotal: number;
    last24hTotal: number;
  };
  topIps: { ip: string; count: number; suspicious: boolean }[];
  contentGaps: { id: string; question: string; spoiler_tier: string; created_at: string }[];
  cacheHitRate: number;
  cacheHits: number;
  activeUsers: { email: string; queries_today: number; tier: string }[];
  costStats: {
    allTime: {
      total: number; haiku: number; sonnet: number; voyage: number;
      perQueryNudge: number; perQueryFull: number; perQueryOverall: number;
    };
    last7Days: {
      total: number; haiku: number; sonnet: number; voyage: number;
      avgPerUserPerDay: number; avgPerActiveUserPerDay: number; projectedMonthly: number;
    };
    today: {
      total: number; haiku: number; sonnet: number; voyage: number;
      avgPerActiveUser: number; avgPerFreeUser: number; avgPerPremiumUser: number;
    };
    pricing: {
      haikuInputPerMToken: number; haikuOutputPerMToken: number;
      sonnetInputPerMToken: number; sonnetOutputPerMToken: number;
      voyagePerMToken: number;
    };
  };
}

const TIER_COLORS: Record<string, string> = {
  nudge: "text-yellow-400",
  full: "text-red-400",
  // "guide" kept for historical query rows still in the DB
  guide: "text-blue-400",
};

const TIER_BAR_COLORS: Record<string, string> = {
  nudge: "bg-yellow-500",
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
  const [errorWindow, setErrorWindow] = useState<ErrorWindow>("24h");
  const [errorsData, setErrorsData] = useState<ErrorsData | null>(null);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const fetchErrors = useCallback(async (win: ErrorWindow, sec: string) => {
    setErrorsLoading(true);
    try {
      const res = await fetch(`/api/admin/errors?window=${win}`, {
        headers: { Authorization: `Bearer ${sec}` },
      });
      if (res.ok) setErrorsData(await res.json());
    } finally {
      setErrorsLoading(false);
    }
  }, []);

  // Auto-fetch errors whenever window or secret changes (after login)
  useEffect(() => {
    if (secret) fetchErrors(errorWindow, secret);
  }, [errorWindow, secret, fetchErrors]);

  const handleExport = async (type: "waitlist" | "users" | "content-gaps") => {
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
  const { overview, tierBreakdown, last7Days, recentQueries, knowledgeStats, recentErrors, queryRates, topIps, contentGaps, cacheHitRate, cacheHits, activeUsers, costStats } = data;

  function fmtUSD(n: number): string {
    if (n === 0) return "$0.00";
    if (n < 0.01) return `$${n.toFixed(5)}`;
    if (n < 1)    return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  }
  const totalTier = tierBreakdown.nudge + tierBreakdown.full;
  const knowledgeEntries = Object.entries(knowledgeStats.byType).sort(([, a], [, b]) => b - a);
  const maxKnowledge = Math.max(...knowledgeEntries.map(([, v]) => v), 1);

  return (
    <div className="h-screen overflow-y-auto bg-[#0e0e16] text-gray-200">
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
            onClick={() => handleExport("content-gaps")}
            disabled={exporting === "content-gaps"}
            title="Download unanswered questions as CSV"
            className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/30 hover:border-purple-500/60 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {exporting === "content-gaps" ? "Exporting..." : "↓ Content Gaps CSV"}
          </button>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
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
            <StatCard label="Errors (24h)" value={overview.errorsLast24h ?? 0} />
            <StatCard
              label="Cache Hit Rate"
              value={`${cacheHitRate}%`}
              sub={`${cacheHits.toLocaleString()} hits · 7 days`}
            />
          </div>
        </section>

        {/* Query rate averages */}
        <section>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Query Rate (Rolling)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Avg / Minute" value={queryRates.avgPerMinute} sub="last 60 min" />
            <StatCard label="Avg / Hour" value={queryRates.avgPerHour} sub="last 24 hrs" />
            <StatCard label="Avg / Day" value={queryRates.avgPerDay} sub="last 7 days" />
            <StatCard label="Last Hour" value={queryRates.lastHourTotal} sub="total queries" />
            <StatCard label="Last 24h" value={queryRates.last24hTotal} sub="total queries" />
          </div>
        </section>

        {/* High-volume IPs */}
        <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-300">
              Top IPs — Last 24h
            </h2>
            <span className="text-xs text-gray-600">Free limit: 30/day · flagged in <span className="text-orange-400">orange</span></span>
          </div>
          {topIps.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No queries in the last 24h</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-[#2a2a3a]">
                    <th className="pb-2 pr-4 font-medium">#</th>
                    <th className="pb-2 pr-4 font-medium">IP Address</th>
                    <th className="pb-2 pr-4 font-medium text-right">Queries (24h)</th>
                    <th className="pb-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {topIps.map(({ ip, count, suspicious }, i) => (
                    <tr key={ip} className="border-b border-[#1e1e2e] hover:bg-[#0e0e16]/50 transition-colors">
                      <td className="py-2 pr-4 text-gray-600">{i + 1}</td>
                      <td className={`py-2 pr-4 font-mono ${suspicious ? "text-orange-400" : "text-gray-300"}`}>{ip}</td>
                      <td className={`py-2 pr-4 text-right font-medium ${suspicious ? "text-orange-400" : "text-gray-400"}`}>{count}</td>
                      <td className="py-2 text-right">
                        {suspicious ? (
                          <span className="inline-block px-2 py-0.5 rounded border text-[10px] font-medium bg-orange-500/20 text-orange-400 border-orange-500/30">
                            High Volume
                          </span>
                        ) : (
                          <span className="text-gray-700">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Most Active Users Today */}
        <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-300">
              Most Active Users Today
            </h2>
            <span className="text-xs text-gray-600">by queries sent today</span>
          </div>
          {activeUsers.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No authenticated user queries today</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-[#2a2a3a]">
                    <th className="pb-2 pr-4 font-medium">#</th>
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 pr-4 font-medium text-right">Queries Today</th>
                    <th className="pb-2 font-medium text-right">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {activeUsers.map(({ email, queries_today, tier }, i) => (
                    <tr key={email} className="border-b border-[#1e1e2e] hover:bg-[#0e0e16]/50 transition-colors">
                      <td className="py-2 pr-4 text-gray-600">{i + 1}</td>
                      <td className="py-2 pr-4 text-gray-300 font-mono">{email}</td>
                      <td className="py-2 pr-4 text-right font-medium text-gray-300">{queries_today}</td>
                      <td className="py-2 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-medium ${
                          tier === "premium"
                            ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                        }`}>
                          {tier}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── API Cost Breakdown ── */}
        <section>
          <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            API Cost Breakdown
            <span className="normal-case text-gray-600 ml-2 font-normal">
              · Haiku ${costStats.pricing.haikuInputPerMToken}/${costStats.pricing.haikuOutputPerMToken} per M · Sonnet ${costStats.pricing.sonnetInputPerMToken}/${costStats.pricing.sonnetOutputPerMToken} per M · Voyage ${costStats.pricing.voyagePerMToken} per M
            </span>
          </h2>

          {/* Three time-window cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* All time */}
            <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">All Time</p>
              <p className="text-2xl font-bold text-gray-100 mb-3">{fmtUSD(costStats.allTime.total)}</p>
              <div className="space-y-1.5">
                {[
                  { label: "Sonnet (full)",  value: costStats.allTime.sonnet,  color: "bg-red-500" },
                  { label: "Haiku (nudge)",  value: costStats.allTime.haiku,   color: "bg-yellow-500" },
                  { label: "Voyage",         value: costStats.allTime.voyage,  color: "bg-purple-500" },
                ].map(({ label, value, color }) => {
                  const pct = costStats.allTime.total > 0 ? (value / costStats.allTime.total) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-400">{label}</span>
                        <span className="text-gray-500">{fmtUSD(value)}</span>
                      </div>
                      <div className="h-1.5 bg-[#2a2a3a] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Last 7 days */}
            <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Last 7 Days</p>
              <p className="text-2xl font-bold text-gray-100 mb-3">{fmtUSD(costStats.last7Days.total)}</p>
              <div className="space-y-1.5 mb-3">
                {[
                  { label: "Sonnet (full)",  value: costStats.last7Days.sonnet,  color: "bg-red-500" },
                  { label: "Haiku (nudge)",  value: costStats.last7Days.haiku,   color: "bg-yellow-500" },
                  { label: "Voyage",         value: costStats.last7Days.voyage,  color: "bg-purple-500" },
                ].map(({ label, value, color }) => {
                  const pct = costStats.last7Days.total > 0 ? (value / costStats.last7Days.total) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-400">{label}</span>
                        <span className="text-gray-500">{fmtUSD(value)}</span>
                      </div>
                      <div className="h-1.5 bg-[#2a2a3a] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-[#2a2a3a] pt-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Projected / month</span>
                  <span className="text-gray-300 font-medium">{fmtUSD(costStats.last7Days.projectedMonthly)}</span>
                </div>
              </div>
            </div>

            {/* Today */}
            <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Today</p>
              <p className="text-2xl font-bold text-gray-100 mb-3">{fmtUSD(costStats.today.total)}</p>
              <div className="space-y-1.5 mb-3">
                {[
                  { label: "Sonnet (full)",  value: costStats.today.sonnet,  color: "bg-red-500" },
                  { label: "Haiku (nudge)",  value: costStats.today.haiku,   color: "bg-yellow-500" },
                  { label: "Voyage",         value: costStats.today.voyage,  color: "bg-purple-500" },
                ].map(({ label, value, color }) => {
                  const pct = costStats.today.total > 0 ? (value / costStats.today.total) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-400">{label}</span>
                        <span className="text-gray-500">{fmtUSD(value)}</span>
                      </div>
                      <div className="h-1.5 bg-[#2a2a3a] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-[#2a2a3a] pt-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Avg / active user</span>
                  <span className="text-gray-300 font-medium">{fmtUSD(costStats.today.avgPerActiveUser)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Per-query + per-user averages */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Per-query cost */}
            <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Avg Cost per Query</p>
              <div className="space-y-2">
                {[
                  { label: "Nudge (Haiku)",    value: costStats.allTime.perQueryNudge,   sub: "hint tier" },
                  { label: "Full (Sonnet)",     value: costStats.allTime.perQueryFull,    sub: "solution tier" },
                  { label: "Overall (blended)", value: costStats.allTime.perQueryOverall, sub: "all tiers" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-300">{label}</p>
                      <p className="text-[10px] text-gray-600">{sub}</p>
                    </div>
                    <span className="text-sm font-mono font-medium text-gray-200">{fmtUSD(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-user cost averages */}
            <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Avg Cost per User</p>
              <div className="space-y-2">
                {[
                  { label: "Per user / day (7d avg)",    value: costStats.last7Days.avgPerUserPerDay,        sub: "all registered users" },
                  { label: "Per active user / day (7d)", value: costStats.last7Days.avgPerActiveUserPerDay,  sub: "users who queried today" },
                  { label: "Per free user today",        value: costStats.today.avgPerFreeUser,              sub: "Haiku cost ÷ free users" },
                  { label: "Per premium user today",     value: costStats.today.avgPerPremiumUser,           sub: "Sonnet cost ÷ premium users" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-300">{label}</p>
                      <p className="text-[10px] text-gray-600">{sub}</p>
                    </div>
                    <span className="text-sm font-mono font-medium text-gray-200">{fmtUSD(value)}</span>
                  </div>
                ))}
              </div>
            </div>
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
              {(["full", "nudge"] as const).map((tier) => (
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

        {/* Content Gaps */}
        <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-300">
              Unanswered Questions
              <span className="text-gray-600 font-normal ml-2">({contentGaps.length} total)</span>
            </h2>
            <button
              onClick={() => handleExport("content-gaps")}
              disabled={exporting === "content-gaps"}
              className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/30 hover:border-purple-500/60 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              {exporting === "content-gaps" ? "Exporting..." : "↓ Export CSV"}
            </button>
          </div>
          {contentGaps.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No unanswered questions yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-[#2a2a3a]">
                    <th className="pb-2 pr-4 font-medium">Question</th>
                    <th className="pb-2 pr-4 font-medium w-16">Tier</th>
                    <th className="pb-2 font-medium w-20 text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {contentGaps.map((q) => (
                    <tr key={q.id} className="border-b border-[#1e1e2e] hover:bg-[#0e0e16]/50 transition-colors">
                      <td className="py-2 pr-4 text-gray-300 max-w-xs">
                        <span className="line-clamp-1">{q.question}</span>
                      </td>
                      <td className={`py-2 pr-4 capitalize font-medium ${TIER_COLORS[q.spoiler_tier] ?? "text-gray-400"}`}>
                        {q.spoiler_tier}
                      </td>
                      <td className="py-2 text-gray-600 text-right whitespace-nowrap">
                        {timeAgo(q.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Error Log Dashboard */}
        <div className="bg-[#1a1a24] border border-[#2a2a3a] rounded-xl p-5 space-y-5">
          {/* Header + window selector */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-300">
              Error Log
              {errorsData && (
                <span className="text-gray-600 font-normal ml-2">
                  ({errorsData.total} in window)
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1.5">
              {(["1h", "24h", "7d"] as ErrorWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setErrorWindow(w)}
                  disabled={errorsLoading}
                  className={`text-xs px-3 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                    errorWindow === w
                      ? "bg-red-600/20 border-red-500/50 text-red-400"
                      : "border-[#2a2a3a] text-gray-500 hover:text-gray-300 hover:border-[#3a3a4a]"
                  }`}
                >
                  {w}
                </button>
              ))}
              <button
                onClick={() => fetchErrors(errorWindow, secret)}
                disabled={errorsLoading}
                className="text-xs px-2 py-1 rounded-lg border border-[#2a2a3a] text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-50 ml-1"
                title="Refresh"
              >
                ↺
              </button>
            </div>
          </div>

          {errorsLoading && (
            <p className="text-xs text-gray-600 text-center py-4">Loading...</p>
          )}

          {!errorsLoading && errorsData && (
            <>
              {/* Sparkline buckets */}
              {errorsData.buckets.length > 0 && errorsData.total > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">
                    {errorWindow === "1h" ? "5-min intervals" : errorWindow === "24h" ? "Hourly" : "6-hr intervals"}
                  </p>
                  <div className="flex items-end gap-0.5 h-12">
                    {errorsData.buckets.map((b, i) => {
                      const max = Math.max(...errorsData.buckets.map(x => x.count), 1);
                      const h = Math.max((b.count / max) * 100, b.count > 0 ? 8 : 0);
                      return (
                        <div key={i} className="flex-1 flex items-end" style={{ height: "100%" }}>
                          <div
                            className="w-full rounded-sm bg-red-500/60 transition-all"
                            style={{ height: `${h}%` }}
                            title={`${b.count} error${b.count !== 1 ? "s" : ""} at ${new Date(b.label).toLocaleTimeString()}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Type breakdown */}
              {Object.keys(errorsData.byType).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {Object.entries(errorsData.byType)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => {
                      const badge = ERROR_BADGE[type] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
                      const bar   = ERROR_BAR[type]   ?? "bg-gray-500";
                      const pct   = errorsData.total > 0 ? Math.round((count / errorsData.total) * 100) : 0;
                      return (
                        <div key={type} className="bg-[#0e0e16] border border-[#2a2a3a] rounded-lg p-3">
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium mb-2 ${badge}`}>
                            {type}
                          </span>
                          <p className="text-lg font-bold text-gray-100">{count}</p>
                          <div className="h-1 bg-[#2a2a3a] rounded-full mt-1.5 overflow-hidden">
                            <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Error table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-600 border-b border-[#2a2a3a]">
                      <th className="pb-2 pr-4 font-medium w-28">Type</th>
                      <th className="pb-2 pr-4 font-medium">Message</th>
                      <th className="pb-2 pr-4 font-medium w-36 hidden sm:table-cell">Context</th>
                      <th className="pb-2 pr-4 font-medium w-24 hidden md:table-cell">IP</th>
                      <th className="pb-2 font-medium w-20 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorsData.errors.map((e) => {
                      const badge = ERROR_BADGE[e.error_type] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
                      const isExpanded = expandedError === e.id;
                      return (
                        <>
                          <tr
                            key={e.id}
                            onClick={() => setExpandedError(isExpanded ? null : e.id)}
                            className="border-b border-[#1e1e2e] hover:bg-[#0e0e16]/60 transition-colors cursor-pointer"
                          >
                            <td className="py-2 pr-4">
                              <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-medium ${badge}`}>
                                {e.error_type}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-gray-300 max-w-xs">
                              <span className={isExpanded ? "" : "line-clamp-1"}>{e.message}</span>
                            </td>
                            <td className="py-2 pr-4 text-gray-500 max-w-[144px] hidden sm:table-cell">
                              {e.context ? (
                                <span className="font-mono text-[10px] line-clamp-1">
                                  {JSON.stringify(e.context)}
                                </span>
                              ) : (
                                <span className="text-gray-700">—</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-gray-600 font-mono hidden md:table-cell">
                              {e.client_ip ?? "—"}
                            </td>
                            <td className="py-2 text-gray-600 text-right whitespace-nowrap">
                              {timeAgo(e.created_at)}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${e.id}-expanded`} className="bg-[#0e0e16]/80 border-b border-[#1e1e2e]">
                              <td colSpan={5} className="px-4 py-3 space-y-2">
                                {e.context && (
                                  <div>
                                    <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Context</p>
                                    <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-all bg-[#1a1a24] rounded p-2">
                                      {JSON.stringify(e.context, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {e.stack && (
                                  <div>
                                    <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Stack trace</p>
                                    <pre className="text-[10px] text-gray-600 font-mono whitespace-pre-wrap break-all bg-[#1a1a24] rounded p-2 max-h-48 overflow-y-auto">
                                      {e.stack}
                                    </pre>
                                  </div>
                                )}
                                <p className="text-[10px] text-gray-700">
                                  {new Date(e.created_at).toLocaleString()} · IP: {e.client_ip ?? "unknown"}
                                </p>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {errorsData.errors.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-600">
                          No errors in this window 🎉
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

      </main>
    </div>
  );
}
