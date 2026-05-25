import { getParsedSignals } from "./parsedSignalStore.js";
import { getConsensusCountableSignals } from "./duplicateSignalDetection.js";

const activeStates = new Set(["ACTIVE", "PARTIAL"]);
const freshnessWeights = {
  VERY_FRESH: 1,
  FRESH: 0.75,
  AGING: 0.45,
  STALE: 0,
};

export async function getConsensusSummary(options = {}) {
  const limit = Number(options.limit) || 500;
  const latestLimit = Number(options.latestLimit) || 5;
  const signals = await getParsedSignals(limit, {
    activeOnly: true,
    hideStale: true,
  });
  const groupedSignals = groupConsensusSignals(signals);

  return [...groupedSignals.entries()]
    .map(([pair, pairSignals]) => createPairSummary(pair, pairSignals, latestLimit))
    .sort((left, right) => right.confidence - left.confidence || left.pair.localeCompare(right.pair));
}

function groupConsensusSignals(signals) {
  const groups = new Map();

  for (const signal of signals) {
    if (!isConsensusCandidate(signal)) {
      continue;
    }

    const pairSignals = groups.get(signal.pair) || [];
    pairSignals.push(signal);
    groups.set(signal.pair, pairSignals);
  }

  return groups;
}

function isConsensusCandidate(signal) {
  return (
    signal?.pair &&
    ["BUY", "SELL"].includes(signal.action) &&
    signal.freshnessScore !== "STALE" &&
    activeStates.has(signal.signalState || signal.signalStatus) &&
    (signal.parserClassification || signal.classification) === "NEW_SIGNAL"
  );
}

function createPairSummary(pair, signals, latestLimit) {
  const countableSignals = getConsensusCountableSignals(signals);
  const buySignals = countableSignals.filter((signal) => signal.action === "BUY").length;
  const sellSignals = countableSignals.filter((signal) => signal.action === "SELL").length;
  const totalSignals = buySignals + sellSignals;
  const consensus = getConsensus(buySignals, sellSignals);
  const majorityCount = Math.max(buySignals, sellSignals);
  const averageExtractionConfidence = average(
    countableSignals.map((signal) => Number(signal.extractionConfidence) || 0)
  );
  const confidence =
    totalSignals > 0
      ? Math.round((majorityCount / totalSignals) * averageExtractionConfidence * 100)
      : 0;
  const averageFreshnessWeight = average(
    countableSignals.map((signal) => getFreshnessWeight(signal.freshnessScore))
  );

  return {
    pair,
    buySignals,
    sellSignals,
    duplicateSignals: signals.length - countableSignals.length,
    consensus,
    confidence: consensus === "NEUTRAL" ? Math.min(confidence, 50) : confidence,
    freshness: getFreshnessBucket(averageFreshnessWeight),
    latestActiveSignals: signals
      .slice()
      .sort(compareSignalsByRecency)
      .slice(0, latestLimit)
      .map((signal) => ({
        pair: signal.pair,
        action: signal.action,
        entry: signal.entry,
        entryRange: signal.entryRange,
        targets: signal.targets,
        stopLoss: signal.stopLoss,
        channel: signal.channel,
        messageId: signal.messageId,
        createdAt: signal.createdAt || signal.timestamp,
        freshnessScore: signal.freshnessScore,
        signalState: signal.signalState,
        extractionConfidence: signal.extractionConfidence,
        possibleDuplicate: Boolean(signal.possibleDuplicate),
      })),
  };
}

function getConsensus(buySignals, sellSignals) {
  const totalSignals = buySignals + sellSignals;

  if (totalSignals === 0) {
    return "NEUTRAL";
  }

  const difference = Math.abs(buySignals - sellSignals);
  const majorityRatio = Math.max(buySignals, sellSignals) / totalSignals;

  if (difference <= 1 || majorityRatio < 0.6) {
    return "NEUTRAL";
  }

  return buySignals > sellSignals ? "BUY" : "SELL";
}

function getFreshnessWeight(freshnessScore) {
  return freshnessWeights[freshnessScore] ?? 0;
}

function getFreshnessBucket(weight) {
  if (weight >= 0.9) {
    return "VERY_FRESH";
  }

  if (weight >= 0.6) {
    return "FRESH";
  }

  if (weight > 0) {
    return "AGING";
  }

  return "STALE";
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareSignalsByRecency(left, right) {
  return getSignalTime(right) - getSignalTime(left);
}

function getSignalTime(signal) {
  const date = new Date(signal.createdAt || signal.timestamp || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
