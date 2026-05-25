const pairStates = new Map();

export function getOrCreatePairState(pair) {
  if (!pairStates.has(pair)) {
    pairStates.set(pair, {
      pair,
      activeSignals: [],
      signalCount: 0,
      buyWeight: 0,
      sellWeight: 0,
      totalWeight: 0,
      marketDirection: "NEUTRAL",
      confidenceScore: 0,
      lastUpdated: null,
    });
  }

  return pairStates.get(pair);
}

export function savePairState(pairState) {
  pairStates.set(pairState.pair, pairState);
  return pairState;
}

export function getPairState(pair) {
  return pairStates.get(pair) || null;
}

export function getPairStates() {
  return [...pairStates.values()].sort((left, right) =>
    left.pair.localeCompare(right.pair)
  );
}

export function resetPairStateStore() {
  pairStates.clear();
}
