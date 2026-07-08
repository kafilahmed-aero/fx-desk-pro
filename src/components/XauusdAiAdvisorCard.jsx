import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, AlertCircle } from "lucide-react";
import { getLatestXauusdRecommendation } from "../services/signalService";

function XauusdAiAdvisorCard({ data: propData, loading: propLoading, refreshTrigger, tradingSession }) {
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

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatAge = (dateStr) => {
    if (!dateStr) return "--";
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
      return "--";
    }
  };

  // Helper to map confidence score to label
  const getConfidenceDetails = (conf) => {
    const score = Number(conf) || 0;
    if (score < 30) return { label: "Very Low Confidence", color: "text-slate-400" };
    if (score < 50) return { label: "Low Confidence", color: "text-rose-400" };
    if (score < 70) return { label: "Medium Confidence", color: "text-yellow-400" };
    if (score < 85) return { label: "High Confidence", color: "text-blue-400" };
    return { label: "Very High Confidence", color: "text-emerald-400" };
  };

  // Helper to calculate Priority Status
  const getPriorityStatus = (dir, conf, qual) => {
    const cleanDir = (dir || "HOLD").toUpperCase();
    const cleanConf = conf !== undefined ? Number(conf) : 50;
    const cleanQual = (qual || "C").toUpperCase();
    
    if (cleanDir.includes("HOLD") || cleanConf < 40 || cleanQual === "D") {
      return { label: "Stand Aside", color: "text-rose-400 bg-rose-500/10 border-rose-500/20", dot: "🔴" };
    }
    if (cleanQual === "A+" || cleanQual === "A" || cleanConf >= 75) {
      return { label: "High Conviction", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", dot: "🟢" };
    }
    return { label: "Moderate Conviction", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", dot: "🟡" };
  };

  // Helper for Quality Colors
  const getQualityColor = (qual) => {
    const q = (qual || "C").toUpperCase();
    if (q === "A+" || q === "A") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (q === "B") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    if (q === "C") return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    return "bg-rose-500/10 text-rose-400 border-rose-500/20";
  };

  // Render Skeleton Loader
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex animate-pulse flex-col space-y-4">
          <div className="h-6 w-1/3 rounded bg-slate-200 dark:bg-slate-800"></div>
          <div className="grid grid-cols-4 gap-4">
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
            <div className="h-14 rounded bg-slate-200 dark:bg-slate-800"></div>
          </div>
        </div>
      </div>
    );
  }

  // Render Error State
  if (error || (data && data.status === "error")) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-rose-250 bg-rose-500/5 p-6 shadow-sm dark:border-rose-500/20">
        <div className="flex items-center gap-3">
          <AlertCircle className="text-rose-500" size={24} />
          <div className="min-w-0">
            <h3 className="text-base font-bold text-rose-455">XAUUSD AI Advisor</h3>
            <p className="mt-1 text-xs text-rose-400/80">AI recommendation temporarily unavailable</p>
          </div>
        </div>
      </div>
    );
  }

  // Render Offline State
  if (data && data.status === "offline") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/50 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-slate-400 animate-pulse"></div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">XAUUSD AI Advisor Offline</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
      <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/40 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-ping"></div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-blue-900 dark:text-blue-200">XAUUSD AI Advisor</h3>
            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">AI recommendation is being generated...</p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback to error if data is empty or direction is missing
  if (!data || !data.direction) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-rose-250 bg-rose-500/5 p-6 shadow-sm dark:border-rose-500/20">
        <div className="flex items-center gap-3">
          <AlertCircle className="text-rose-500" size={24} />
          <div className="min-w-0">
            <h3 className="text-base font-bold text-rose-455">XAUUSD AI Advisor</h3>
            <p className="mt-1 text-xs text-rose-400/80">AI recommendation temporarily unavailable</p>
          </div>
        </div>
      </div>
    );
  }

  const direction = data.direction.toUpperCase();
  const isBuy = direction.includes("BUY");
  const isSell = direction.includes("SELL");

  const badgeColor = isBuy
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : isSell
    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
    : "bg-slate-500/10 text-slate-400 border-white/10";

  const DirectionIcon = isBuy ? ArrowUpRight : isSell ? ArrowDownRight : Minus;
  const priority = getPriorityStatus(direction, data.confidence, data.tradeQuality);
  const confDetails = getConfidenceDetails(data.confidence);

  // Slice reasoning to max 3 bullets
  const reasoningBullets = Array.isArray(data.reasoning) ? data.reasoning.slice(0, 3) : [];

  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm transition-all duration-200 dark:border-white/10 dark:bg-[#0B1220]/90">
      
      {/* 1. Header Badges & Priority */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-5 dark:border-white/5">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-1 text-sm font-black uppercase tracking-wider ${badgeColor}`}>
              <DirectionIcon size={15} />
              {direction}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-bold ${getQualityColor(data.tradeQuality)}`}>
              Quality {data.tradeQuality || "C"}
            </span>
          </div>
          {/* Top Priority Conviction Badge */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${priority.color}`}>
              <span className="text-[10px]">{priority.dot}</span>
              {priority.label}
            </span>
          </div>
        </div>
        
        {/* Confidence Display */}
        <div className="min-w-[14rem] space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-400 font-bold">Confidence</span>
            <span className="font-extrabold text-slate-900 dark:text-white text-sm">{data.confidence !== undefined ? `${data.confidence}%` : "50%"}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${data.confidence || 50}%` }}
            ></div>
          </div>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${confDetails.color}`}>
            {confDetails.label}
          </p>
        </div>
      </div>

      {/* 2. Large Clean Pricing Layout */}
      <div className="mt-6 grid grid-cols-2 gap-4 border-b border-slate-100 pb-6 dark:border-white/5 sm:grid-cols-5">
        <div className="p-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Entry Zone</p>
          <p className="mt-1.5 text-xl font-extrabold text-slate-900 dark:text-white">
            {data.entryMin && data.entryMax ? `${data.entryMin}–${data.entryMax}` : "—"}
          </p>
        </div>
        <div className="p-1.5 border-l border-slate-100 dark:border-white/5 pl-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Stop Loss</p>
          <p className="mt-1.5 text-xl font-extrabold text-rose-500">
            {data.sl || "—"}
          </p>
        </div>
        <div className="p-1.5 border-l border-slate-100 dark:border-white/5 pl-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">TP1 (Low Risk)</p>
          <p className="mt-1.5 text-xl font-extrabold text-emerald-500">
            {data.lowRiskTp || data.tp || "—"}
          </p>
        </div>
        <div className="p-1.5 border-l border-slate-100 dark:border-white/5 pl-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">TP2 (Mod Risk)</p>
          <p className="mt-1.5 text-xl font-extrabold text-emerald-500">
            {data.moderateTp || "—"}
          </p>
        </div>
        <div className="p-1.5 border-l border-slate-100 dark:border-white/5 pl-4 col-span-2 sm:col-span-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">TP3 (High Risk)</p>
          <p className="mt-1.5 text-xl font-extrabold text-emerald-500">
            {data.highRiskTp || "—"}
          </p>
        </div>
      </div>

      {/* 3. Reason Summary (max 3 bullets, under one line each) */}
      {reasoningBullets.length > 0 && (
        <div className="mt-6 border-b border-slate-100 pb-5 dark:border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Decision Parameters</p>
          <ul className="mt-2.5 space-y-2">
            {reasoningBullets.map((reason, index) => (
              <li key={index} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-350">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0"></span>
                <span className="font-semibold truncate max-w-full" title={reason}>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. Risk Summary Chips */}
      <div className="mt-5 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Risk Matrix Indicators</p>
        <div className="flex flex-wrap gap-2">
          {data.marketRegime && (
            <span className="inline-flex items-center rounded bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-650 dark:bg-white/[0.02] dark:text-slate-400 border border-slate-200/50 dark:border-white/5">
              Regime: {data.marketRegime}
            </span>
          )}
          {data.macroAlignment && (
            <span className="inline-flex items-center rounded bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-655 dark:bg-white/[0.02] dark:text-slate-400 border border-slate-200/50 dark:border-white/5">
              Macro: {data.macroAlignment}
            </span>
          )}
          {data.telegramQuality && (
            <span className="inline-flex items-center rounded bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-655 dark:bg-white/[0.02] dark:text-slate-400 border border-slate-200/50 dark:border-white/5">
              Ingestion: {data.telegramQuality}
            </span>
          )}
          {data.institutionalBias && (
            <span className="inline-flex items-center rounded bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-655 dark:bg-white/[0.02] dark:text-slate-400 border border-slate-200/50 dark:border-white/5">
              Institutions: {data.institutionalBias}
            </span>
          )}
          {data.riskLevel && (
            <span className="inline-flex items-center rounded bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-655 dark:bg-white/[0.02] dark:text-slate-400 border border-slate-200/50 dark:border-white/5">
              Risk: {data.riskLevel}
            </span>
          )}
        </div>
      </div>

      {/* 5. Minimalist Metadata Footer */}
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-[10px] font-bold text-slate-400 dark:border-white/5 dark:text-slate-500 sm:grid-cols-4">
        <div>
          <span className="uppercase tracking-wider">Generated:</span>{" "}
          <span className="text-slate-600 dark:text-slate-400">{formatLastUpdated(data.lastGenerationTime)}</span>
        </div>
        <div>
          <span className="uppercase tracking-wider">Advisor Age:</span>{" "}
          <span className="text-slate-600 dark:text-slate-400">{formatAge(data.lastGenerationTime)}</span>
        </div>
        <div>
          <span className="uppercase tracking-wider">Trading Session:</span>{" "}
          <span className={`font-bold ${tradingSession?.active ? "text-emerald-500" : "text-slate-600 dark:text-slate-400"}`}>
            {tradingSession?.active ? "Active" : "Inactive"}
          </span>
        </div>
        <div>
          <span className="uppercase tracking-wider">Engine:</span>{" "}
          <span className="text-slate-600 dark:text-slate-400">Gemini-2.5-Advisor (v{data.schemaVersion || "1"})</span>
        </div>
      </div>
    </div>
  );
}

export default XauusdAiAdvisorCard;
