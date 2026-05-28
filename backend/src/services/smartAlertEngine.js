import { logger } from "../utils/logger.js";
import { canAffectConsensus } from "./signalStateEngine.js";

export const smartAlertTypes = {
  BOOTSTRAP_CONSENSUS: "BOOTSTRAP_CONSENSUS",
  RAPID_CONFIDENCE_RISE: "RAPID_CONFIDENCE_RISE",
  STRONG_CONSENSUS: "STRONG_CONSENSUS",
  CONSENSUS_FLIP: "CONSENSUS_FLIP",
};

const cooldowns = new Map();
const smartAlertDebugPrefix = "[SMART_ALERT_DEBUG]";
const bootstrapAlertCriteria = {
  minActiveSignals: 2,
  freshnessLevels: ["FRESH", "VERY_FRESH"],
  cooldownMs: 60 * 1000,
};

export function evaluateSmartAlerts(pairState, _previousPairState = null, now = new Date()) {
  try {
    void _previousPairState;

    if (!pairState?.pair) {
      logger.info(smartAlertDebugPrefix, {
        stage: "alert condition evaluated",
        passed: false,
        reason: "missing pair state pair",
      });
      return [];
    }

    const snapshot = createAlertSnapshot(pairState);
    const alertCandidates = [createBootstrapConsensusAlert(snapshot)].filter(Boolean);
    const alerts = alertCandidates.filter((alert) => canNotify(alert, now));

    logger.info(smartAlertDebugPrefix, {
      stage: "alert condition evaluated",
      mode: "bootstrap",
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
  const buyConfidence = Number(pairState.buyConfidence) || 0;
  const sellConfidence = Number(pairState.sellConfidence) || 0;
  const direction = getBootstrapDirection(pairState.marketDirection, buyConfidence, sellConfidence);
  const confidence = getDirectionalConfidence(pairState, direction);
  const activeSignals = Number(pairState.signalCount) || 0;
  const freshnessLevel = getPairFreshnessLevel(pairState);

  return {
    pair: pairState.pair,
    direction,
    marketDirection: pairState.marketDirection || "NEUTRAL",
    confidence,
    buyConfidence,
    sellConfidence,
    activeSignals,
    freshnessLevel,
  };
}

function createBootstrapConsensusAlert(snapshot) {
  const failedReason =
    snapshot.activeSignals < bootstrapAlertCriteria.minActiveSignals
      ? "active signal count below bootstrap threshold"
      : !bootstrapAlertCriteria.freshnessLevels.includes(snapshot.freshnessLevel)
      ? "freshness below bootstrap threshold"
      : null;

  logConditionEvaluation(
    smartAlertTypes.BOOTSTRAP_CONSENSUS,
    snapshot,
    !failedReason,
    failedReason
      ? {
          reason: failedReason,
          criteria: bootstrapAlertCriteria,
        }
      : {
          reason: "bootstrap criteria passed",
          criteria: bootstrapAlertCriteria,
        }
  );

  if (failedReason) {
    return null;
  }

  return buildAlert(smartAlertTypes.BOOTSTRAP_CONSENSUS, snapshot, {
    title: `${snapshot.pair} ${snapshot.direction} Smart Alert`,
    body: `Direction: ${snapshot.direction}\nConfidence: ${snapshot.confidence}%\nSignals: ${snapshot.activeSignals}`,
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
    signalCount: snapshot.activeSignals,
    freshnessLevel: snapshot.freshnessLevel,
    buyConfidence: snapshot.buyConfidence,
    sellConfidence: snapshot.sellConfidence,
    title: message.title,
    body: message.body,
    timestamp: new Date().toISOString(),
  };
}

function canNotify(alert, now) {
  const key = alert.pair;
  const previousNotificationAt = cooldowns.get(key) || 0;
  const elapsedMs = now.getTime() - previousNotificationAt;

  logger.info(smartAlertDebugPrefix, {
    stage: "before cooldown check",
    pair: alert.pair,
    alertType: alert.type,
    cooldownMs: bootstrapAlertCriteria.cooldownMs,
    elapsedMs,
    previousNotificationAt: previousNotificationAt || null,
    mode: "bootstrap",
  });

  if (elapsedMs < bootstrapAlertCriteria.cooldownMs) {
    logger.info(smartAlertDebugPrefix, {
      stage: "after cooldown check",
      passed: false,
      reason: "cooldown active",
      pair: alert.pair,
      alertType: alert.type,
      cooldownMs: bootstrapAlertCriteria.cooldownMs,
      elapsedMs,
      mode: "bootstrap",
    });
    return false;
  }

  logger.info(smartAlertDebugPrefix, {
    stage: "after cooldown check",
    passed: true,
    pair: alert.pair,
    alertType: alert.type,
    cooldownMs: bootstrapAlertCriteria.cooldownMs,
    elapsedMs,
    mode: "bootstrap",
  });
  logger.info(`${smartAlertDebugPrefix} alert emitted`, {
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    alertType: alert.type,
    alertId: alert.id,
    mode: "bootstrap",
  });
  logger.info(smartAlertDebugPrefix, {
    stage: "alert emitted",
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    alertType: alert.type,
    alertId: alert.id,
    mode: "bootstrap",
  });
  logger.info("[ALERT_TRIGGERED]", {
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    alertType: alert.type,
  });
  return true;
}

export function markSmartAlertCooldown(alert, now = new Date()) {
  if (!alert?.pair) {
    logger.info(smartAlertDebugPrefix, {
      stage: "after cooldown timestamp update",
      updated: false,
      reason: "missing alert pair",
      alertType: alert?.type,
      mode: "bootstrap",
    });
    return false;
  }

  cooldowns.set(alert.pair, now.getTime());
  logger.info(smartAlertDebugPrefix, {
    stage: "after cooldown timestamp update",
    updated: true,
    pair: alert.pair,
    alertType: alert.type,
    cooldownAt: now.toISOString(),
    mode: "bootstrap",
  });
  return true;
}

function logConditionEvaluation(alertType, snapshot, passed, details = null) {
  logger.info(smartAlertDebugPrefix, {
    stage: "alert condition evaluated",
    mode: "bootstrap",
    pair: snapshot.pair,
    alertType,
    passed,
    direction: snapshot.direction,
    confidence: snapshot.confidence,
    buyConfidence: snapshot.buyConfidence,
    sellConfidence: snapshot.sellConfidence,
    activeSignals: snapshot.activeSignals,
    freshnessLevel: snapshot.freshnessLevel,
    details,
  });
}

function getDirectionalConfidence(pairState, direction) {
  if (direction === "BUY") {
    return Number(pairState.buyConfidence) || 0;
  }

  if (direction === "SELL") {
    return Number(pairState.sellConfidence) || 0;
  }

  return (
    Number(pairState.confidenceScore) ||
    Math.max(Number(pairState.buyConfidence) || 0, Number(pairState.sellConfidence) || 0)
  );
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

function getBootstrapDirection(marketDirection, buyConfidence, sellConfidence) {
  const normalizedDirection = normalizeDirection(marketDirection);

  if (normalizedDirection !== "NEUTRAL") {
    return normalizedDirection;
  }

  if (buyConfidence !== sellConfidence) {
    return buyConfidence >= sellConfidence ? "BUY" : "SELL";
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
