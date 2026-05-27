import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { canAffectConsensus } from "./signalStateEngine.js";

export const smartAlertTypes = {
  RAPID_CONFIDENCE_RISE: "RAPID_CONFIDENCE_RISE",
  STRONG_CONSENSUS: "STRONG_CONSENSUS",
  CONSENSUS_FLIP: "CONSENSUS_FLIP",
};

const cooldowns = new Map();
const confidenceHistory = new Map();

export function evaluateSmartAlerts(pairState, previousPairState = null, now = new Date()) {
  try {
    if (!pairState?.pair) {
      return [];
    }

    const snapshot = createAlertSnapshot(pairState);
    rememberConfidence(snapshot, now);

    const alertCandidates = [
      createStrongConsensusAlert(snapshot),
      createRapidConfidenceRiseAlert(snapshot, now),
      createConsensusFlipAlert(snapshot, previousPairState),
    ].filter(Boolean);

    return alertCandidates.filter((alert) => canNotify(alert, now));
  } catch (error) {
    logger.warn("smart_alert.evaluate_failed", {
      pair: pairState?.pair,
      error: error.message,
    });
    return [];
  }
}

function createAlertSnapshot(pairState) {
  const direction = normalizeDirection(pairState.marketDirection);
  const confidence = getDirectionalConfidence(pairState, direction);
  const activeSignals = Number(pairState.signalCount) || 0;
  const freshnessLevel = getPairFreshnessLevel(pairState);

  return {
    pair: pairState.pair,
    direction,
    marketDirection: pairState.marketDirection || "NEUTRAL",
    confidence,
    activeSignals,
    freshnessLevel,
  };
}

function createStrongConsensusAlert(snapshot) {
  if (
    snapshot.direction === "NEUTRAL" ||
    snapshot.confidence < config.smartAlerts.strongConsensusConfidence ||
    snapshot.activeSignals < config.smartAlerts.strongConsensusSignalCount ||
    !isHighFreshness(snapshot.freshnessLevel)
  ) {
    return null;
  }

  return buildAlert(smartAlertTypes.STRONG_CONSENSUS, snapshot, {
    title: `${snapshot.pair} Strong ${snapshot.direction} Consensus`,
    body: `Confidence: ${snapshot.confidence}%\nFresh momentum detected.`,
  });
}

function createRapidConfidenceRiseAlert(snapshot, now) {
  if (snapshot.direction === "NEUTRAL") {
    return null;
  }

  const history = getRecentConfidenceHistory(snapshot, now);
  const previousLow = Math.min(
    ...history
      .filter((point) => point.timestamp < now.getTime())
      .map((point) => point.confidence)
  );

  if (
    !Number.isFinite(previousLow) ||
    snapshot.confidence - previousLow < config.smartAlerts.rapidRiseThreshold
  ) {
    return null;
  }

  return buildAlert(smartAlertTypes.RAPID_CONFIDENCE_RISE, snapshot, {
    title: `${snapshot.pair} Rapid ${snapshot.direction} Confidence Rise`,
    body: `Confidence: ${snapshot.confidence}%\nMomentum increased quickly.`,
  });
}

function createConsensusFlipAlert(snapshot, previousPairState) {
  const previousDirection = normalizeDirection(previousPairState?.marketDirection);

  if (
    snapshot.direction === "NEUTRAL" ||
    previousDirection === "NEUTRAL" ||
    previousDirection === snapshot.direction
  ) {
    return null;
  }

  return buildAlert(smartAlertTypes.CONSENSUS_FLIP, snapshot, {
    title: `${snapshot.pair} Consensus Flip: ${previousDirection} to ${snapshot.direction}`,
    body: `Confidence: ${snapshot.confidence}%\nMarket direction changed.`,
  });
}

function buildAlert(type, snapshot, message) {
  return {
    id: `${snapshot.pair}:${type}:${Date.now()}`,
    type,
    pair: snapshot.pair,
    direction: snapshot.direction,
    confidence: snapshot.confidence,
    activeSignals: snapshot.activeSignals,
    freshnessLevel: snapshot.freshnessLevel,
    title: message.title,
    body: message.body,
    timestamp: new Date().toISOString(),
  };
}

function canNotify(alert, now) {
  const key = `${alert.pair}:${alert.type}`;
  const previousNotificationAt = cooldowns.get(key) || 0;

  if (now.getTime() - previousNotificationAt < config.smartAlerts.cooldownMs) {
    return false;
  }

  cooldowns.set(key, now.getTime());
  logger.info("[ALERT_TRIGGERED]", {
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    alertType: alert.type,
  });
  return true;
}

function rememberConfidence(snapshot, now) {
  if (snapshot.direction === "NEUTRAL") {
    return;
  }

  const key = `${snapshot.pair}:${snapshot.direction}`;
  const cutoff = now.getTime() - config.smartAlerts.rapidRiseWindowMs;
  const history = (confidenceHistory.get(key) || []).filter(
    (point) => point.timestamp >= cutoff
  );

  history.push({
    timestamp: now.getTime(),
    confidence: snapshot.confidence,
  });
  confidenceHistory.set(key, history);
}

function getRecentConfidenceHistory(snapshot, now) {
  const key = `${snapshot.pair}:${snapshot.direction}`;
  const cutoff = now.getTime() - config.smartAlerts.rapidRiseWindowMs;
  return (confidenceHistory.get(key) || []).filter((point) => point.timestamp >= cutoff);
}

function getDirectionalConfidence(pairState, direction) {
  if (direction === "BUY") {
    return Number(pairState.buyConfidence) || 0;
  }

  if (direction === "SELL") {
    return Number(pairState.sellConfidence) || 0;
  }

  return Number(pairState.confidenceScore) || 0;
}

function normalizeDirection(direction) {
  const value = String(direction || "").toUpperCase();

  if (value.includes("BUY")) {
    return "BUY";
  }

  if (value.includes("SELL")) {
    return "SELL";
  }

  return "NEUTRAL";
}

function getPairFreshnessLevel(pairState) {
  const activeSignals = (pairState.activeSignals || []).filter((signal) =>
    canAffectConsensus(signal)
  );

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

function isHighFreshness(freshnessLevel) {
  return ["HIGH", "VERY_FRESH", "FRESH"].includes(freshnessLevel);
}
