import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Minus,
  ShieldAlert,
} from "lucide-react";
import { getForexPairs, getRecentSignals } from "../services/signalService";

const actionStyles = {
  "Strong Buy":
    "border-emerald-300/30 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300",
  Buy: "border-emerald-300/30 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  Neutral:
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
  Sell: "border-rose-300/40 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300",
  "Strong Sell":
    "border-rose-300/40 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
  "Avoid Trade":
    "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
};

const riskStyles = {
  Low: "border-emerald-300/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  Medium:
    "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
  High: "border-rose-300/40 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300",
};

function Dashboard() {
  const [pairs, setPairs] = useState([]);
  const [recentSignals, setRecentSignals] = useState([]);
  const [expandedPair, setExpandedPair] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      const [forexPairs, signals] = await Promise.all([
        getForexPairs(),
        getRecentSignals(),
      ]);

      setPairs(forexPairs);
      setRecentSignals(signals);
      setExpandedPair(forexPairs[0]?.name ?? "");
      setIsLoading(false);
    };

    loadDashboardData();
  }, []);

  const opportunities = useMemo(
    () =>
      pairs
        .map((pair) => buildOpportunity(pair))
        .sort((first, second) => second.score - first.score),
    [pairs]
  );

  const lastUpdatedMinutes = opportunities.length
    ? Math.min(...opportunities.map((opportunity) => opportunity.minutesAgo))
    : 0;
  const reviewedSignalCount = opportunities.reduce(
    (total, opportunity) => total + opportunity.totalSignals,
    0
  );
  const actionableCount = opportunities.filter(
    (opportunity) =>
      !["Neutral", "Avoid Trade"].includes(opportunity.action)
  ).length;
  const marketSummary = isLoading
    ? "Reading Telegram signals and organizing consensus by pair."
    : buildMarketSummary(opportunities);

  return (
    <div className="animate-dashboard-in space-y-4 pb-8">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#0B1220] dark:shadow-black/10 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <BrainCircuit size={16} />
              Telegram consensus assistant
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
              Top Telegram Opportunities
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {marketSummary}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm lg:min-w-[22rem]">
            <SummaryStat
              label="Signals"
              value={isLoading ? "--" : reviewedSignalCount}
            />
            <SummaryStat
              label="Actionable"
              value={isLoading ? "--" : actionableCount}
            />
            <SummaryStat
              label="Freshest"
              value={
                isLoading ? "--" : formatFreshness(lastUpdatedMinutes)
              }
            />
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-widest text-slate-500 dark:border-white/10 dark:text-slate-500">
                <th className="px-3 py-3 font-semibold">Pair</th>
                <th className="px-3 py-3 font-semibold">Action</th>
                <th className="px-3 py-3 font-semibold">Confidence</th>
                <th className="px-3 py-3 font-semibold">Freshness</th>
                <th className="px-3 py-3 font-semibold">Entry Zone</th>
                <th className="px-3 py-3 font-semibold">Target</th>
                <th className="px-3 py-3 font-semibold">Stop Loss</th>
                <th className="px-3 py-3 font-semibold">Risk</th>
                <th className="px-3 py-3 font-semibold">Telegram Consensus Summary</th>
                <th className="px-3 py-3 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {isLoading
                ? [0, 1, 2, 3].map((row) => <OpportunitySkeleton key={row} />)
                : opportunities.map((opportunity) => (
                    <OpportunityRow
                      key={opportunity.pair}
                      opportunity={opportunity}
                      isExpanded={expandedPair === opportunity.pair}
                      onToggle={() =>
                        setExpandedPair((current) =>
                          current === opportunity.pair ? "" : opportunity.pair
                        )
                      }
                    />
                  ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#0B1220]/90 dark:shadow-black/10 lg:col-span-3">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">
              Pair Ranking
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ranked after reducing stale, mixed, and low-signal setups.
            </p>
          </div>

          <div className="space-y-4">
            {isLoading
              ? [84, 76, 62, 49].map((width, index) => (
                  <RankingSkeleton key={index} width={width} />
                ))
              : opportunities.map((opportunity) => (
                  <RankingBar key={opportunity.pair} opportunity={opportunity} />
                ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#0B1220]/90 dark:shadow-black/10 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            Confidence Comparison
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Clearer agreement shows stronger; avoid states stay visibly weaker.
          </p>

          <div className="mt-5 space-y-3">
            {isLoading
              ? [0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                  ></div>
                ))
              : opportunities.map((opportunity) => (
                  <div
                    key={opportunity.pair}
                    className="rounded-lg border border-slate-200 p-3 dark:border-white/10"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {opportunity.pair}
                      </span>
                      <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {opportunity.confidence}%
                      </span>
                    </div>
                    <ConfidenceTrack opportunity={opportunity} />
                  </div>
                ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#0B1220]/90 dark:shadow-black/10">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-4 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
              <Clock3 size={17} className="text-blue-500 dark:text-sky-300" />
              Recent Telegram Signals
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Supporting evidence from mocked Telegram channels.
            </p>
          </div>
          <p className="text-sm text-slate-500">
            {isLoading ? "Loading" : `${recentSignals.length} signals reviewed`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-widest text-slate-500 dark:border-white/10">
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Pair</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Entry</th>
                <th className="px-4 py-3 font-semibold">Target</th>
                <th className="px-4 py-3 font-semibold">Stop Loss</th>
                <th className="px-4 py-3 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {isLoading
                ? [0, 1, 2, 3].map((row) => <SignalSkeleton key={row} />)
                : recentSignals.map((signal) => (
                    <tr
                      key={`${signal.pair}-${signal.source}-${signal.minutesAgo}`}
                      className="text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.035]"
                    >
                      <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
                        {formatFreshness(signal.minutesAgo)}
                      </td>
                      <td className="px-4 py-4 font-semibold text-slate-950 dark:text-white">
                        {signal.pair}
                      </td>
                      <td className="px-4 py-4">
                        <SignalBadge signal={signal} />
                      </td>
                      <td className="px-4 py-4 font-medium">{signal.entry}</td>
                      <td className="px-4 py-4 font-medium">{signal.target}</td>
                      <td className="px-4 py-4 font-medium">{signal.stopLoss}</td>
                      <td className="px-4 py-4 text-slate-500 dark:text-slate-400">
                        {signal.source}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OpportunityRow({ opportunity, isExpanded, onToggle }) {
  return (
    <>
      <tr
        className={`align-top text-slate-600 transition dark:text-slate-300 ${
          opportunity.action === "Avoid Trade"
            ? "bg-amber-50/45 dark:bg-amber-400/[0.04]"
            : "hover:bg-slate-50 dark:hover:bg-white/[0.035]"
        }`}
      >
        <td className="px-3 py-4 font-bold text-slate-950 dark:text-white">
          {opportunity.pair}
        </td>
        <td className="px-3 py-4">
          <ActionBadge action={opportunity.action} />
        </td>
        <td className="px-3 py-4">
          <ConfidenceMeter opportunity={opportunity} />
        </td>
        <td className="px-3 py-4">
          <FreshnessBadge opportunity={opportunity} />
        </td>
        <td className="px-3 py-4 font-semibold text-slate-900 dark:text-slate-100">
          {opportunity.entryZone}
        </td>
        <td className="px-3 py-4 font-semibold text-slate-900 dark:text-slate-100">
          {opportunity.target}
        </td>
        <td className="px-3 py-4 font-semibold text-slate-900 dark:text-slate-100">
          {opportunity.stopLoss}
        </td>
        <td className="px-3 py-4">
          <RiskBadge risk={opportunity.risk} />
        </td>
        <td className="max-w-[18rem] px-3 py-4">
          <p className="font-medium">{opportunity.consensusSummary}</p>
          {opportunity.warningLabel && (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              {opportunity.warningLabel}
            </p>
          )}
        </td>
        <td className="px-3 py-4">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-100 active:scale-95 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
            aria-label={`Toggle explanation for ${opportunity.pair}`}
            aria-expanded={isExpanded}
          >
            <ChevronDown
              size={17}
              className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
            />
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={10} className="px-3 pb-4">
            <OpportunityExplanation opportunity={opportunity} />
          </td>
        </tr>
      )}
    </>
  );
}

function OpportunityExplanation({ opportunity }) {
  const headline =
    opportunity.action === "Avoid Trade"
      ? `Why ${opportunity.pair} should be avoided`
      : `Why ${opportunity.pair} is ${opportunity.action}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Why this trade?
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-950 dark:text-white">
            {headline}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionBadge action={opportunity.action} />
          <RiskBadge risk={opportunity.risk} />
        </div>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {opportunity.reasonSignals.map((reason) => (
          <li
            key={reason}
            className="flex gap-3 text-sm leading-6 text-slate-600 dark:text-slate-300"
          >
            <CheckCircle2
              className="mt-1 shrink-0 text-blue-500 dark:text-sky-300"
              size={16}
            />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildOpportunity(pair) {
  const buyCount = pair.buyCount ?? (pair.color === "green" ? 8 : 3);
  const sellCount = pair.sellCount ?? (pair.color === "red" ? 8 : 3);
  const totalSignals = buyCount + sellCount;
  const leaderCount = Math.max(buyCount, sellCount);
  const disagreement = totalSignals ? 1 - leaderCount / totalSignals : 1;
  const freshness = getFreshness(pair.minutesAgo ?? 60);
  const adjustedConfidence = Math.max(
    25,
    Math.round(pair.percentage * freshness.weight - disagreement * 18)
  );
  const bias =
    buyCount > sellCount ? "buy" : sellCount > buyCount ? "sell" : "neutral";
  const action = getAction({
    bias,
    confidence: adjustedConfidence,
    freshnessState: freshness.state,
    disagreement,
    totalSignals,
  });
  const risk = getRisk({
    confidence: adjustedConfidence,
    disagreement,
    freshnessState: freshness.state,
    totalSignals,
  });
  const warningLabel = getOpportunityWarning({
    action,
    adjustedConfidence,
    disagreement,
    freshnessState: freshness.state,
    totalSignals,
  });

  return {
    pair: pair.name,
    action,
    bias,
    confidence: adjustedConfidence,
    freshnessLabel: freshness.label,
    freshnessState: freshness.state,
    minutesAgo: pair.minutesAgo ?? 60,
    entryZone: pair.entryZone ?? "Review latest signal",
    target: pair.target ?? "Not enough agreement",
    stopLoss: pair.stopLoss ?? "Not enough agreement",
    buyCount,
    sellCount,
    totalSignals,
    disagreement,
    risk,
    score:
      action === "Avoid Trade"
        ? adjustedConfidence - 45
        : Math.round(adjustedConfidence - disagreement * 20),
    consensusSummary: getConsensusSummary({
      bias,
      buyCount,
      sellCount,
      action,
      freshness,
    }),
    warningLabel,
    reasonSignals: buildReasons({
      action,
      buyCount,
      sellCount,
      freshness,
      disagreement,
      pair,
      adjustedConfidence,
      totalSignals,
    }),
  };
}

function getFreshness(minutesAgo) {
  if (minutesAgo <= 1) {
    return { label: "Active now", state: "fresh", weight: 1 };
  }

  if (minutesAgo <= 10) {
    return { label: `${minutesAgo}m ago`, state: "fresh", weight: 0.96 };
  }

  if (minutesAgo <= 30) {
    return { label: `${minutesAgo}m ago`, state: "aging", weight: 0.82 };
  }

  if (minutesAgo <= 60) {
    return { label: "1h ago", state: "old", weight: 0.68 };
  }

  return { label: "Stale", state: "stale", weight: 0.48 };
}

function getAction({
  bias,
  confidence,
  freshnessState,
  disagreement,
  totalSignals,
}) {
  if (
    freshnessState === "stale" ||
    confidence < 45 ||
    disagreement > 0.42 ||
    totalSignals < 6
  ) {
    return "Avoid Trade";
  }

  if (confidence < 58 || bias === "neutral") {
    return "Neutral";
  }

  if (bias === "buy") {
    return confidence >= 78 ? "Strong Buy" : "Buy";
  }

  if (bias === "sell") {
    return confidence >= 78 ? "Strong Sell" : "Sell";
  }

  return "Neutral";
}

function getRisk({ confidence, disagreement, freshnessState, totalSignals }) {
  const freshnessPenalty =
    freshnessState === "stale" ? 2 : freshnessState === "old" ? 1 : 0;
  const riskScore =
    (confidence < 60 ? 1 : 0) +
    (disagreement > 0.32 ? 1 : 0) +
    (totalSignals < 8 ? 1 : 0) +
    freshnessPenalty;

  if (riskScore >= 2) {
    return "High";
  }

  if (riskScore === 1) {
    return "Medium";
  }

  return "Low";
}

function getConsensusSummary({ bias, buyCount, sellCount, action, freshness }) {
  if (action === "Avoid Trade") {
    return "Avoid: signal count, freshness, or channel agreement is not strong enough.";
  }

  if (Math.abs(buyCount - sellCount) <= 2) {
    return `${buyCount} buy vs ${sellCount} sell signals. Consensus is mixed.`;
  }

  const direction = bias === "buy" ? "bullish" : "bearish";
  const leadingCount = bias === "buy" ? buyCount : sellCount;
  const oppositeCount = bias === "buy" ? sellCount : buyCount;

  return `${leadingCount} ${direction} signals vs ${oppositeCount} opposing signals, latest activity ${freshness.label.toLowerCase()}.`;
}

function buildReasons({
  action,
  buyCount,
  sellCount,
  freshness,
  disagreement,
  pair,
  adjustedConfidence,
  totalSignals,
}) {
  const leader = buyCount >= sellCount ? "bullish" : "bearish";
  const opposite = buyCount >= sellCount ? sellCount : buyCount;
  const reasons = [
    `${Math.max(buyCount, sellCount)} ${leader} Telegram signals`,
    `only ${opposite} opposing signals`,
    freshness.state === "fresh"
      ? `recent activity is fresh: ${freshness.label.toLowerCase()}`
      : `freshness is weaker: ${freshness.label.toLowerCase()}`,
    disagreement <= 0.25
      ? "low disagreement between sources"
      : "high disagreement between sources",
    totalSignals >= 8
      ? `${totalSignals} recent signals reviewed`
      : `only ${totalSignals} recent signals reviewed`,
    adjustedConfidence >= 72
      ? "confidence remains strong after freshness adjustment"
      : "confidence is reduced after freshness adjustment",
  ];

  if (action === "Avoid Trade") {
    reasons.push(`${pair.name} should be treated as no-trade until consensus improves`);
  }

  return reasons;
}

function buildMarketSummary(opportunities) {
  const tradable = opportunities.filter(
    (opportunity) =>
      opportunity.action !== "Avoid Trade" && opportunity.action !== "Neutral"
  );

  if (tradable.length === 0) {
    return "No clear Telegram opportunity right now. Most setups are mixed, stale, or low confidence.";
  }

  const top = tradable[0];
  return `${top.pair} is currently the clearest consensus setup: ${top.action}, ${top.confidence}% confidence, ${top.freshnessLabel.toLowerCase()}, ${top.risk.toLowerCase()} risk. This is a summary of Telegram sentiment, not a prediction.`;
}

function getOpportunityWarning({
  action,
  adjustedConfidence,
  disagreement,
  freshnessState,
  totalSignals,
}) {
  if (action === "Avoid Trade") {
    if (freshnessState === "stale") return "Signals are stale";
    if (totalSignals < 6) return "Insufficient signal count";
    if (disagreement > 0.42) return "High disagreement";
    return "Low-confidence setup";
  }

  if (freshnessState === "stale" || freshnessState === "old") {
    return "Signals are becoming stale";
  }

  if (totalSignals < 8) {
    return "Low recent activity";
  }

  if (disagreement > 0.38) {
    return "Mixed channel opinion";
  }

  if (adjustedConfidence < 60) {
    return "Low confidence";
  }

  return "";
}

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.035]">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-bold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function ActionBadge({ action }) {
  const Icon = action.includes("Buy")
    ? ArrowUpRight
    : action.includes("Sell")
    ? ArrowDownRight
    : action === "Neutral"
    ? Minus
    : AlertTriangle;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold ${actionStyles[action]}`}
    >
      <Icon size={13} />
      {action}
    </span>
  );
}

function SignalBadge({ signal }) {
  const action = signal.signal === "BUY" ? "Buy" : "Sell";

  return <ActionBadge action={action} />;
}

function RiskBadge({ risk }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold ${riskStyles[risk]}`}
    >
      <ShieldAlert size={13} />
      {risk} Risk
    </span>
  );
}

function FreshnessBadge({ opportunity }) {
  const classes =
    opportunity.freshnessState === "fresh"
      ? "border-emerald-300/40 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
      : opportunity.freshnessState === "aging"
      ? "border-blue-300/50 bg-blue-50 text-blue-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300"
      : opportunity.freshnessState === "old"
      ? "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300"
      : "border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      <Clock3 size={13} />
      {opportunity.freshnessLabel}
    </span>
  );
}

function ConfidenceMeter({ opportunity }) {
  return (
    <div className="flex min-w-[8rem] items-center gap-3">
      <span className="w-9 font-bold text-slate-950 dark:text-slate-100">
        {opportunity.confidence}%
      </span>
      <ConfidenceTrack opportunity={opportunity} />
    </div>
  );
}

function ConfidenceTrack({ opportunity }) {
  const color =
    opportunity.action === "Avoid Trade"
      ? "bg-slate-400 dark:bg-slate-500"
      : opportunity.risk === "High"
      ? "bg-rose-500 dark:bg-rose-400"
      : opportunity.risk === "Medium"
      ? "bg-amber-400 dark:bg-amber-300"
      : opportunity.bias === "sell"
      ? "bg-rose-500 dark:bg-rose-400"
      : "bg-emerald-500 dark:bg-emerald-400";

  return (
    <span className="h-2 w-full min-w-24 rounded-full bg-slate-200 dark:bg-slate-800">
      <span
        className={`block h-2 rounded-full ${color}`}
        style={{ width: `${opportunity.confidence}%` }}
      ></span>
    </span>
  );
}

function RankingBar({ opportunity }) {
  return (
    <div className="grid grid-cols-[5rem_1fr_4.5rem] items-center gap-3">
      <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-200">
        {opportunity.pair}
      </span>
      <ConfidenceTrack opportunity={opportunity} />
      <span className="text-right text-sm font-semibold text-slate-600 dark:text-slate-300">
        {opportunity.action}
      </span>
    </div>
  );
}

function RankingSkeleton({ width }) {
  return (
    <div className="grid grid-cols-[5rem_1fr_4.5rem] items-center gap-3">
      <div className="h-3 animate-pulse rounded bg-slate-100 dark:bg-slate-800"></div>
      <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-2.5 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700"
          style={{ width: `${width}%` }}
        ></div>
      </div>
      <div className="h-3 animate-pulse rounded bg-slate-100 dark:bg-slate-800"></div>
    </div>
  );
}

function OpportunitySkeleton() {
  return (
    <tr>
      {[70, 104, 128, 96, 112, 80, 88, 102, 180, 40].map((width, index) => (
        <td key={index} className="px-3 py-4">
          <div
            className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
            style={{ width }}
          ></div>
        </td>
      ))}
    </tr>
  );
}

function SignalSkeleton() {
  return (
    <tr>
      {[88, 84, 92, 90, 90, 90, 140].map((width, index) => (
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

function formatFreshness(minutesAgo) {
  return getFreshness(minutesAgo ?? 60).label;
}

export default Dashboard;
