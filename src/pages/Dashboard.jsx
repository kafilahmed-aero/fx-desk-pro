import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import {
  getForexPairs,
  getRecentSignals,
} from "../services/signalService";

const actionStyles = {
  "Strong Buy": "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  Buy: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  Sell: "border-rose-400/20 bg-rose-400/10 text-rose-300",
  "Strong Sell": "border-rose-400/25 bg-rose-400/10 text-rose-300",
  Neutral: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  "Avoid Trade": "border-amber-400/25 bg-amber-400/10 text-amber-300",
};

const riskStyles = {
  Low: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  Medium: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  High: "border-rose-400/25 bg-rose-400/10 text-rose-300",
};

function Dashboard() {
  const [pairs, setPairs] = useState([]);
  const [recentSignals, setRecentSignals] = useState([]);
  const [selectedPairName, setSelectedPairName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      const [forexPairs, signals] = await Promise.all([
        getForexPairs(),
        getRecentSignals(),
      ]);

      setPairs(forexPairs);
      setRecentSignals(signals);
      setSelectedPairName(forexPairs[0]?.name ?? "");
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

  const selectedOpportunity =
    opportunities.find((opportunity) => opportunity.pair === selectedPairName) ??
    opportunities[0];
  const lastUpdatedMinutes = opportunities.length
    ? Math.min(...opportunities.map((opportunity) => opportunity.minutesAgo))
    : 0;
  const reviewedSignalCount =
    selectedOpportunity?.totalSignals ??
    opportunities.reduce((total, opportunity) => total + opportunity.totalSignals, 0);
  const warningStates = isLoading ? [] : buildWarningStates(opportunities);

  const marketSummary = isLoading
    ? "Reading fresh Telegram signals and ranking the strongest opportunities."
    : buildMarketSummary(opportunities);

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-lg border border-white/10 bg-[#0B1220] p-4 shadow-sm shadow-black/10 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
              <BrainCircuit size={16} />
              Telegram Signal Consensus Engine
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Top Telegram Opportunities
            </h1>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-300">
              <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-1">
                <Clock3 size={13} />
                Updated {isLoading ? "--" : formatFreshness(lastUpdatedMinutes).toLowerCase()}
              </span>
              <span className="inline-flex rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-1">
                Based on {isLoading ? "--" : reviewedSignalCount} recent Telegram signals
              </span>
            </div>
          </div>
          <div className="max-w-xl">
            <p className="text-sm leading-6 text-slate-300">{marketSummary}</p>
            {warningStates.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {warningStates.map((warning) => (
                  <WarningBadge key={warning.label} warning={warning} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-widest text-slate-500">
                <th className="px-3 py-3 font-semibold">Pair</th>
                <th className="px-3 py-3 font-semibold">What To Do</th>
                <th className="px-3 py-3 font-semibold">Confidence</th>
                <th className="px-3 py-3 font-semibold">Freshness</th>
                <th className="px-3 py-3 font-semibold">Channel Support</th>
                <th className="px-3 py-3 font-semibold">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {isLoading
                ? [0, 1, 2, 3].map((row) => <OpportunitySkeleton key={row} />)
                : opportunities.map((opportunity) => (
                    <tr
                      key={opportunity.pair}
                      className={`cursor-pointer text-slate-300 transition hover:bg-white/[0.035] ${
                        selectedOpportunity?.pair === opportunity.pair
                          ? "bg-white/[0.05]"
                          : ""
                      }`}
                      onClick={() => setSelectedPairName(opportunity.pair)}
                    >
                      <td className="px-3 py-4 font-semibold text-white">
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
                      <td className="px-3 py-4 text-slate-300">
                        {opportunity.consensusLabel}
                        {opportunity.warningLabel && (
                          <p className="mt-1 text-xs text-amber-300">
                            {opportunity.warningLabel}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <RiskBadge risk={opportunity.risk} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 space-y-3 md:hidden">
          {isLoading
            ? [0, 1, 2].map((card) => (
                <div
                  key={card}
                  className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
                >
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-800"></div>
                  <div className="mt-4 h-3 w-full animate-pulse rounded bg-slate-800"></div>
                  <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-slate-800"></div>
                </div>
              ))
            : opportunities.map((opportunity) => (
                <button
                  type="button"
                  key={opportunity.pair}
                  onClick={() => setSelectedPairName(opportunity.pair)}
                  className={`w-full rounded-lg border border-white/10 bg-white/[0.035] p-4 text-left transition active:scale-[0.99] ${
                    selectedOpportunity?.pair === opportunity.pair
                      ? "border-sky-400/30 bg-sky-400/10"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-white">
                        {opportunity.pair}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {opportunity.consensusLabel}
                      </p>
                      {opportunity.warningLabel && (
                        <p className="mt-1 text-xs text-amber-300">
                          {opportunity.warningLabel}
                        </p>
                      )}
                    </div>
                    <ActionBadge action={opportunity.action} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MobileFact label="Confidence" value={`${opportunity.confidence}%`} />
                    <MobileFact label="Freshness" value={opportunity.freshnessLabel} />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <RiskBadge risk={opportunity.risk} />
                    <FreshnessBadge opportunity={opportunity} />
                  </div>
                </button>
              ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-white/10 bg-[#0B1220]/85 p-4 lg:col-span-3">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-white">Pair Confidence Ranking</h2>
            <p className="text-sm text-slate-400">
              Simple comparison after stale and mixed signals are reduced.
            </p>
          </div>

          <div className="space-y-4">
            {isLoading
              ? [84, 76, 62, 49].map((width, index) => (
                  <div key={index} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-3">
                    <div className="h-3 animate-pulse rounded bg-slate-800"></div>
                    <div className="h-2.5 rounded-full bg-slate-800">
                      <div
                        className="h-2.5 animate-pulse rounded-full bg-slate-700"
                        style={{ width: `${width}%` }}
                      ></div>
                    </div>
                    <div className="h-3 animate-pulse rounded bg-slate-800"></div>
                  </div>
                ))
              : opportunities.map((opportunity) => (
                  <button
                    type="button"
                    key={opportunity.pair}
                    onClick={() => setSelectedPairName(opportunity.pair)}
                    className="grid w-full grid-cols-[4.5rem_1fr_3rem] items-center gap-3 text-left"
                  >
                    <span className="truncate text-sm font-semibold text-slate-200">
                      {opportunity.pair}
                    </span>
                    <span className="h-2.5 rounded-full bg-slate-800">
                      <span
                        className={`block h-2.5 rounded-full ${
                          opportunity.bias === "buy"
                            ? "bg-emerald-400"
                            : opportunity.bias === "sell"
                            ? "bg-rose-400"
                            : "bg-sky-400"
                        }`}
                        style={{ width: `${opportunity.confidence}%` }}
                      ></span>
                    </span>
                    <span className="text-right text-sm font-semibold text-slate-300">
                      {opportunity.confidence}%
                    </span>
                  </button>
                ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#0B1220]/85 p-4 lg:col-span-2">
          {selectedOpportunity ? (
            <OpportunityExplanation opportunity={selectedOpportunity} />
          ) : (
            <div className="space-y-3">
              <div className="h-4 w-40 animate-pulse rounded bg-slate-800"></div>
              <div className="h-3 w-full animate-pulse rounded bg-slate-800"></div>
              <div className="h-3 w-4/5 animate-pulse rounded bg-slate-800"></div>
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-white/10 bg-[#0B1220]/85">
        <div className="flex flex-col gap-1 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-white">
              <Clock3 size={17} className="text-sky-300" />
              Recent Telegram Signals
            </h2>
            <p className="text-sm text-slate-400">
              Evidence behind the recommendations.
            </p>
          </div>
          <p className="text-sm text-slate-500">
            {isLoading ? "Loading" : `${recentSignals.length} signals`}
          </p>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-widest text-slate-500">
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Pair</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Confidence</th>
                <th className="px-4 py-3 font-semibold">Channel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {isLoading
                ? [0, 1, 2, 3].map((row) => (
                    <tr key={row}>
                      {[88, 84, 80, 96, 140].map((width, index) => (
                        <td key={index} className="px-4 py-4">
                          <div
                            className="h-4 animate-pulse rounded bg-slate-800"
                            style={{ width }}
                          ></div>
                        </td>
                      ))}
                    </tr>
                  ))
                : recentSignals.map((signal) => (
                    <tr
                      key={`${signal.pair}-${signal.source}-${signal.minutesAgo}`}
                      className="text-slate-300 hover:bg-white/[0.035]"
                    >
                      <td className="px-4 py-4 text-slate-400">
                        {formatFreshness(signal.minutesAgo)}
                      </td>
                      <td className="px-4 py-4 font-semibold text-white">
                        {signal.pair}
                      </td>
                      <td className="px-4 py-4">
                        <SignalBadge signal={signal} />
                      </td>
                      <td className="px-4 py-4 font-semibold">
                        {signal.confidence}%
                      </td>
                      <td className="px-4 py-4 text-slate-400">
                        {signal.source}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {isLoading
            ? [0, 1, 2].map((card) => (
                <div
                  key={card}
                  className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
                >
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-800"></div>
                  <div className="mt-4 h-3 w-full animate-pulse rounded bg-slate-800"></div>
                </div>
              ))
            : recentSignals.map((signal) => (
                <div
                  key={`${signal.pair}-${signal.source}-${signal.minutesAgo}`}
                  className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {formatFreshness(signal.minutesAgo)}
                      </p>
                      <p className="mt-1 font-semibold text-white">{signal.pair}</p>
                      <p className="mt-1 text-slate-400">{signal.source}</p>
                    </div>
                    <SignalBadge signal={signal} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MobileFact label="Confidence" value={`${signal.confidence}%`} />
                    <MobileFact label="Timestamp" value={formatFreshness(signal.minutesAgo)} />
                  </div>
                </div>
              ))}
        </div>
      </section>
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
    28,
    Math.round(pair.percentage * freshness.weight - disagreement * 16)
  );
  const bias =
    buyCount > sellCount ? "buy" : sellCount > buyCount ? "sell" : "neutral";
  const action = getAction(bias, adjustedConfidence, freshness.state);
  const risk = getRisk(adjustedConfidence, disagreement, freshness.state);
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
    freshnessWeight: freshness.weight,
    minutesAgo: pair.minutesAgo ?? 60,
    buyCount,
    sellCount,
    totalSignals,
    disagreement,
    risk,
    score: Math.round(adjustedConfidence - disagreement * 20),
    consensusLabel: getConsensusLabel(bias, buyCount, sellCount),
    warningLabel,
    reasonSignals: buildReasons({
      action,
      buyCount,
      sellCount,
      freshness,
      disagreement,
      pair,
      adjustedConfidence,
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

function getAction(bias, confidence, freshnessState) {
  if (freshnessState === "stale" || confidence < 45) {
    return "Avoid Trade";
  }

  if (confidence < 58) {
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

function getRisk(confidence, disagreement, freshnessState) {
  const freshnessPenalty =
    freshnessState === "stale" ? 2 : freshnessState === "old" ? 1 : 0;
  const riskScore =
    (confidence < 60 ? 1 : 0) + (disagreement > 0.32 ? 1 : 0) + freshnessPenalty;

  if (riskScore >= 2) {
    return "High";
  }

  if (riskScore === 1) {
    return "Medium";
  }

  return "Low";
}

function getConsensusLabel(bias, buyCount, sellCount) {
  if (Math.abs(buyCount - sellCount) <= 2) {
    return `${buyCount} buy vs ${sellCount} sell, mixed opinion`;
  }

  if (bias === "buy") {
    return `${buyCount} buy vs ${sellCount} sell`;
  }

  if (bias === "sell") {
    return `${sellCount} sell vs ${buyCount} buy`;
  }

  return "Mixed market opinion";
}

function buildReasons({
  action,
  buyCount,
  sellCount,
  freshness,
  disagreement,
  pair,
  adjustedConfidence,
}) {
  const leader = buyCount >= sellCount ? "bullish" : "bearish";
  const opposite = buyCount >= sellCount ? sellCount : buyCount;

  return [
    `${Math.max(buyCount, sellCount)} channels currently lean ${leader}`,
    `${opposite} channels disagree`,
    freshness.state === "fresh"
      ? `latest agreement is fresh: ${freshness.label.toLowerCase()}`
      : `signals are getting old: ${freshness.label.toLowerCase()}`,
    adjustedConfidence >= 72
      ? "confidence is strong after freshness adjustment"
      : "confidence is weak after freshness adjustment",
    disagreement <= 0.25
      ? "channel disagreement is low"
      : "channel disagreement is high",
    action === "Avoid Trade"
      ? `${pair.name} has no clear opportunity right now`
      : `${pair.name} is worth considering, with risk checks`,
  ];
}

function buildMarketSummary(opportunities) {
  const tradable = opportunities.filter(
    (opportunity) =>
      opportunity.action !== "Avoid Trade" && opportunity.action !== "Neutral"
  );

  if (tradable.length === 0) {
    return "No clean Telegram opportunity right now. Most signals are mixed, stale, or too risky.";
  }

  const top = tradable[0];
  return `${top.pair} is the clearest current opportunity: ${top.action}, ${top.confidence}% confidence, ${top.freshnessLabel}, ${top.risk.toLowerCase()} risk.`;
}

function getOpportunityWarning({
  action,
  adjustedConfidence,
  disagreement,
  freshnessState,
  totalSignals,
}) {
  if (action === "Avoid Trade") {
    return "No clear opportunity";
  }

  if (freshnessState === "stale" || freshnessState === "old") {
    return "Signals are becoming stale";
  }

  if (totalSignals < 8) {
    return "Low recent activity";
  }

  if (disagreement > 0.38) {
    return "Mixed market opinion";
  }

  if (adjustedConfidence < 60) {
    return "Low confidence";
  }

  return "";
}

function buildWarningStates(opportunities) {
  const warnings = [];

  if (
    opportunities.some(
      (opportunity) =>
        opportunity.freshnessState === "old" ||
        opportunity.freshnessState === "stale"
    )
  ) {
    warnings.push({
      label: "Signals are becoming stale",
      tone: "amber",
    });
  }

  if (opportunities.some((opportunity) => opportunity.totalSignals < 8)) {
    warnings.push({
      label: "Low recent activity",
      tone: "amber",
    });
  }

  if (
    opportunities.some(
      (opportunity) =>
        opportunity.disagreement > 0.38 || opportunity.action === "Neutral"
    )
  ) {
    warnings.push({
      label: "Mixed market opinion",
      tone: "sky",
    });
  }

  if (
    opportunities.some(
      (opportunity) =>
        opportunity.confidence < 60 || opportunity.action === "Avoid Trade"
    )
  ) {
    warnings.push({
      label: "Low confidence or avoid trade",
      tone: "rose",
    });
  }

  return warnings.slice(0, 4);
}

function OpportunityExplanation({ opportunity }) {
  const headline =
    opportunity.action === "Avoid Trade"
      ? `Why ${opportunity.pair} is not clear`
      : `Why ${opportunity.pair} is ${opportunity.action}`;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Why this opportunity?
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            {headline}
          </h2>
        </div>
        <RiskBadge risk={opportunity.risk} />
      </div>

      <ul className="mt-5 space-y-3">
        {opportunity.reasonSignals.map((reason) => (
          <li key={reason} className="flex gap-3 text-sm leading-6 text-slate-300">
            <CheckCircle2 className="mt-1 shrink-0 text-sky-300" size={16} />
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Decision guardrail
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Old signals, low channel support, and mixed opinions reduce confidence.
          Weak setups are shown as Neutral or Avoid Trade.
        </p>
      </div>
    </div>
  );
}

function ActionBadge({ action }) {
  const Icon = action.includes("Buy")
    ? ArrowUpRight
    : action.includes("Sell")
    ? ArrowDownRight
    : AlertTriangle;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold ${
        actionStyles[action]
      }`}
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
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold ${
        riskStyles[risk]
      }`}
    >
      <ShieldAlert size={13} />
      {risk} Risk
    </span>
  );
}

function WarningBadge({ warning }) {
  const classes =
    warning.tone === "rose"
      ? "border-rose-400/20 bg-rose-400/10 text-rose-300"
      : warning.tone === "sky"
      ? "border-sky-400/20 bg-sky-400/10 text-sky-300"
      : "border-amber-400/25 bg-amber-400/10 text-amber-300";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      <AlertTriangle size={13} />
      {warning.label}
    </span>
  );
}

function FreshnessBadge({ opportunity }) {
  const classes =
    opportunity.freshnessState === "fresh"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : opportunity.freshnessState === "aging"
      ? "border-sky-400/20 bg-sky-400/10 text-sky-300"
      : opportunity.freshnessState === "old"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
      : "border-slate-500/25 bg-slate-500/10 text-slate-400";

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
      <span className="w-9 font-bold text-slate-100">
        {opportunity.confidence}%
      </span>
      <span className="h-2 w-24 rounded-full bg-slate-800">
        <span
          className={`block h-2 rounded-full ${
            opportunity.risk === "High"
              ? "bg-rose-400"
              : opportunity.risk === "Medium"
              ? "bg-amber-300"
              : "bg-emerald-400"
          }`}
          style={{ width: `${opportunity.confidence}%` }}
        ></span>
      </span>
    </div>
  );
}

function MobileFact({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-slate-200">{value}</p>
    </div>
  );
}

function OpportunitySkeleton() {
  return (
    <tr>
      {[80, 96, 124, 96, 180, 108].map((width, index) => (
        <td key={index} className="px-3 py-4">
          <div
            className="h-4 animate-pulse rounded bg-slate-800"
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
