import { normalizeTradingPair } from "../parsers/pairDetector.js";
import { logger } from "../utils/logger.js";

const pairStates = new Map();

export function getOrCreatePairState(pair) {
  const normalizedPair = normalizeTradingPair(pair);

  if (!normalizedPair) {
    return null;
  }

  if (!pairStates.has(normalizedPair)) {
    pairStates.set(normalizedPair, {
      pair: normalizedPair,
      activeSignals: [],
      signalCount: 0,
      buyWeight: 0,
      sellWeight: 0,
      totalWeight: 0,
      marketDirection: "NEUTRAL",
      confidenceScore: 0,
      buyConfidence: 0,
      sellConfidence: 0,
      entryZone: null,
      tpZone: null,
      slZone: null,
      buyZones: createEmptyDirectionalZones(),
      sellZones: createEmptyDirectionalZones(),
      lastUpdated: null,
    });

    logger.debug("pair_state.created", {
      pair: normalizedPair,
    });
  }

  return pairStates.get(normalizedPair);
}

export function savePairState(pairState) {
  const normalizedPair = normalizeTradingPair(pairState?.pair);

  if (!normalizedPair) {
    return pairState;
  }

  pairState.pair = normalizedPair;
  pairStates.set(normalizedPair, pairState);
  return pairState;
}

export function getPairState(pair) {
  const normalizedPair = normalizeTradingPair(pair);
  return pairStates.get(normalizedPair) || null;
}

export function getPairStates() {
  return [...pairStates.values()].sort((left, right) =>
    left.pair.localeCompare(right.pair)
  );
}

export function resetPairStateStore() {
  pairStates.clear();
}

function createEmptyDirectionalZones() {
  return {
    entryZone: null,
    tpZone: null,
    slZone: null,
  };
}
