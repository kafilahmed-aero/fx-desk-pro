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
import { getActiveOpportunities } from "../services/signalService";

const refreshMs = 10000;

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOpportunities() {
      try {
        const nextOpportunities = await getActiveOpportunities();

        if (!isMounted) return;

        setOpportunities(nextOpportunities);
        setError("");
        setLastLoadedAt(new Date());
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadOpportunities();
    const timer = window.setInterval(loadOpportunities, refreshMs);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const summary = useMemo(() => buildSummary(opportunities), [opportunities]);

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

          <div className="grid grid-cols-3 gap-2 text-sm lg:min-w-[24rem]">
            <SummaryStat label="Pairs" value={isLoading ? "--" : opportunities.length} />
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
              Active and partial signals only. Closed, expired, promo, and noise are excluded.
            </p>
          </div>
          <p className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <RefreshCw size={15} />
            Live refresh every {refreshMs / 1000}s
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
                <th className="px-4 py-3 font-semibold">Entry Zone</th>
                <th className="px-4 py-3 font-semibold">TP Zone</th>
                <th className="px-4 py-3 font-semibold">SL Zone</th>
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
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
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
        <ConfidenceMeter value={opportunity.confidenceScore} />
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
      <td className="px-4 py-4 font-medium">{formatZone(opportunity.entryZone)}</td>
      <td className="px-4 py-4 font-medium">{formatZone(opportunity.tpZone)}</td>
      <td className="px-4 py-4 font-medium">{formatZone(opportunity.slZone)}</td>
      <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
        {formatTime(opportunity.lastUpdated)}
      </td>
    </tr>
  );
}

function DirectionBadge({ direction }) {
  const Icon = direction.includes("BUY")
    ? ArrowUpRight
    : direction.includes("SELL")
    ? ArrowDownRight
    : Minus;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold ${
        directionStyles[direction] || directionStyles.NEUTRAL
      }`}
    >
      <Icon size={13} />
      {direction}
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

function ConfidenceMeter({ value }) {
  return (
    <div className="flex min-w-[8rem] items-center gap-3">
      <span className="w-10 font-bold text-slate-950 dark:text-slate-100">{value}%</span>
      <span className="h-2 w-full min-w-24 rounded-full bg-slate-200 dark:bg-slate-800">
        <span
          className="block h-2 rounded-full bg-blue-500 dark:bg-sky-400"
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        ></span>
      </span>
    </div>
  );
}

function WeightSplit({ opportunity }) {
  const total = Number(opportunity.totalWeight) || 0;
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
      {[68, 112, 128, 160, 52, 96, 92, 92, 92, 96].map((width, index) => (
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

function buildSummary(opportunities) {
  if (opportunities.length === 0) {
    return {
      signalCount: 0,
      text: "No fresh active opportunities are available right now. The engine is still listening and will surface pairs when live consensus appears.",
    };
  }

  const signalCount = opportunities.reduce(
    (sum, opportunity) => sum + opportunity.signalCount,
    0
  );
  const top = opportunities[0];

  return {
    signalCount,
    text: `${top.pair} is currently the strongest live setup: ${top.marketDirection}, ${top.confidenceScore}% confidence, ${top.signalCount} active signals. This is live Telegram consensus, not a prediction.`,
  };
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
