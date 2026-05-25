import { getPairStates } from "./pairStateEngine.js";
import { canAffectConsensus } from "./signalStateEngine.js";

export function getActivePairStates() {
  return getPairStates().map((pairState) => ({
    pair: pairState.pair,
    activeSignals: pairState.activeSignals,
    signalCount: pairState.signalCount,
    marketDirection: pairState.marketDirection,
    confidenceScore: pairState.confidenceScore,
    buyWeight: pairState.buyWeight,
    sellWeight: pairState.sellWeight,
    totalWeight: pairState.totalWeight,
    freshnessLevel: getPairFreshnessLevel(pairState),
    lastUpdated: pairState.lastUpdated,
  }));
}

export function getLiveConsensus() {
  return getActivePairStates().map((pairState) => ({
    pair: pairState.pair,
    buyWeight: pairState.buyWeight,
    sellWeight: pairState.sellWeight,
    totalWeight: pairState.totalWeight,
    marketDirection: pairState.marketDirection,
    confidenceScore: pairState.confidenceScore,
    signalCount: pairState.signalCount,
    lastUpdated: pairState.lastUpdated,
  }));
}

export function getActiveOpportunities() {
  return getActivePairStates()
    .filter((pairState) => pairState.signalCount > 0)
    .filter((pairState) => pairState.totalWeight > 0)
    .filter((pairState) => pairState.freshnessLevel !== "STALE")
    .map((pairState) => {
      const activeSignals = getConsensusSignals(pairState);

      return {
        pair: pairState.pair,
        marketDirection: pairState.marketDirection,
        confidenceScore: pairState.confidenceScore,
        buyWeight: pairState.buyWeight,
        sellWeight: pairState.sellWeight,
        totalWeight: pairState.totalWeight,
        signalCount: pairState.signalCount,
        freshnessLevel: pairState.freshnessLevel,
        lastUpdated: pairState.lastUpdated,
        entryZone: buildZone(activeSignals.flatMap(getEntryValues)),
        tpZone: buildZone(activeSignals.flatMap((signal) => signal.targets || [])),
        slZone: buildZone(activeSignals.map((signal) => signal.stopLoss)),
      };
    })
    .sort(
      (left, right) =>
        right.confidenceScore - left.confidenceScore ||
        right.totalWeight - left.totalWeight ||
        left.pair.localeCompare(right.pair)
    );
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

function getEntryValues(signal) {
  if (Array.isArray(signal.entryRange) && signal.entryRange.length > 0) {
    return signal.entryRange;
  }

  return [signal.entry];
}

function buildZone(values) {
  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (numericValues.length === 0) {
    return null;
  }

  return {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues),
  };
}
