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
import { isExpiredTestSignal } from "./testSignalExpiry.js";
import { normalizeTradingPair } from "../parsers/pairDetector.js";
import { broadcastPairStateUpdate } from "./liveUpdateService.js";
import { logger } from "../utils/logger.js";

const signalExpirationAgeMinutes = Number(process.env.SIGNAL_EXPIRATION_MINUTES) || 60;

function debugLog(message) {
  logger.debug("pair_state.engine", {
    message: String(message),
  });
}

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
    debugLog("[CONSENSUS REFRESH]");
    debugLog(`${pairState.pair} recalculated`);
    return savePairState(pairState);
  });
}

export function cleanupExpiredSignals(options = {}) {
  const now = options.now || new Date();
  const expiredRetentionMinutes = Number(options.expiredRetentionMinutes) || 120;
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
      debugLog("[STALE CLEANUP]");
      debugLog(`Removed expired ${pairState.pair} signals: ${removedCount}`);
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

  const normalizedPair = normalizeTradingPair(signal.pair);
  signal.pair = normalizedPair;
  const pairState = getOrCreatePairState(normalizedPair);

  if (!pairState) {
    return null;
  }

  const previousDirection = pairState.marketDirection;

  if (isNewTradeSignal(signal)) {
    pairState.activeSignals.push(createStoredSignal(signal));
    debugLog("[LIVE UPDATE]");
    debugLog(`New ${signal.pair} signal processed`);
    if (isPrivateTestSignal(signal)) {
      debugLog("[LIVE TEST]");
      debugLog(`New ${signal.pair} signal processed from test channel`);
    }
  } else {
    applySignalStateUpdate(pairState, signal);
  }

  recalculatePairState(pairState, now);

  savePairState(pairState);
  logPairUpdate(pairState, previousDirection);
  broadcastPairStateUpdate(pairState);

  return pairState;
}

export function updateInMemorySignalState(pair, signalId, newState, now = new Date()) {
  const pairState = getStoredPairState(pair);
  if (!pairState) {
    return null;
  }

  // Find the target signal in activeSignals
  const targetSignal = pairState.activeSignals.find(
    (signal) => String(signal._id || "") === String(signalId)
  );

  if (!targetSignal) {
    return null;
  }

  if (targetSignal.signalState === newState) {
    return pairState;
  }

  const previousState = targetSignal.signalState;
  targetSignal.signalState = newState;

  debugLog("[OUTCOME SYNC STATE UPDATE]");
  debugLog(`${pair} signal ${signalId} state ${previousState} -> ${newState}`);

  recalculatePairState(pairState, now);
  savePairState(pairState);
  broadcastPairStateUpdate(pairState);

  return pairState;
}

export function updateInMemorySignalLifecycle(pair, signalId, effectiveStopLoss, remainingTargets, lifecycleStage, now = new Date()) {
  const pairState = getStoredPairState(pair);
  if (!pairState) {
    return null;
  }

  // Find the target signal in activeSignals
  const targetSignal = pairState.activeSignals.find(
    (signal) => String(signal._id || "") === String(signalId)
  );

  if (!targetSignal) {
    return null;
  }

  if (
    targetSignal.effectiveStopLoss === effectiveStopLoss &&
    JSON.stringify(targetSignal.remainingTargets) === JSON.stringify(remainingTargets) &&
    targetSignal.lifecycleStage === lifecycleStage
  ) {
    return pairState;
  }

  const prevSL = targetSignal.effectiveStopLoss;
  const prevStage = targetSignal.lifecycleStage;

  targetSignal.effectiveStopLoss = effectiveStopLoss;
  targetSignal.remainingTargets = remainingTargets;
  targetSignal.lifecycleStage = lifecycleStage;

  debugLog("[OUTCOME SYNC LIFECYCLE UPDATE]");
  debugLog(`${pair} signal ${signalId} SL ${prevSL} -> ${effectiveStopLoss}, stage ${prevStage} -> ${lifecycleStage}`);

  recalculatePairState(pairState, now);
  savePairState(pairState);
  broadcastPairStateUpdate(pairState);

  return pairState;
}



