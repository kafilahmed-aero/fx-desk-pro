import {
  getOrCreatePairState,
  getPairState as getStoredPairState,
  getPairStates as getStoredPairStates,
  resetPairStateStore,
  savePairState,
} from "./pairStateStore.js";
import { calculateSignalFreshness } from "./freshnessEngine.js";
import { calculateWeightedConsensus } from "./weightedConsensusEngine.js";
import {
  canAffectConsensus,
  getSignalStateTransition,
  shouldExpireSignal,
} from "./signalStateEngine.js";

const signalExpirationAgeMinutes = Number(process.env.SIGNAL_EXPIRATION_MINUTES) || 60;

export { resetPairStateStore };

export function getPairState(pair, now = new Date()) {
  const pairState = getStoredPairState(pair);

  if (!pairState) {
    return null;
  }

  recalculatePairState(pairState, now);
  return savePairState(pairState);
}

export function getPairStates(now = new Date()) {
  return refreshAllPairStates(now);
}

export function refreshAllPairStates(now = new Date()) {
  return getStoredPairStates().map((pairState) => {
    recalculatePairState(pairState, now);
    console.log("[CONSENSUS REFRESH]");
    console.log(`${pairState.pair} recalculated`);
    return savePairState(pairState);
  });
}

export function cleanupExpiredSignals(options = {}) {
  const now = options.now || new Date();
  const expiredRetentionMinutes = Number(options.expiredRetentionMinutes) || 180;
  const maxSignalsPerPair = Number(options.maxSignalsPerPair) || 250;
  const cutoffTime = now.getTime() - expiredRetentionMinutes * 60000;
  const cleanupResults = [];

  for (const pairState of getStoredPairStates()) {
    const beforeCount = pairState.activeSignals.length;
    pairState.activeSignals = pairState.activeSignals
      .filter((signal) => shouldKeepSignal(signal, cutoffTime))
      .sort((left, right) => getSignalTime(right) - getSignalTime(left))
      .slice(0, maxSignalsPerPair);

    recalculatePairState(pairState, now);
    savePairState(pairState);

    const removedCount = beforeCount - pairState.activeSignals.length;
    if (removedCount > 0) {
      console.log("[STALE CLEANUP]");
      console.log(`Removed expired ${pairState.pair} signals: ${removedCount}`);
    }

    cleanupResults.push({
      pair: pairState.pair,
      removedCount,
      remainingSignals: pairState.activeSignals.length,
    });
  }

  return cleanupResults;
}

export function updatePairStateFromSignal(signal, now = new Date()) {
  if (!isPairStateSignal(signal)) {
    return null;
  }

  const pairState = getOrCreatePairState(signal.pair);
  const previousDirection = pairState.marketDirection;

  if (isNewTradeSignal(signal)) {
    pairState.activeSignals.push(createStoredSignal(signal));
    console.log("[LIVE UPDATE]");
    console.log(`New ${signal.pair} signal processed`);
  } else {
    applySignalStateUpdate(pairState, signal);
  }

  recalculatePairState(pairState, now);

  savePairState(pairState);
  logPairUpdate(pairState, previousDirection);

  return pairState;
}

function isPairStateSignal(signal) {
  return signal?.pair && ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(
    signal.parserClassification || signal.classification
  );
}

function isNewTradeSignal(signal) {
  return (
    signal?.pair &&
    ["BUY", "SELL"].includes(signal.action) &&
    (signal.parserClassification || signal.classification) === "NEW_SIGNAL"
  );
}

function createStoredSignal(signal) {
  return {
    pair: signal.pair,
    action: signal.action,
    entry: signal.entry,
    entryRange: signal.entryRange || [],
    targets: signal.targets || [],
    stopLoss: signal.stopLoss,
    timestamp: signal.createdAt || signal.timestamp || null,
    sourceChannel: signal.channel || "unknown",
    rawMessage: signal.rawText || "",
    signalState: signal.signalState || signal.signalStatus || "ACTIVE",
  };
}

