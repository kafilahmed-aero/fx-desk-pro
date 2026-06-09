import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Minus,
  RefreshCw,
  RadioTower,
} from "lucide-react";
import {
  getActiveOpportunities,
  getLiveMarketOverview,
  getWeightedConsensus,
  subscribeToConsensusEvents,
} from "../services/signalService";
const fallbackRefreshMs = 30000;

const directionStyles = {
  STRONG_BUY:
    "border-emerald-300/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300",
  BUY: "border-emerald-300/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  NEUTRAL:
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
  SELL: "border-rose-300/40 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300",
  STRONG_SELL:
    "border-rose-300/40 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
};

const freshnessStyles = {
  VERY_FRESH:
    "border-emerald-300/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  FRESH:
    "border-sky-300/50 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300",
  AGING:
    "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
  WEAK: "border-orange-300/60 bg-orange-50 text-orange-800 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-300",
  STALE:
    "border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400",
};

function Dashboard() {
  const [opportunities, setOpportunities] = useState([]);
  const [consensusPairs, setConsensusPairs] = useState([]);
  const [marketOverview, setMarketOverview] = useState(null);
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
        const [nextOverview, nextOpportunities, nextConsensusPairs] =
          await Promise.all([
            getLiveMarketOverview({ signal: activeController.signal }),
            getActiveOpportunities({ signal: activeController.signal }),
            getWeightedConsensus({ signal: activeController.signal }),
          ]);

        if (!isMounted) return;

        setOpportunities(nextOpportunities);
        setConsensusPairs(nextConsensusPairs);
        setMarketOverview(nextOverview);
        setError("");
        setLastLoadedAt(new Date());
        if (import.meta.env.DEV) {
          console.info("[DASHBOARD REFRESH]", {
            opportunityCount: nextOpportunities.length,
            consensusPairs: nextConsensusPairs.length,
            marketBias: nextOverview?.marketBias || "NEUTRAL",
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

        const { pair, action, messageKey } = newSignal;
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
            body: `${pair} ${action}`,
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
                body: `${pair} ${action}`,
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
              body: `${pair} ${action}`,
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

  const summary = useMemo(
    () => buildSummary(opportunities, marketOverview),
    [opportunities, marketOverview]
  );

  return (
    <div className="animate-dashboard-in space-y-4 pb-8">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#0B1220] dark:shadow-black/10 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <RadioTower size={16} />
              Live market engine
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
              Active Opportunities
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {summary.text}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:min-w-[30rem]">
            <SummaryStat label="Market" value={isLoading ? "--" : summary.marketBias} />
            <SummaryStat label="Pairs" value={isLoading ? "--" : summary.pairCount} />
            <SummaryStat label="Signals" value={isLoading ? "--" : summary.signalCount} />
            <SummaryStat label="Updated" value={formatUpdatedAt(lastLoadedAt)} />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
            {error}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#0B1220]/90 dark:shadow-black/10">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
              <Activity size={18} className="text-blue-500 dark:text-sky-300" />
              Weighted Consensus
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {formatConsensusSummary(consensusPairs)}
            </p>
          </div>
          <p className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <RefreshCw size={15} />
            Realtime push with {fallbackRefreshMs / 1000}s fallback
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-widest text-slate-500 dark:border-white/10 dark:text-slate-500">
                <th className="px-4 py-3 font-semibold">Pair</th>
                <th className="px-4 py-3 font-semibold">Direction</th>
                <th className="px-4 py-3 font-semibold">Confidence</th>
                <th className="px-4 py-3 font-semibold">Buy / Sell Weight</th>
                <th className="px-4 py-3 font-semibold">Signals</th>
                <th className="px-4 py-3 font-semibold">Freshness</th>
                <th className="px-4 py-3 font-semibold">BUY Zones</th>
                <th className="px-4 py-3 font-semibold">SELL Zones</th>
                <th className="px-4 py-3 font-semibold">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {isLoading ? (
                [0, 1, 2, 3].map((row) => <OpportunitySkeleton key={row} />)
              ) : opportunities.length > 0 ? (
                opportunities.map((opportunity) => (
                  <OpportunityRow key={opportunity.pair} opportunity={opportunity} />
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No active fresh opportunities right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OpportunityRow({ opportunity }) {
  return (
    <tr className="align-top text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.035]">
      <td className="px-4 py-4 font-bold text-slate-950 dark:text-white">
        {opportunity.pair}
      </td>
      <td className="px-4 py-4">
        <DirectionBadge direction={opportunity.marketDirection} />
      </td>
      <td className="px-4 py-4">
        <DirectionalConfidence opportunity={opportunity} />
      </td>
      <td className="px-4 py-4">
        <WeightSplit opportunity={opportunity} />
      </td>
      <td className="px-4 py-4 font-semibold text-slate-900 dark:text-slate-100">
        {opportunity.signalCount}
      </td>
      <td className="px-4 py-4">
        <FreshnessBadge freshnessLevel={opportunity.freshnessLevel} />
      </td>
      <td className="px-4 py-4">
        <DirectionalZones direction="BUY" zones={opportunity.buyZones} />
      </td>
      <td className="px-4 py-4">
        <DirectionalZones direction="SELL" zones={opportunity.sellZones} />
      </td>
      <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
        {formatTime(opportunity.lastUpdated)}
      </td>
    </tr>
  );
}

function DirectionalZones({ direction, zones }) {
  const tone =
    direction === "BUY"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-rose-700 dark:text-rose-300";

  return (
    <div className="min-w-[9rem] space-y-1 text-xs">
      <p className={`font-bold ${tone}`}>{direction}</p>
      <ZoneLine label="Entry" zone={zones?.entryZone} />
      <ZoneLine label="TP" zone={zones?.tpZone} />
      <ZoneLine label="SL" zone={zones?.slZone} />
    </div>
  );
}

function ZoneLine({ label, zone }) {
  return (
    <p className="flex justify-between gap-3 text-slate-600 dark:text-slate-300">
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800 dark:text-slate-100">{formatZone(zone)}</span>
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
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold ${
        directionStyles[safeDirection] || directionStyles.NEUTRAL
      }`}
    >
      <Icon size={13} />
      {safeDirection}
    </span>
  );
}

function FreshnessBadge({ freshnessLevel }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold ${
        freshnessStyles[freshnessLevel] || freshnessStyles.STALE
      }`}
    >
      <Clock3 size={13} />
      {freshnessLevel || "STALE"}
    </span>
  );
}

function DirectionalConfidence({ opportunity }) {
  return (
    <div className="min-w-[9rem] space-y-2">
      <ConfidenceMeter
        label="BUY"
        value={Number(opportunity.buyConfidence) || 0}
        colorClass="bg-emerald-500 dark:bg-emerald-400"
        textClass="text-emerald-700 dark:text-emerald-300"
      />
      <ConfidenceMeter
        label="SELL"
        value={Number(opportunity.sellConfidence) || 0}
        colorClass="bg-rose-500 dark:bg-rose-400"
        textClass="text-rose-700 dark:text-rose-300"
      />
    </div>
  );
}

function ConfidenceMeter({ label, value, colorClass, textClass }) {
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), 100);

  return (
    <div>
      <div className="flex justify-between gap-3 text-xs font-bold">
        <span className={textClass}>{label}</span>
        <span className="text-slate-900 dark:text-slate-100">{safeValue}%</span>
      </div>
      <span className="mt-1 block h-2 w-full min-w-24 rounded-full bg-slate-200 dark:bg-slate-800">
        <span
          className={`block h-2 rounded-full ${colorClass}`}
          style={{ width: `${safeValue}%` }}
        ></span>
      </span>
    </div>
  );
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

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-bold text-slate-950 dark:text-white">{value}</p>
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

function buildSummary(opportunities, marketOverview) {
  const overviewPairCount = Number(marketOverview?.pairCount);
  const overviewSignalCount = Number(marketOverview?.signalCount);
  const pairCount = Number.isFinite(overviewPairCount)
    ? overviewPairCount
    : opportunities.length;
  const signalCount = Number.isFinite(overviewSignalCount)
    ? overviewSignalCount
    : opportunities.reduce((sum, opportunity) => sum + opportunity.signalCount, 0);
  const marketBias = marketOverview?.marketBias || getMarketBias(opportunities);
  const top = marketOverview?.strongestOpportunity || opportunities[0];

  if (opportunities.length === 0) {
    return {
      pairCount,
      signalCount,
      marketBias,
      text: "No fresh active opportunities are available right now. The engine is still listening and will surface pairs when live consensus appears.",
    };
  }

  return {
    pairCount,
    signalCount,
    marketBias,
    text: `${top.pair} is currently the strongest live setup: ${top.marketDirection}, BUY confidence ${top.buyConfidence || 0}%, SELL confidence ${top.sellConfidence || 0}%, ${top.signalCount} active signals. This is live Telegram consensus, not a prediction.`,
  };
}

function getMarketBias(opportunities) {
  const buyWeight = opportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.buyWeight || 0),
    0
  );
  const sellWeight = opportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.sellWeight || 0),
    0
  );

  if (buyWeight === sellWeight) {
    return "NEUTRAL";
  }

  return buyWeight > sellWeight ? "BUY" : "SELL";
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