function isPrivateTestSignal(signal) {
  return String(signal?.channel || "").startsWith("private-test-channel:");
}

function isPairStateSignal(signal) {
  return signal?.pair && ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL", "CANCEL_SIGNAL"].includes(
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
    _id: signal._id || null,
    pair: signal.pair,
    action: signal.action,
    entry: signal.entry,
    entryRange: signal.entryRange || [],
    targets: signal.targets || [],
    stopLoss: signal.stopLoss,
    effectiveStopLoss: signal.effectiveStopLoss !== undefined ? signal.effectiveStopLoss : signal.stopLoss,
    remainingTargets: signal.remainingTargets !== undefined ? signal.remainingTargets : (signal.targets || []),
    lifecycleStage: signal.lifecycleStage !== undefined ? signal.lifecycleStage : 0,
    timestamp: signal.createdAt || signal.timestamp || null,
    sourceChannel: signal.channel || "unknown",
    sourceChannelTitle: signal.channelTitle || null,
    rawMessage: signal.rawText || "",
    signalState: signal.signalState || signal.signalStatus || "ACTIVE",
    isTestSignal: Boolean(signal.isTestSignal),
    possibleDuplicate: Boolean(signal.possibleDuplicate),
    expiresAt: signal.expiresAt || null,
  };
}

function recalculatePairState(pairState, now) {
  const previousZones = {
    buyZones: pairState.buyZones || createEmptyDirectionalZones(),
    sellZones: pairState.sellZones || createEmptyDirectionalZones(),
  };
  const previousConfidence = {
    buyConfidence: Number(pairState.buyConfidence) || 0,
    sellConfidence: Number(pairState.sellConfidence) || 0,
  };

  pairState.activeSignals = pairState.activeSignals.map((signal) =>
    refreshSignalFreshness(signal, now)
  );
  expireStaleSignals(pairState, now);
  const consensus = calculateWeightedConsensus(pairState.activeSignals);
  const zones = calculatePairZones(pairState.activeSignals);

  pairState.signalCount = pairState.activeSignals.filter((signal) =>
    canAffectConsensus(signal)
  ).length;
  pairState.buyWeight = consensus.buyWeight;
  pairState.sellWeight = consensus.sellWeight;
  pairState.totalWeight = consensus.totalWeight;
  
  // Calculate raw metrics
  pairState.buyRatio = pairState.totalWeight > 0 ? Number((pairState.buyWeight / pairState.totalWeight).toFixed(3)) : 0;
  pairState.sellRatio = pairState.totalWeight > 0 ? Number((pairState.sellWeight / pairState.totalWeight).toFixed(3)) : 0;
  
  const activeCountable = pairState.activeSignals.filter(canAffectConsensus);
  pairState.activeBuySignals = activeCountable.filter(s => s.action === "BUY").length;
  pairState.activeSellSignals = activeCountable.filter(s => s.action === "SELL").length;
  pairState.activeSignalsCount = pairState.activeBuySignals + pairState.activeSellSignals;
  pairState.channelCount = new Set(activeCountable.map(s => s.sourceChannel).filter(Boolean)).size;
  
  pairState.weightedFreshness = activeCountable.length > 0 ? Number((activeCountable.reduce((sum, s) => sum + Number(s.freshnessWeight || 0), 0) / activeCountable.length).toFixed(3)) : 0;
  pairState.averageConfidence = activeCountable.length > 0 ? Number((activeCountable.reduce((sum, s) => sum + Number(s.extractionConfidence || 0), 0) / activeCountable.length).toFixed(1)) : 0;
  pairState.averageSignalAge = activeCountable.length > 0 ? Number((activeCountable.reduce((sum, s) => sum + Number(s.ageMinutes || 0), 0) / activeCountable.length).toFixed(1)) : 0;

  pairState.marketDirection = consensus.marketDirection;
  pairState.confidenceScore = consensus.confidenceScore;
  pairState.buyConfidence = consensus.buyConfidence;
  pairState.sellConfidence = consensus.sellConfidence;
  pairState.buyZones = zones.buyZones;
  pairState.sellZones = zones.sellZones;
  const primaryZones = getPrimaryDirectionalZones(pairState.buyWeight, pairState.sellWeight, zones);
  pairState.entryZone = primaryZones.entryZone;
  pairState.tpZone = primaryZones.tpZone;
  pairState.slZone = primaryZones.slZone;

  const contributingSignals = pairState.activeSignals.filter((signal) =>
    canAffectConsensus(signal)
  );
  if (contributingSignals.length > 0) {
    const newestSignal = contributingSignals.reduce((newest, current) => {
      const currentVal = getSignalTime(current);
      const newestVal = getSignalTime(newest);
      return currentVal > newestVal ? current : newest;
    }, contributingSignals[0]);
    pairState.lastUpdated = newestSignal.timestamp;
  } else {
    pairState.lastUpdated = null;
  }

  logZoneUpdates(pairState, previousZones);
  logConfidenceUpdates(pairState, previousConfidence);
  logConsensusUpdate(pairState);
}

