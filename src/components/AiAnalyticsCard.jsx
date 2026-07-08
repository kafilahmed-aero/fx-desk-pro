import { useEffect, useState } from "react";
import { BarChart3, TrendingUp, ShieldAlert, Clock, Sparkles } from "lucide-react";

function AiAnalyticsCard({ data, loading }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatAge = (dateStr) => {
    if (!dateStr) return "—";
    if (!now) return "Calculating...";
    try {
      const diffMs = now - new Date(dateStr).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHrs = Math.floor(diffMin / 60);

      if (diffSec < 60) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHrs < 24) return `${diffHrs}h ${diffMin % 60}m ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch {
      return "—";
    }
  };

  const renderMetric = (val, suffix = "", prefix = "") => {
    if (val === null || val === undefined) {
      return (
        <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 italic block mt-1">
          Collecting data...
        </span>
      );
    }
    return (
      <p className="mt-1 text-base font-black text-slate-900 dark:text-white">
        {prefix}{val}{suffix}
      </p>
    );
  };

  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]">
        <div className="flex animate-pulse flex-col space-y-4">
          <div className="h-6 w-1/4 rounded bg-slate-200 dark:bg-slate-800"></div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="h-16 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-16 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-16 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-16 rounded bg-slate-200 dark:bg-slate-800"></div>
          </div>
        </div>
      </div>
    );
  }

  const d = data || {};

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#0B1220]/80 dark:shadow-black/10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>

      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
          <BarChart3 className="text-purple-500" size={20} />
          <span>🤖 AI Recommendation Analytics</span>
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-bold text-slate-650 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400">
            Last Recommendation: <span className="font-extrabold text-slate-900 dark:text-white">{formatAge(d.lastRecommendationTime)}</span>
          </span>
          <span className="rounded-lg border border-rose-200/40 bg-rose-50/30 px-2.5 py-1 font-bold text-rose-600 dark:border-rose-500/10 dark:bg-rose-500/5 dark:text-rose-455">
            Automation Ready: <span className="font-black">{d.automationReady || "NO"}</span>
          </span>
        </div>
      </div>

      {/* Grid Layout of Metrics */}
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {/* Total Recommendations */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Total Recommendations</p>
          {renderMetric(d.totalRecommendations)}
        </div>

        {/* Win Rate */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Win Rate</p>
          {renderMetric(d.winRate, "%")}
        </div>

        {/* Avg Risk Reward */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Avg Risk:Reward</p>
          {renderMetric(d.averageRiskReward, "", "1:")}
        </div>

        {/* Open Trades */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Currently Open</p>
          {renderMetric(d.currentlyOpen)}
        </div>

        {/* Recs Today */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Recs Today</p>
          {renderMetric(d.recsToday)}
        </div>

        {/* Closed Today */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Closed Today</p>
          {renderMetric(d.closedToday)}
        </div>
      </div>

      {/* Outcome splits & detailed performance parameters */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Resolution splits */}
        <div className="rounded-xl border border-slate-200 p-4 dark:border-white/5 bg-slate-50/[0.15]">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200/50 pb-2 dark:border-white/5 dark:text-slate-400 mb-3 flex items-center gap-1.5">
            <TrendingUp size={14} className="text-emerald-500" />
            Outcome Splits
          </h4>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Full TP</p>
              <p className="mt-1 text-sm font-black text-emerald-600 dark:text-emerald-400">{d.fullTp ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Partial TP</p>
              <p className="mt-1 text-sm font-black text-teal-600 dark:text-teal-400">{d.partialTp ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Break-even</p>
              <p className="mt-1 text-sm font-black text-slate-600 dark:text-slate-400">{d.breakEven ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-semibold">Stop Loss</p>
              <p className="mt-1 text-sm font-black text-rose-600 dark:text-rose-400">{d.sl ?? 0}</p>
            </div>
          </div>
        </div>

        {/* Streaks and durations */}
        <div className="rounded-xl border border-slate-200 p-4 dark:border-white/5 bg-slate-50/[0.15]">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200/50 pb-2 dark:border-white/5 dark:text-slate-400 mb-3 flex items-center gap-1.5">
            <ShieldAlert size={14} className="text-rose-500" />
            Streaks & Drawdown
          </h4>
          <div className="space-y-2 text-xs font-bold text-slate-650 dark:text-slate-350">
            <div className="flex justify-between">
              <span className="text-slate-400">Winning Streak:</span>
              <span className="font-extrabold text-slate-900 dark:text-white">{d.winningStreak ?? 0} consecutive</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Losing Streak:</span>
              <span className="font-extrabold text-slate-900 dark:text-white">{d.losingStreak ?? 0} consecutive</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Maximum Drawdown:</span>
              <span className="font-extrabold text-rose-600 dark:text-rose-400">
                {d.maxDrawdown !== null && d.maxDrawdown !== undefined ? `${d.maxDrawdown} R` : "Collecting data..."}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Avg Confidence:</span>
              <span className="font-extrabold text-blue-600 dark:text-blue-400">
                {d.averageConfidence !== null && d.averageConfidence !== undefined ? `${d.averageConfidence}%` : "Collecting data..."}
              </span>
            </div>
          </div>
        </div>

        {/* Targets & Holding Durations */}
        <div className="rounded-xl border border-slate-200 p-4 dark:border-white/5 bg-slate-50/[0.15]">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200/50 pb-2 dark:border-white/5 dark:text-slate-400 mb-3 flex items-center gap-1.5">
            <Clock size={14} className="text-purple-500" />
            Holding & Target Times
          </h4>
          <div className="space-y-2 text-xs font-bold text-slate-650 dark:text-slate-350">
            <div className="flex justify-between">
              <span className="text-slate-400">Avg Holding Time:</span>
              <span className="font-extrabold text-slate-900 dark:text-white">
                {d.averageHoldingTime !== null && d.averageHoldingTime !== undefined ? d.averageHoldingTime : "Collecting data..."}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Avg Time to TP1:</span>
              <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                {d.avgTimeToTP1 !== null && d.avgTimeToTP1 !== undefined ? `${d.avgTimeToTP1} min` : "Collecting data..."}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Avg Time to Full TP:</span>
              <span className="font-extrabold text-teal-600 dark:text-teal-400">
                {d.avgTimeToFullTP !== null && d.avgTimeToFullTP !== undefined ? `${d.avgTimeToFullTP} min` : "Collecting data..."}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Avg Time to SL:</span>
              <span className="font-extrabold text-rose-600 dark:text-rose-400">
                {d.avgTimeToSL !== null && d.avgTimeToSL !== undefined ? `${d.avgTimeToSL} min` : "Collecting data..."}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trade Quality distributions */}
      <div className="mt-5 border-t border-slate-200/60 pt-4 dark:border-white/5">
        <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-1.5 dark:text-slate-400">
          <Sparkles size={14} className="text-indigo-500" />
          Trade Quality Distribution
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["Excellent", "Good", "Average", "Poor"].map((quality) => {
            const stats = d.tradeQualityDistribution?.[quality] || { count: 0, percentage: null };
            const percentVal = stats.percentage !== null && stats.percentage !== undefined ? stats.percentage : 0;
            return (
              <div key={quality} className="rounded-xl border border-slate-200/70 p-3.5 dark:border-white/5 bg-slate-50/30">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-extrabold text-slate-800 dark:text-slate-200">{quality}</span>
                  <span className="font-bold text-slate-500 dark:text-slate-400">
                    {stats.percentage !== null ? `${stats.count} (${stats.percentage}%)` : `${stats.count} (Collecting data...)`}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      quality === "Excellent"
                        ? "bg-indigo-500"
                        : quality === "Good"
                        ? "bg-emerald-500"
                        : quality === "Average"
                        ? "bg-amber-500"
                        : "bg-rose-500"
                    }`}
                    style={{ width: `${percentVal}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AiAnalyticsCard;