function recalculatePairState(pairState, now) {
  pairState.activeSignals = pairState.activeSignals.map((signal) =>
    refreshSignalFreshness(signal, now)
  );
  expireStaleSignals(pairState);
  const consensus = calculateWeightedConsensus(pairState.activeSignals);

  pairState.signalCount = pairState.activeSignals.filter((signal) =>
    canAffectConsensus(signal)
  ).length;
  pairState.buyWeight = consensus.buyWeight;
  pairState.sellWeight = consensus.sellWeight;
  pairState.totalWeight = consensus.totalWeight;
  pairState.marketDirection = consensus.marketDirection;
  pairState.confidenceScore = consensus.confidenceScore;
  pairState.lastUpdated = new Date().toISOString();

  logConsensusUpdate(pairState);
}

function applySignalStateUpdate(pairState, updateSignal) {
  const transition = getSignalStateTransition(updateSignal);

  if (!transition) {
    return;
  }

  const targetSignal = findLatestMatchingLiveSignal(pairState.activeSignals, updateSignal);

  if (!targetSignal) {
    return;
  }

  const previousState = targetSignal.signalState;
  targetSignal.signalState = transition;

  if (previousState !== transition) {
    console.log("[STATE UPDATE]");
    console.log(`${targetSignal.pair} ${previousState} -> ${transition}`);
  }

  if (transition === "CLOSED") {
    console.log("[SIGNAL CLOSED]");
    console.log(`${targetSignal.pair} trade closed`);
  }
}

function findLatestMatchingLiveSignal(signals, updateSignal) {
  return signals
    .filter((signal) => canAffectConsensus(signal))
    .filter((signal) => !updateSignal.action || signal.action === updateSignal.action)
    .sort((left, right) => getSignalTime(right) - getSignalTime(left))[0] || null;
}

function expireStaleSignals(pairState) {
  for (const signal of pairState.activeSignals) {
    if (!shouldExpireSignal(signal, signalExpirationAgeMinutes)) {
      continue;
    }

    signal.signalState = "EXPIRED";
    console.log("[SIGNAL EXPIRED]");
    console.log(`${signal.pair} signal removed from active consensus`);
  }
}

function logPairUpdate(pairState, previousDirection) {
  console.log("[PAIR UPDATE]");
  console.log(`${pairState.pair} signals: ${pairState.signalCount}`);

  if (previousDirection !== pairState.marketDirection) {
    console.log("[PAIR UPDATE]");
    console.log(`${pairState.pair} direction changed to ${pairState.marketDirection}`);
  }
}

function refreshSignalFreshness(signal, now) {
  const previousLevel = signal.freshnessLevel;
  const freshness = calculateSignalFreshness(signal, now);

  signal.ageMinutes = freshness.ageMinutes;
  signal.freshnessWeight = freshness.freshnessWeight;
  signal.freshnessLevel = freshness.freshnessLevel;

  console.log("[FRESHNESS UPDATE]");
  console.log(`${signal.pair} signal age: ${signal.ageMinutes} min`);
  console.log(`weight: ${signal.freshnessWeight}`);

  if (previousLevel !== "STALE" && signal.freshnessLevel === "STALE") {
    console.log("[SIGNAL STALE]");
    console.log(`${signal.pair} signal expired influence`);
  }

  return signal;
}

function getSignalTime(signal) {
  const parsed = new Date(signal.timestamp || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function logConsensusUpdate(pairState) {
  const buyPercent =
    pairState.totalWeight > 0
      ? Math.round((pairState.buyWeight / pairState.totalWeight) * 100)
      : 0;
  const sellPercent =
    pairState.totalWeight > 0
      ? Math.round((pairState.sellWeight / pairState.totalWeight) * 100)
      : 0;

  console.log("[CONSENSUS UPDATE]");
  console.log(pairState.pair);
  console.log(`BUY: ${buyPercent}`);
  console.log(`SELL: ${sellPercent}`);
  console.log(`Direction: ${pairState.marketDirection}`);
}

function shouldKeepSignal(signal, cutoffTime) {
  if (canAffectConsensus(signal)) {
    return true;
  }

  return getSignalTime(signal) >= cutoffTime;
}
