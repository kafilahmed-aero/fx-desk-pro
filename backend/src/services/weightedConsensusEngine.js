import { canAffectConsensus } from "./signalStateEngine.js";

export function calculateWeightedConsensus(activeSignals = []) {
  const consensusSignals = activeSignals.filter((signal) => canAffectConsensus(signal));
  const buyWeight = sumSignalWeights(consensusSignals, "BUY");
  const sellWeight = sumSignalWeights(consensusSignals, "SELL");
  const totalWeight = buyWeight + sellWeight;
  const buyConfidence = calculateDirectionalConfidence(consensusSignals, "BUY");
  const sellConfidence = calculateDirectionalConfidence(consensusSignals, "SELL");

  return {
    buyWeight: roundWeight(buyWeight),
    sellWeight: roundWeight(sellWeight),
    totalWeight: roundWeight(totalWeight),
    marketDirection: "NEUTRAL",
    confidenceScore: Math.max(buyConfidence, sellConfidence),
    buyConfidence,
    sellConfidence,
  };
}

function sumSignalWeights(signals, action) {
  return signals
    .filter((signal) => signal.action === action)
    .reduce((sum, signal) => sum + getSignalWeight(signal), 0);
}

function getSignalWeight(signal) {
  const weight = Number(signal.freshnessWeight);
  return Number.isFinite(weight) ? weight : 0;
}

function calculateDirectionalConfidence(signals, action) {
  const directionalSignals = signals.filter((signal) => signal.action === action);

  if (directionalSignals.length === 0) {
    return 0;
  }

  const averageFreshness = average(
    directionalSignals.map((signal) => getSignalFreshnessConfidence(signal))
  );
  const activityMultiplier = getActivityMultiplier(directionalSignals.length);
  const recentActivityBoost = getRecentActivityBoost(directionalSignals);

  return Math.round(Math.min(100, averageFreshness * activityMultiplier + recentActivityBoost));
}

function getSignalFreshnessConfidence(signal) {
  const freshnessWeight = getSignalWeight(signal);
  const ageMinutes = Number(signal.ageMinutes);

  if (!Number.isFinite(ageMinutes)) {
    return freshnessWeight * 100;
  }

  const recencyCurve = Math.exp((-Math.log(2) * ageMinutes) / 44);
  return Math.max(freshnessWeight, recencyCurve) * 100;
}

function getActivityMultiplier(signalCount) {
  if (signalCount >= 4) return 1.12;
  if (signalCount >= 3) return 1.08;
  if (signalCount >= 2) return 1.04;
  return 1;
}

function getRecentActivityBoost(signals) {
  const veryRecentCount = signals.filter((signal) => Number(signal.ageMinutes) <= 5).length;
  return Math.min(8, Math.max(0, veryRecentCount - 1) * 4);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundWeight(value) {
  return Number(value.toFixed(2));
}
