import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Minus,
  RefreshCw,
  RadioTower,
  TrendingUp,
} from "lucide-react";
import {
  getActiveOpportunities,
  getWeightedConsensus,
  subscribeToConsensusEvents,
  getLatestXauusdRecommendation,
  getAiAnalyticsData,
} from "../services/signalService";
import XauusdAiAdvisorCard from "../components/XauusdAiAdvisorCard";
import { fetchWithCredentials } from "../services/apiClient";
const fallbackRefreshMs = 30000;

const directionStyles = {
  STRONG_BUY: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
  BUY: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
  NEUTRAL: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-white/10",
  SELL: "bg-rose-500/10 text-rose-500 dark:text-rose-455 border-rose-500/20",
  STRONG_SELL: "bg-rose-500/10 text-rose-500 dark:text-rose-455 border-rose-500/20",
};

function Dashboard() {
  const [opportunities, setOpportunities] = useState([]);
  const [consensusPairs, setConsensusPairs] = useState([]);
  const [aiRecommendation, setAiRecommendation] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [aiAnalytics, setAiAnalytics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  useEffect(() => {
    let isMounted = true;
    let isRequestActive = false;
    let hasPendingRefresh = false;
    let activeController = null;

    async function loadLiveIntelligence() {
      if (isRequestActive) {
        hasPendingRefresh = true;
        return;
      }

      activeController = new AbortController();
      isRequestActive = true;
      hasPendingRefresh = false;

      try {
        const [nextOpportunities, nextConsensusPairs, nextAiData, nextHealthData, nextAnalyticsData] =
          await Promise.all([
            getActiveOpportunities({ signal: activeController.signal }),
            getWeightedConsensus({ signal: activeController.signal }),
            getLatestXauusdRecommendation({ signal: activeController.signal }),
            fetchWithCredentials("/system/health", { signal: activeController.signal })
              .then((res) => {
                if (!res.ok) throw new Error("Failed to load health status");
                return res.json();
              })
              .catch((err) => {
                console.warn("Dashboard system health fetch failed", err);
                return null;
              }),
            getAiAnalyticsData({ signal: activeController.signal })
              .catch((err) => {
                console.warn("Dashboard AI analytics fetch failed", err);
                return null;
              }),
          ]);

        if (!isMounted) return;

        setOpportunities(nextOpportunities);
        setConsensusPairs(nextConsensusPairs);
        setAiRecommendation(nextAiData);
        setSystemHealth(nextHealthData);
        setAiAnalytics(nextAnalyticsData);
        setError("");
        setLastLoadedAt(new Date());
        if (import.meta.env.DEV) {
          console.info("[DASHBOARD REFRESH]", {
            opportunityCount: nextOpportunities.length,
            consensusPairs: nextConsensusPairs.length,
          });
        }
      } catch (loadError) {
        if (!isMounted) return;
        if (loadError.name === "AbortError") return;
        setError(loadError.message);
      } finally {
        isRequestActive = false;
        if (isMounted) {
          setIsLoading(false);
        }
        if (isMounted && hasPendingRefresh) {
          window.setTimeout(loadLiveIntelligence, 150);
        }
      }
    }

    if ("Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }

    loadLiveIntelligence();
    const stopLiveUpdates = subscribeToConsensusEvents(
      () => {
        loadLiveIntelligence();
      },
      () => {
        if (import.meta.env.DEV) {
          console.warn("[REALTIME EVENT] stream reconnecting");
        }
      },
      (newSignal) => {
        if (!("Notification" in window) || Notification.permission !== "granted") {
          return;
        }

        const { pair, action, signalCount, messageKey } = newSignal;
        if (!pair || !action || !messageKey) return;

        let notified;
        try {
          notified = JSON.parse(localStorage.getItem("notified_signals") || "[]");
        } catch {
          notified = [];
        }

        if (!Array.isArray(notified)) {
          notified = [];
        }

        if (notified.includes(messageKey)) {
          return;
        }

        const lockKey = `notif_lock_${messageKey}`;
        const tabId = Math.random().toString(36).substring(2);

        try {
          localStorage.setItem(lockKey, tabId);
        } catch {
          console.log("[NOTIFICATION FIRING]", newSignal);
          new Notification("FX Desk Pro", {
            body: `${pair} ${action}\nSignals: ${signalCount || 1}`,
          });
          return;
        }

        const delay = 20 + Math.floor(Math.random() * 30);
        window.setTimeout(() => {
          try {
            const winner = localStorage.getItem(lockKey);
            if (winner === tabId) {
              console.log("[NOTIFICATION FIRING]", newSignal);
              new Notification("FX Desk Pro", {
                body: `${pair} ${action}\nSignals: ${signalCount || 1}`,
              });

              let currentNotified;
              try {
                currentNotified = JSON.parse(localStorage.getItem("notified_signals") || "[]");
              } catch {
                currentNotified = [];
              }
              if (!Array.isArray(currentNotified)) {
                currentNotified = [];
              }
              if (!currentNotified.includes(messageKey)) {
                currentNotified.push(messageKey);
                if (currentNotified.length > 100) {
                  currentNotified.shift();
                }
                localStorage.setItem("notified_signals", JSON.stringify(currentNotified));
              }

              window.setTimeout(() => {
                try {
                  localStorage.removeItem(lockKey);
                } catch {
                  // ignore
                }
              }, 1000);
            }
          } catch {
            console.log("[NOTIFICATION FIRING]", newSignal);
            new Notification("FX Desk Pro", {
              body: `${pair} ${action}\nSignals: ${signalCount || 1}`,
            });
          }
        }, delay);
      }
    );
    const timer = window.setInterval(loadLiveIntelligence, fallbackRefreshMs);

    return () => {
      isMounted = false;
      stopLiveUpdates();
      activeController?.abort();
      window.clearInterval(timer);
    };
  }, []);



  return (
    <div className="animate-dashboard-in space-y-8 pb-8">
      {/* Page header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <RadioTower size={14} className="text-slate-400" />
            Live Trading Desk
          </p>
          <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white tracking-tight">
            FX Desk Pro
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs font-bold text-rose-500 bg-rose-500/10 rounded-lg px-3 py-1 border border-rose-500/10">
              Error: {error}
            </span>
          )}
          <span className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
            Updated {formatUpdatedAt(lastLoadedAt)}
          </span>
        </div>
      </div>

      {/* TOP SECTION: Large Trading Recommendation Hero Card */}
      <XauusdAiAdvisorCard 
        data={aiRecommendation} 
        loading={isLoading} 
        refreshTrigger={lastLoadedAt ? lastLoadedAt.getTime() : 0} 
        tradingSession={systemHealth?.tradingSession}
      />

      {/* SECOND SECTION: Active Opportunities Table */}
      <section className="rounded-2xl border border-slate-200 bg-white/95 shadow-sm dark:border-white/10 dark:bg-[#0B1220]/90">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-5 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="inline-flex items-center gap-2 text-base font-black text-slate-950 dark:text-white tracking-tight">
              <Activity size={16} className="text-slate-400 dark:text-slate-500" />
              Active Opportunities
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {formatConsensusSummary(consensusPairs)}
            </p>
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
            <RefreshCw size={12} />
            Consensus Feed
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400 dark:border-white/10 dark:text-slate-500 font-bold">
                <th className="px-5 py-3.5 font-bold">Pair</th>
                <th className="px-5 py-3.5 font-bold">Direction</th>
                <th className="px-5 py-3.5 font-bold font-bold">Confidence</th>
                <th className="px-5 py-3.5 font-bold">Weight Split</th>
                <th className="px-5 py-3.5 font-bold">Signals</th>
                <th className="px-5 py-3.5 font-bold">Age</th>
                <th className="px-5 py-3.5 font-bold">BUY Zones</th>
                <th className="px-5 py-3.5 font-bold">SELL Zones</th>
                <th className="px-5 py-3.5 font-bold">Last Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10 font-semibold text-slate-700 dark:text-slate-350">
              {isLoading ? (
                [0, 1, 2, 3].map((row) => <OpportunitySkeleton key={row} />)
              ) : opportunities.length > 0 ? (
                opportunities.map((opportunity) => (
                  <OpportunityRow key={opportunity.pair} opportunity={opportunity} />
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-slate-400 dark:text-slate-550 italic font-bold">
                    No active fresh opportunities right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* THIRD SECTION: Three compact status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 1. Gold Price Card */}
        <div className="h-32 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#0B1220]/90">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Gold Price</p>
            <TrendingUp size={16} className="text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <p className="text-3xl font-black text-slate-955 dark:text-white leading-none">
              {systemHealth?.priceFeeds?.xauusdPrice ? `$${systemHealth.priceFeeds.xauusdPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}
            </p>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1.5">XAUUSD Live Consensus</span>
          </div>
        </div>

        {/* 2. Trading Session Card */}
        <div className="h-32 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#0B1220]/90">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Trading Session</p>
            <Clock3 size={16} className="text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <p className={`text-3xl font-black leading-none ${systemHealth?.tradingSession?.active ? "text-emerald-500" : "text-slate-400 dark:text-slate-500"}`}>
              {systemHealth?.tradingSession?.active ? "Active" : "Inactive"}
            </p>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1.5">
              Overlap: {systemHealth?.tradingSession?.start || "17:30"}–{systemHealth?.tradingSession?.end || "21:30"} IST
            </span>
          </div>
        </div>

        {/* 3. Today's Summary Card */}
        <div className="h-32 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#0B1220]/90">
          <div className="flex justify-between items-start">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Today's Summary</p>
            <Activity size={16} className="text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <div className="flex justify-between items-baseline">
              <p className="text-2xl font-black text-slate-950 dark:text-white leading-none">
                {aiAnalytics?.currentlyOpen ?? 0} <span className="text-xs font-normal text-slate-400">Open</span>
                {" / "}
                {aiAnalytics?.winRate !== null && aiAnalytics?.closedToday !== undefined 
                  ? Math.round((aiAnalytics.winRate / 100) * aiAnalytics.closedToday) 
                  : 0}
                <span className="text-xs font-normal text-slate-400"> W</span>
              </p>
              
              <span className={`text-sm font-black ${
                (aiAnalytics?.simulationEquityCurve && aiAnalytics.simulationEquityCurve.length > 0 
                  ? aiAnalytics.simulationEquityCurve[aiAnalytics.simulationEquityCurve.length - 1] - 10000 
                  : 0) >= 0 
                    ? "text-emerald-500" 
                    : "text-rose-500"
              }`}>
                {aiAnalytics?.simulationEquityCurve && aiAnalytics.simulationEquityCurve.length > 0 
                  ? (aiAnalytics.simulationEquityCurve[aiAnalytics.simulationEquityCurve.length - 1] - 10000 >= 0 ? "+" : "") + (aiAnalytics.simulationEquityCurve[aiAnalytics.simulationEquityCurve.length - 1] - 10000).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                  : "$0"}
              </span>
            </div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mt-1.5">Closed Today: {aiAnalytics?.closedToday ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function OpportunityRow({ opportunity }) {
  return (
    <tr className="align-top text-slate-650 hover:bg-slate-55/30 dark:text-slate-350 dark:hover:bg-white/[0.02] transition-all duration-150">
      <td className="px-5 py-5 font-black text-slate-950 dark:text-white text-sm">
        {opportunity.pair}
      </td>
      <td className="px-5 py-5">
        <DirectionBadge direction={opportunity.marketDirection} />
      </td>
      <td className="px-5 py-5">
        <ConfidenceBadge opportunity={opportunity} />
      </td>
      <td className="px-5 py-5">
        <WeightSplit opportunity={opportunity} />
      </td>
      <td className="px-5 py-5 font-extrabold text-slate-900 dark:text-white text-sm">
        {opportunity.signalCount}
      </td>
      <td className="px-5 py-5">
        <AgeBadge lastUpdated={opportunity.lastUpdated} />
      </td>
      <td className="px-5 py-5">
        <DirectionalZones direction="BUY" zones={opportunity.buyZones} />
      </td>
      <td className="px-5 py-5">
        <DirectionalZones direction="SELL" zones={opportunity.sellZones} />
      </td>
      <td className="px-5 py-5 text-slate-400 dark:text-slate-500 font-bold">
        {formatTime(opportunity.lastUpdated)}
      </td>
    </tr>
  );
}

function DirectionalZones({ direction, zones }) {
  const tone =
    direction === "BUY"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-455";

  return (
    <div className="min-w-[9rem] space-y-1 text-[11px] font-semibold">
      <p className={`font-black uppercase tracking-wider ${tone}`}>{direction}</p>
      <ZoneLine label="Entry" zone={zones?.entryZone} />
      <ZoneLine label="TP" zone={zones?.tpZone} />
      <ZoneLine label="SL" zone={zones?.slZone} />
    </div>
  );
}

function ZoneLine({ label, zone }) {
  return (
    <p className="flex justify-between gap-3 text-slate-500 dark:text-slate-400">
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
      <span className="font-extrabold text-slate-800 dark:text-slate-200">{formatZone(zone)}</span>
    </p>
  );
}

function DirectionBadge({ direction }) {
  const safeDirection = direction || "NEUTRAL";
  const Icon = safeDirection.includes("BUY")
    ? ArrowUpRight
    : safeDirection.includes("SELL")
    ? ArrowDownRight
    : Minus;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[11px] font-extrabold tracking-wide ${
        directionStyles[safeDirection] || directionStyles.NEUTRAL
      }`}
    >
      <Icon size={12} />
      {safeDirection}
    </span>
  );
}

function AgeBadge({ lastUpdated }) {
  const label = getAgeLabel(lastUpdated);
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-50 border border-slate-200/50 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-455">
      <Clock3 size={11} className="text-slate-450" />
      {label}
    </span>
  );
}

function ConfidenceBadge({ opportunity }) {
  const direction = (opportunity.marketDirection || "NEUTRAL").toUpperCase();
  const val = direction.includes("BUY") 
    ? Number(opportunity.buyConfidence) 
    : direction.includes("SELL") 
    ? Number(opportunity.sellConfidence) 
    : Math.max(Number(opportunity.buyConfidence) || 0, Number(opportunity.sellConfidence) || 0);

  const conf = val || 0;
  let colorClass = "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-white/10";
  if (conf >= 75) colorClass = "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20";
  else if (conf >= 50) colorClass = "bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20";
  else if (conf >= 30) colorClass = "bg-yellow-500/10 text-yellow-500 dark:text-yellow-400 border-yellow-500/20";

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-extrabold ${colorClass}`}>
      {conf}%
    </span>
  );
}

function getAgeLabel(value) {
  if (!value) return "--";
  try {
    const diffMs = Date.now() - new Date(value).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
  } catch {
    return "--";
  }
}



function WeightSplit({ opportunity }) {
  const total =
    Number(opportunity.totalWeight) ||
    Number(opportunity.buyWeight) + Number(opportunity.sellWeight) ||
    0;
  const buyPercent = total > 0 ? Math.round((opportunity.buyWeight / total) * 100) : 0;
  const sellPercent = total > 0 ? 100 - buyPercent : 0;

  return (
    <div className="min-w-[10rem]">
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-emerald-600 dark:text-emerald-300">BUY {buyPercent}%</span>
        <span className="text-rose-600 dark:text-rose-300">SELL {sellPercent}%</span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <span className="bg-emerald-500 dark:bg-emerald-400" style={{ width: `${buyPercent}%` }}></span>
        <span className="bg-rose-500 dark:bg-rose-400" style={{ width: `${sellPercent}%` }}></span>
      </div>
    </div>
  );
}

function OpportunitySkeleton() {
  return (
    <tr>
      {[68, 112, 128, 160, 52, 96, 132, 132, 96].map((width, index) => (
        <td key={index} className="px-4 py-4">
          <div
            className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
            style={{ width }}
          ></div>
        </td>
      ))}
    </tr>
  );
}

function formatConsensusSummary(consensusPairs) {
  const pairCount = consensusPairs.length;
  const signalCount = consensusPairs.reduce(
    (sum, pair) => sum + Number(pair.signalCount || 0),
    0
  );

  if (pairCount === 0) {
    return "Active and partial signals only. No fresh weighted consensus is available.";
  }

  return `${pairCount} fresh pair${pairCount === 1 ? "" : "s"}, ${signalCount} active/partial signal${signalCount === 1 ? "" : "s"}. Closed, expired, promo, and noise are excluded.`;
}

function formatZone(zone) {
  if (!zone) {
    return "--";
  }

  if (zone.min === zone.max) {
    return formatNumber(zone.min);
  }

  return `${formatNumber(zone.min)}-${formatNumber(zone.max)}`;
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 5,
  });
}

function formatTime(value) {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUpdatedAt(value) {
  if (!value) {
    return "--";
  }

  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default Dashboard;