function calculatePairZones(signals) {
  const consensusSignals = signals.filter((signal) => canAffectConsensus(signal));
  const buySignals = consensusSignals.filter((signal) => signal.action === "BUY");
  const sellSignals = consensusSignals.filter((signal) => signal.action === "SELL");

  return {
    buyZones: buildDirectionalZones(buySignals),
    sellZones: buildDirectionalZones(sellSignals),
  };
}

function buildDirectionalZones(signals) {
  return {
    entryZone: buildZone(signals.flatMap(getEntryValues)),
    tpZone: buildZone(
      signals.flatMap(
        (signal) =>
          signal.remainingTargets !== undefined
            ? signal.remainingTargets
            : (signal.targets || [])
      )
    ),
    slZone: buildZone(
      signals.map(
        (signal) =>
          signal.effectiveStopLoss !== undefined && signal.effectiveStopLoss !== null
            ? signal.effectiveStopLoss
            : signal.stopLoss
      )
    ),
  };
}

function getPrimaryDirectionalZones(buyWeight, sellWeight, zones) {
  if (buyWeight > sellWeight) {
    return zones.buyZones;
  }

  if (sellWeight > buyWeight) {
    return zones.sellZones;
  }

  return createEmptyDirectionalZones();
}

function createEmptyDirectionalZones() {
  return {
    entryZone: null,
    tpZone: null,
    slZone: null,
  };
}

function getEntryValues(signal) {
  if (Array.isArray(signal.entryRange) && signal.entryRange.length > 0) {
    return signal.entryRange;
  }

  return [signal.entry];
}

function buildZone(values) {
  const numericValues = values
    .filter((value) => value !== null && value !== undefined && value !== "")
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
    debugLog("[STATE UPDATE]");
    debugLog(`${targetSignal.pair} ${previousState} -> ${transition}`);
  }

  if (transition === "CLOSED") {
    debugLog("[SIGNAL CLOSED]");
    debugLog(`${targetSignal.pair} trade closed`);
  }
}

function findLatestMatchingLiveSignal(signals, updateSignal) {
  return signals
    .filter((signal) => canAffectConsensus(signal))
    .filter((signal) => !updateSignal.action || signal.action === updateSignal.action)
    .sort((left, right) => getSignalTime(right) - getSignalTime(left))[0] || null;
}

function expireStaleSignals(pairState, now) {
  for (const signal of pairState.activeSignals) {
    if (!shouldExpireSignal(signal, signalExpirationAgeMinutes, now)) {
      continue;
    }

    signal.signalState = "EXPIRED";
    logTestSignalExpired(signal, now);
    debugLog("[SIGNAL EXPIRED]");
    debugLog(`${signal.pair} signal removed from active consensus`);
  }
}

function logTestSignalExpired(signal, now) {
  if (!isExpiredTestSignal(signal, now) || signal.testSignalExpirationLogged) {
    return;
  }

  signal.testSignalExpirationLogged = true;
  logger.info("[TEST_SIGNAL_EXPIRED]", {
    pair: signal.pair,
    action: signal.action,
    sourceChannel: signal.sourceChannel,
    sourceChannelTitle: signal.sourceChannelTitle,
    expiresAt: signal.expiresAt,
  });
}

