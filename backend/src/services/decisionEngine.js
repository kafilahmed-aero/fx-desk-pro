import { logger } from "../utils/logger.js";

/**
 * Deep freezes an object recursively to guarantee immutability
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Deterministically evaluates Pair State and Market Data to output trading decisions.
 * @param {string} pair - Trading pair symbol
 * @param {Object} pairState - Recalculated state from Pair State Engine
 * @param {Array<string>|Object} activeOpportunities - Array or map of active opportunities
 * @param {Object} marketPrice - Price snapshot from Ingestion/Cache
 * @param {Object} options - Custom parameters (now)
 * @returns {Object} Immutable decision object
 */
export function evaluateDecision(pair, pairState, activeOpportunities, marketPrice, options = {}) {
  const normalized = String(pair).toUpperCase().trim();
  const now = options.now || Date.now();

  const fallbackDecision = deepFreeze({
    pair: normalized,
    decision: "HOLD",
    confidence: 0,
    priceSnapshot: null,
    entryRange: { low: null, high: null },
    stopLoss: null,
    takeProfits: [],
    timestamp: new Date(now).toISOString()
  });

  // 1. Inputs validation
  if (!pairState || !activeOpportunities || !marketPrice || marketPrice.status === "UNAVAILABLE") {
    return fallbackDecision;
  }

  // 2. Validate opportunity active state
  const isOpportunityActive = Array.isArray(activeOpportunities)
    ? activeOpportunities.includes(normalized)
    : Boolean(activeOpportunities[normalized]);

  if (!isOpportunityActive || pairState.activeSignalsCount === 0) {
    return fallbackDecision;
  }

  // 3. Evaluate direction based on ratios and weights
  let decision = "HOLD";
  const buyRatio = pairState.buyRatio || 0;
  const sellRatio = pairState.sellRatio || 0;
  const buyWeight = pairState.buyWeight || 0;
  const sellWeight = pairState.sellWeight || 0;

  if (buyRatio >= 0.6 && buyWeight > sellWeight) {
    decision = "BUY";
  } else if (sellRatio >= 0.6 && sellWeight > buyWeight) {
    decision = "SELL";
  }

  if (decision === "HOLD") {
    return fallbackDecision;
  }

  // 4. Calculate deterministic confidence score
  const baseConfidence = Math.max(buyRatio, sellRatio) * 100;
  let confidence = baseConfidence;

  // Add consensus modifier
  if (pairState.activeSignalsCount >= 3) {
    confidence += 10;
  }

  // Add volume/weight modifier
  if (pairState.totalWeight >= 5) {
    confidence += 10;
  }

  // Enforce boundary constraints
  confidence = Math.round(Math.min(100, Math.max(0, confidence)));

  // 5. Structure entryRange, takeProfits, and stopLoss limits
  const entryRange = pairState.entryZone
    ? { low: Number(pairState.entryZone.min), high: Number(pairState.entryZone.max) }
    : { low: null, high: null };

  let stopLoss = null;
  if (pairState.slZone) {
    stopLoss = decision === "BUY"
      ? Number(pairState.slZone.min)
      : Number(pairState.slZone.max);
  }

  const takeProfits = [];
  if (pairState.tpZone) {
    takeProfits.push(Number(pairState.tpZone.min));
    if (pairState.tpZone.max !== pairState.tpZone.min) {
      takeProfits.push(Number(pairState.tpZone.max));
    }
  }

  logger.info("decision_engine.evaluated", {
    pair: normalized,
    decision,
    confidence,
    price: marketPrice.price
  });

  return deepFreeze({
    pair: normalized,
    decision,
    confidence,
    priceSnapshot: marketPrice.price,
    entryRange,
    stopLoss,
    takeProfits,
    timestamp: new Date(now).toISOString()
  });
}
