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
    .filter((pairState) => pairState && pairState.activeSignalsCount > 0)
    .map((pairState) => ({
      ...pairState,
      freshnessLevel: getPairFreshnessLevel(pairState),
    }));
}

function formatPairIntelligence(pairState) {
  return {
    pair: pairState.pair,
    marketDirection: pairState.marketDirection || "NEUTRAL",
    confidenceScore: pairState.confidenceScore || 0,
    buyConfidence: pairState.buyConfidence || 0,
    sellConfidence: pairState.sellConfidence || 0,
    buyWeight: pairState.buyWeight || 0,
    sellWeight: pairState.sellWeight || 0,
    signalCount: pairState.activeSignalsCount || 0,
    buySignalsCount: pairState.activeBuySignals || 0,
    sellSignalsCount: pairState.activeSellSignals || 0,
    channelCount: pairState.channelCount || 0,
    freshnessLevel: pairState.freshnessLevel,
    buyZones: pairState.buyZones,
    sellZones: pairState.sellZones,
    entryZone: pairState.entryZone,
    tpZone: pairState.tpZone,
    slZone: pairState.slZone,
    lastUpdated: pairState.lastUpdated,
    totalWeight: pairState.totalWeight || 0,
    // Expose raw state metrics
    buyRatio: pairState.buyRatio || 0,
    sellRatio: pairState.sellRatio || 0,
    activeBuySignals: pairState.activeBuySignals || 0,
    activeSellSignals: pairState.activeSellSignals || 0,
    activeSignalsCount: pairState.activeSignalsCount || 0,
    weightedFreshness: pairState.weightedFreshness || 0,
    averageConfidence: pairState.averageConfidence || 0,
    averageSignalAge: pairState.averageSignalAge || 0,
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

function getPairFreshnessLevel(pairState) {
  const freshness = pairState.weightedFreshness || 0;
  if (freshness >= 1) return "VERY_FRESH";
  if (freshness >= 0.8) return "FRESH";
  if (freshness >= 0.5) return "AGING";
  if (freshness > 0) return "WEAK";
  return "STALE";
}
