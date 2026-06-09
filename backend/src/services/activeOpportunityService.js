import { getPairStates } from "./pairStateEngine.js";
import { canAffectConsensus } from "./signalStateEngine.js";

export function getActivePairStates() {
  return getFreshPairStates().map(formatPairIntelligence);
}

export function getWeightedConsensus(pair = null) {
  const pairs = getFreshPairStates().map(formatPairIntelligence);

  if (!pair) {
    return pairs;
  }

  const normalizedPair = String(pair).toUpperCase();
  return pairs.find((pairState) => pairState.pair === normalizedPair) || null;
}

export function getLiveConsensus() {
  return getWeightedConsensus();
}

export function getActiveOpportunities() {
  return getFreshPairStates()
    .filter((pairState) => pairState.totalWeight > 0)
    .map(formatPairIntelligence)
    .sort(
      (left, right) =>
        right.confidenceScore - left.confidenceScore ||
        right.totalWeight - left.totalWeight ||
        left.pair.localeCompare(right.pair)
    );
}

export function getLiveMarketOverview() {
  const opportunities = getActiveOpportunities();
  const pairCount = opportunities.length;
  const signalCount = opportunities.reduce(
    (sum, opportunity) => sum + opportunity.signalCount,
    0
  );

  return {
    pairCount,
    signalCount,
    marketBias: getMarketBias(opportunities),
    strongestOpportunity: opportunities[0] || null,
    pairs: opportunities,
    lastUpdated: getLatestUpdate(opportunities),
  };
}

function getFreshPairStates() {
  return getPairStates()
    .map((pairState) => ({
      ...pairState,
      freshnessLevel: getPairFreshnessLevel(pairState),
    }))
    .filter((pairState) => pairState.signalCount > 0)
    .filter((pairState) => pairState.freshnessLevel !== "STALE");
}

function formatPairIntelligence(pairState) {
  const activeSignals = (pairState.activeSignals || []).filter(canAffectConsensus);
  const channelCount = new Set(activeSignals.map(s => s.sourceChannel).filter(Boolean)).size;

  return {
    pair: pairState.pair,
    marketDirection: pairState.marketDirection,
    confidenceScore: pairState.confidenceScore,
    buyConfidence: pairState.buyConfidence,
    sellConfidence: pairState.sellConfidence,
    buyWeight: pairState.buyWeight,
    sellWeight: pairState.sellWeight,
    signalCount: pairState.signalCount,
    channelCount,
    freshnessLevel: pairState.freshnessLevel,
    buyZones: pairState.buyZones,
    sellZones: pairState.sellZones,
    entryZone: pairState.entryZone,
    tpZone: pairState.tpZone,
    slZone: pairState.slZone,
    lastUpdated: pairState.lastUpdated,
    totalWeight: pairState.totalWeight,
  };
}

function getMarketBias(opportunities) {
  const buyWeight = opportunities.reduce(
    (sum, opportunity) => sum + opportunity.buyWeight,
    0
  );
  const sellWeight = opportunities.reduce(
    (sum, opportunity) => sum + opportunity.sellWeight,
    0
  );

  if (buyWeight === sellWeight) {
    return "NEUTRAL";
  }

  return buyWeight > sellWeight ? "BUY" : "SELL";
}

function getLatestUpdate(opportunities) {
  return opportunities
    .map((opportunity) => new Date(opportunity.lastUpdated || 0).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((left, right) => right - left)
    .map((time) => new Date(time).toISOString())[0] || null;
}

function getConsensusSignals(pairState) {
  return pairState.activeSignals.filter((signal) => canAffectConsensus(signal));
}

function getPairFreshnessLevel(pairState) {
  const activeSignals = getConsensusSignals(pairState);

  if (activeSignals.length === 0) {
    return "STALE";
  }

  const strongestWeight = Math.max(
    ...activeSignals.map((signal) => Number(signal.freshnessWeight) || 0)
  );

  if (strongestWeight >= 1) return "VERY_FRESH";
  if (strongestWeight >= 0.8) return "FRESH";
  if (strongestWeight >= 0.5) return "AGING";
  if (strongestWeight > 0) return "WEAK";
  return "STALE";
}
