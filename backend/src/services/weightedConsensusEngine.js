import { canAffectConsensus } from "./signalStateEngine.js";

export function calculateWeightedConsensus(activeSignals = []) {
  const consensusSignals = activeSignals.filter((signal) => canAffectConsensus(signal));
  const buyWeight = sumSignalWeights(consensusSignals, "BUY");
  const sellWeight = sumSignalWeights(consensusSignals, "SELL");
  const totalWeight = buyWeight + sellWeight;
  const confidenceScore = calculateConfidenceScore(buyWeight, sellWeight, totalWeight);

  return {
    buyWeight: roundWeight(buyWeight),
    sellWeight: roundWeight(sellWeight),
    totalWeight: roundWeight(totalWeight),
    marketDirection: calculateMarketDirection(buyWeight, sellWeight, totalWeight),
    confidenceScore,
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

function calculateConfidenceScore(buyWeight, sellWeight, totalWeight) {
  if (totalWeight === 0) {
    return 0;
  }

  return Math.round((Math.max(buyWeight, sellWeight) / totalWeight) * 100);
}

function calculateMarketDirection(buyWeight, sellWeight, totalWeight) {
  if (totalWeight === 0 || buyWeight === sellWeight) {
    return "NEUTRAL";
  }

  const majorityAction = buyWeight > sellWeight ? "BUY" : "SELL";
  const majorityRatio = Math.max(buyWeight, sellWeight) / totalWeight;

  if (majorityRatio <= 0.55) {
    return "NEUTRAL";
  }

  if (majorityRatio >= 0.7) {
    return `STRONG_${majorityAction}`;
  }

  return majorityAction;
}

function roundWeight(value) {
  return Number(value.toFixed(2));
}
