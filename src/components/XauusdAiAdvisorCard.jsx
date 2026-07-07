import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { getLatestXauusdRecommendation } from "../services/signalService";

function XauusdAiAdvisorCard({ data: propData, loading: propLoading, refreshTrigger }) {
  const [localData, setLocalData] = useState(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [error, setError] = useState(false);

  const data = propData !== undefined ? propData : localData;
  const loading = propLoading !== undefined ? propLoading : localLoading;

  useEffect(() => {
    if (propData !== undefined) {
      return;
    }

    let isMounted = true;
    
    async function fetchRecommendation() {
      setLocalLoading(true);
      setError(false);
      try {
        const response = await getLatestXauusdRecommendation();
        if (isMounted) {
          setLocalData(response);
        }
      } catch (err) {
        console.error("Failed to load AI recommendation", err);
        if (isMounted) {
          setError(true);
        }
      } finally {
        if (isMounted) {
          setLocalLoading(false);
        }
      }
    }

    fetchRecommendation();

    return () => {
      isMounted = false;
    };
  }, [refreshTrigger, propData]);

  const formatLastUpdated = (dateStr) => {
    if (!dateStr) return "N/A";
    try {
      const date = new Date(dateStr);
      const pad = (n) => String(n).padStart(2, "0");
      const yyyy = date.getFullYear();
      const mm = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());
      const hh = pad(date.getHours());
      const min = pad(date.getMinutes());
      
      const tzString = date.toLocaleDateString("en-US", { timeZoneName: "short" }).split(", ")[1] || "IST";
      
      return `${yyyy}-${mm}-${dd} ${hh}:${min} ${tzString}`;
    } catch {
      return "N/A";
    }
  };

  const formatAge = (dateStr) => {
    if (!dateStr) return "--";
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHrs = Math.floor(diffMin / 60);

      if (diffSec < 60) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHrs < 24) return `${diffHrs}h ${diffMin % 60}m ago`;
      return `${Math.floor(diffHrs / 24)}d ago`;
    } catch {
      return "--";
    }
  };

  // Render Skeleton Loader
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-400 to-sky-400"></div>
        <div className="flex animate-pulse flex-col space-y-4">
          <div className="h-6 w-1/3 rounded bg-slate-200 dark:bg-slate-800"></div>
          <div className="grid grid-cols-4 gap-4">
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
          </div>
          <div className="space-y-2">
            <div className="h-4 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-4 rounded bg-slate-200 dark:bg-slate-800"></div>
          </div>
        </div>
      </div>
    );
  }

  // Render Error State
  if (error || (data && data.status === "error")) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/70 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-rose-500/20 dark:bg-rose-500/5 dark:shadow-black/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-rose-500"></div>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-rose-800 dark:text-rose-400">🤖 XAUUSD AI Advisor</h3>
            <p className="mt-1 text-sm text-rose-700 dark:text-rose-300/80">AI recommendation temporarily unavailable</p>
          </div>
        </div>
      </div>
    );
  }

  // Render Offline State
  if (data && data.status === "offline") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-black/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-slate-400"></div>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚪</span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">🤖 XAUUSD AI Advisor Offline</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Waiting for London–New York overlap (17:30–21:30 IST)
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render Pending State
  if (data && data.status === "pending") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/60 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-black/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-blue-500"></div>
        <div className="flex items-center gap-3">
          <span className="animate-spin text-xl text-blue-500">⌛</span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-blue-900 dark:text-blue-200">🤖 XAUUSD AI Advisor</h3>
            <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">AI recommendation is being generated...</p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback to error if data is empty or direction is missing
  if (!data || !data.direction) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/70 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-rose-500/20 dark:bg-rose-500/5 dark:shadow-black/10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-rose-500"></div>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-rose-800 dark:text-rose-400">🤖 XAUUSD AI Advisor</h3>
            <p className="mt-1 text-sm text-rose-700 dark:text-rose-300/80">AI recommendation temporarily unavailable</p>
          </div>
        </div>
      </div>
    );
  }

  const direction = data.direction.toUpperCase();
  const isBuy = direction.includes("BUY");
  const isSell = direction.includes("SELL");

  const badgeColor = isBuy
    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
    : isSell
    ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
    : "border-slate-300 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400";

  const DirectionIcon = isBuy ? ArrowUpRight : isSell ? ArrowDownRight : Minus;

  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-xl shadow-slate-200/70 backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#0B1220]/80 dark:shadow-black/10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-400 to-sky-400"></div>

      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
          <span>🤖</span> XAUUSD AI Advisor
        </h3>
      </div>

      {/* 8-parameter layout grid */}
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {/* Direction */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Direction</p>
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 text-xs font-black uppercase ${badgeColor}`}>
              <DirectionIcon size={12} />
              {direction}
            </span>
          </div>
        </div>

        {/* Entry Range */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Entry Range</p>
          <p className="mt-2 text-sm font-extrabold text-slate-900 dark:text-white">
            {data.entryMin && data.entryMax ? `${data.entryMin}–${data.entryMax}` : "—"}
          </p>
        </div>

        {/* Stop Loss */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Stop Loss</p>
          <p className="mt-2 text-sm font-extrabold text-rose-600 dark:text-rose-400">
            {data.sl || "—"}
          </p>
        </div>

        {/* Low Risk TP */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Low Risk</p>
          <p className="mt-2 text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
            {data.lowRiskTp || data.tp || "—"}
          </p>
        </div>

        {/* Moderate TP */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Moderate</p>
          <p className="mt-2 text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
            {data.moderateTp || "—"}
          </p>
        </div>

        {/* High Risk TP */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">High Risk</p>
          <p className="mt-2 text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
            {data.highRiskTp || "—"}
          </p>
        </div>

        {/* Confidence */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Confidence</p>
          <p className="mt-2 text-sm font-extrabold text-blue-600 dark:text-blue-400">
            {data.confidence !== undefined && data.confidence !== null ? `${data.confidence}%` : "—"}
          </p>
        </div>

        {/* Trade Quality */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Quality</p>
          <p className="mt-2 text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
            {data.tradeQuality || "—"}
          </p>
        </div>
      </div>

      {/* Additional Trade Guidance */}
      {(data.tradeStyle || data.estimatedHoldingTime || data.riskReward) && (
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-200/40 pt-4 text-xs font-semibold text-slate-500 dark:border-white/5 dark:text-slate-400">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Trade Style</p>
            <p className="mt-1 text-sm font-extrabold text-slate-800 dark:text-slate-200">{data.tradeStyle || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Holding Time</p>
            <p className="mt-1 text-sm font-extrabold text-slate-800 dark:text-slate-200">{data.estimatedHoldingTime || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Risk Reward Ratio (L/M/H)</p>
            <p className="mt-1 text-sm font-extrabold text-slate-800 dark:text-slate-200">
              {data.riskReward && (data.riskReward.lowRisk !== null || data.riskReward.moderate !== null || data.riskReward.high !== null)
                ? `1:${data.riskReward.lowRisk !== null ? data.riskReward.lowRisk.toFixed(2) : "—"} / 1:${data.riskReward.moderate !== null ? data.riskReward.moderate.toFixed(2) : "—"} / 1:${data.riskReward.high !== null ? data.riskReward.high.toFixed(2) : "—"}`
                : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Reasoning Bullets */}
      {data.reasoning && Array.isArray(data.reasoning) && data.reasoning.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Reasoning</p>
          <ul className="mt-2.5 space-y-2">
            {data.reasoning.map((reason, index) => (
              <li key={index} className="flex items-start gap-2.5 text-sm text-slate-650 dark:text-slate-350">
                <span className="mt-1 text-xs text-blue-500 dark:text-sky-400">•</span>
                <span className="font-semibold">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Advisor Metadata footer */}
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-200/60 pt-4 text-xs font-semibold text-slate-500 dark:border-white/5 dark:text-slate-400 sm:grid-cols-5">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Generated At</p>
          <p className="mt-1 text-slate-800 dark:text-slate-200">{formatLastUpdated(data.lastGenerationTime)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Advisor Age</p>
          <p className="mt-1 text-slate-800 dark:text-slate-200">{formatAge(data.lastGenerationTime)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Signals Used</p>
          <p className="mt-1 text-slate-800 dark:text-slate-200">{data.signalsUsed || 0} active</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Newest Signal Age</p>
          <p className="mt-1 text-slate-800 dark:text-slate-200">{formatAge(data.newestSignalTime)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Oldest Signal Age</p>
          <p className="mt-1 text-slate-800 dark:text-slate-200">{formatAge(data.oldestSignalTime)}</p>
        </div>
      </div>
    </div>
  );
}

export default XauusdAiAdvisorCard;