function logPairUpdate(pairState, previousDirection) {
  debugLog("[PAIR UPDATE]");
  debugLog(`${pairState.pair} signals: ${pairState.signalCount}`);
  debugLog("[PAIR STATE UPDATED]");
  debugLog(`${pairState.pair} ACTIVE signals: ${pairState.signalCount}`);

  if (previousDirection !== pairState.marketDirection) {
    debugLog("[PAIR UPDATE]");
    debugLog(`${pairState.pair} direction changed to ${pairState.marketDirection}`);
  }
}

function refreshSignalFreshness(signal, now) {
  const previousLevel = signal.freshnessLevel;
  const freshness = calculateSignalFreshness(signal, now);

  signal.ageMinutes = freshness.ageMinutes;
  signal.freshnessWeight = freshness.freshnessWeight;
  signal.freshnessLevel = freshness.freshnessLevel;

  debugLog("[FRESHNESS UPDATE]");
  debugLog(`${signal.pair} signal age: ${signal.ageMinutes} min`);
  debugLog(`weight: ${signal.freshnessWeight}`);

  if (previousLevel !== "STALE" && signal.freshnessLevel === "STALE") {
    debugLog("[SIGNAL STALE]");
    debugLog(`${signal.pair} signal expired influence`);
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

  debugLog("[CONSENSUS UPDATE]");
  debugLog(pairState.pair);
  debugLog(`BUY: ${buyPercent}`);
  debugLog(`SELL: ${sellPercent}`);
  debugLog(`Direction: ${pairState.marketDirection}`);
  debugLog("[CONSENSUS UPDATED]");
  debugLog(`BUY ${buyPercent}%`);
  debugLog(`SELL ${sellPercent}%`);
}

function logConfidenceUpdates(pairState, previousConfidence) {
  logConfidenceUpdate(
    pairState.pair,
    "BUY",
    previousConfidence.buyConfidence,
    pairState.buyConfidence
  );
  logConfidenceUpdate(
    pairState.pair,
    "SELL",
    previousConfidence.sellConfidence,
    pairState.sellConfidence
  );
}

function logConfidenceUpdate(pair, direction, previousConfidence, nextConfidence) {
  if (previousConfidence === nextConfidence) {
    return;
  }

  if (nextConfidence < previousConfidence) {
    debugLog("[CONFIDENCE DECAY]");
    debugLog(`${pair} ${direction} confidence dropped to ${nextConfidence}%`);
    return;
  }

  debugLog("[CONFIDENCE UPDATE]");
  debugLog(`${pair} ${direction} confidence: ${nextConfidence}%`);
}

function logZoneUpdates(pairState, previousZones) {
  logDirectionalZoneUpdates(pairState.pair, "BUY", previousZones.buyZones, pairState.buyZones);
  logDirectionalZoneUpdates(pairState.pair, "SELL", previousZones.sellZones, pairState.sellZones);
}

function logDirectionalZoneUpdates(pair, direction, previousZones, nextZones) {
  logZoneUpdate(pair, direction, "Entry", previousZones?.entryZone, nextZones?.entryZone);
  logZoneUpdate(pair, direction, "TP", previousZones?.tpZone, nextZones?.tpZone);
  logZoneUpdate(pair, direction, "SL", previousZones?.slZone, nextZones?.slZone);
}

function logZoneUpdate(pair, direction, label, previousZone, nextZone) {
  if (zonesAreEqual(previousZone, nextZone)) {
    return;
  }

  debugLog(`[${direction} ZONE UPDATE]`);
  debugLog(`${pair} ${direction} ${label}: ${formatZone(nextZone)}`);
}

function zonesAreEqual(left, right) {
  if (!left && !right) {
    return true;
  }

  return left?.min === right?.min && left?.max === right?.max;
}

function formatZone(zone) {
  if (!zone) {
    return "none";
  }

  return `${zone.min}-${zone.max}`;
}

function shouldKeepSignal(signal, cutoffTime) {
  if (canAffectConsensus(signal)) {
    return true;
  }

  return getSignalTime(signal) >= cutoffTime;
}
