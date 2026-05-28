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
const smartAlertDebugPrefix = "[SMART_ALERT_DEBUG]";

export function evaluateSmartAlerts(pairState, previousPairState = null, now = new Date()) {
  try {
    if (!pairState?.pair) {
      logger.info(smartAlertDebugPrefix, {
        stage: "alert condition evaluated",
        passed: false,
        reason: "missing pair state pair",
      });
      return [];
    }

    const snapshot = createAlertSnapshot(pairState);
    rememberConfidence(snapshot, now);

    const alertCandidates = [
      createStrongConsensusAlert(snapshot),
      createRapidConfidenceRiseAlert(snapshot, now),
      createConsensusFlipAlert(snapshot, previousPairState),
    ].filter(Boolean);

    const alerts = alertCandidates.filter((alert) => canNotify(alert, now));
    logger.info(smartAlertDebugPrefix, {
      stage: "alert condition evaluated",
      pair: snapshot.pair,
      candidateCount: alertCandidates.length,
      emittedCount: alerts.length,
    });
    return alerts;
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
  const failedReason =
    snapshot.direction === "NEUTRAL"
      ? "neutral direction"
      : snapshot.confidence < config.smartAlerts.strongConsensusConfidence
      ? "confidence below strong consensus threshold"
      : snapshot.activeSignals < config.smartAlerts.strongConsensusSignalCount
      ? "active signal count below strong consensus threshold"
      : !isHighFreshness(snapshot.freshnessLevel)
      ? "freshness below strong consensus threshold"
      : null;

  logConditionEvaluation(smartAlertTypes.STRONG_CONSENSUS, snapshot, !failedReason, failedReason);

  if (failedReason) {
    return null;
  }

  return buildAlert(smartAlertTypes.STRONG_CONSENSUS, snapshot, {
    title: `${snapshot.pair} Strong ${snapshot.direction} Consensus`,
    body: `Confidence: ${snapshot.confidence}%\nFresh momentum detected.`,
  });
}

function createRapidConfidenceRiseAlert(snapshot, now) {
  if (snapshot.direction === "NEUTRAL") {
    logConditionEvaluation(
      smartAlertTypes.RAPID_CONFIDENCE_RISE,
      snapshot,
      false,
      "neutral direction"
    );
    return null;
  }

  const history = getRecentConfidenceHistory(snapshot, now);
  const previousLow = Math.min(
    ...history
      .filter((point) => point.timestamp < now.getTime())
      .map((point) => point.confidence)
  );
  const confidenceDelta = Number.isFinite(previousLow)
    ? snapshot.confidence - previousLow
    : null;

  if (
    !Number.isFinite(previousLow) ||
    confidenceDelta < config.smartAlerts.rapidRiseThreshold
  ) {
    logConditionEvaluation(smartAlertTypes.RAPID_CONFIDENCE_RISE, snapshot, false, {
      reason: "confidence rise below rapid rise threshold",
      previousLow: Number.isFinite(previousLow) ? previousLow : null,
      confidenceDelta,
      threshold: config.smartAlerts.rapidRiseThreshold,
    });
    return null;
  }

  logConditionEvaluation(smartAlertTypes.RAPID_CONFIDENCE_RISE, snapshot, true, {
    previousLow,
    confidenceDelta,
    threshold: config.smartAlerts.rapidRiseThreshold,
  });

  return buildAlert(smartAlertTypes.RAPID_CONFIDENCE_RISE, snapshot, {
    title: `${snapshot.pair} Rapid ${snapshot.direction} Confidence Rise`,
    body: `Confidence: ${snapshot.confidence}%\nMomentum increased quickly.`,
  });
}

function createConsensusFlipAlert(snapshot, previousPairState) {
  const previousDirection = normalizeDirection(previousPairState?.marketDirection);
  const failedReason =
    snapshot.direction === "NEUTRAL"
      ? "neutral direction"
      : previousDirection === "NEUTRAL"
      ? "previous direction neutral or missing"
      : previousDirection === snapshot.direction
      ? "direction did not change"
      : null;

  logConditionEvaluation(smartAlertTypes.CONSENSUS_FLIP, snapshot, !failedReason, {
    reason: failedReason,
    previousDirection,
    nextDirection: snapshot.direction,
  });

  if (failedReason) {
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
    logger.info(smartAlertDebugPrefix, {
      stage: "alert condition evaluated",
      passed: false,
      reason: "cooldown active",
      pair: alert.pair,
      alertType: alert.type,
      cooldownMs: config.smartAlerts.cooldownMs,
      elapsedMs: now.getTime() - previousNotificationAt,
    });
    return false;
  }

  cooldowns.set(key, now.getTime());
  logger.info(smartAlertDebugPrefix, {
    stage: "alert emitted",
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    alertType: alert.type,
    alertId: alert.id,
  });
  logger.info("[ALERT_TRIGGERED]", {
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    alertType: alert.type,
  });
  return true;
}

function logConditionEvaluation(alertType, snapshot, passed, details = null) {
  logger.info(smartAlertDebugPrefix, {
    stage: "alert condition evaluated",
    pair: snapshot.pair,
    alertType,
    passed,
    direction: snapshot.direction,
    confidence: snapshot.confidence,
    activeSignals: snapshot.activeSignals,
    freshnessLevel: snapshot.freshnessLevel,
    details,
  });
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
