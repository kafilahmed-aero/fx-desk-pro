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
 * Translates approved validations and upstream details into standardized, immutable execution requests.
 * @param {Object} validationResult - Snapshot from Trade Validation Engine
 * @param {Object} decision - Decision snapshot from Decision Engine
 * @param {Object} riskAssessment - Risk snapshot from Risk Engine
 * @param {Object} positionSizing - Position sizing details from Position Sizing Service
 * @param {Object} options - Custom parameters (now)
 * @returns {Object} Immutable execution request object
 */
export function generateExecutionRequest(validationResult, decision, riskAssessment, positionSizing, options = {}) {
  const now = options.now || Date.now();

  const buildRejectedResult = (reason) => {
    return deepFreeze({
      symbol: decision?.pair ? String(decision.pair).toUpperCase().trim() : "UNKNOWN",
      action: decision?.decision || null,
      volume: null,
      entry: null,
      stopLoss: null,
      takeProfits: [],
      status: "REJECTED",
      rejectionReason: reason,
      timestamp: new Date(now).toISOString(),
      metadata: {}
    });
  };

  // 1. Check presence of required structures
  if (!validationResult || !decision || !riskAssessment || !positionSizing) {
    return buildRejectedResult("MISSING_INPUTS");
  }

  // 2. Reject execution requests when validation status is not APPROVED
  if (validationResult.status !== "APPROVED") {
    return buildRejectedResult("VALIDATION_NOT_APPROVED");
  }

  // 3. Resolve execution entry price
  let entry = null;
  if (decision.entryRange && typeof decision.entryRange.low === "number" && typeof decision.entryRange.high === "number") {
    entry = (decision.entryRange.low + decision.entryRange.high) / 2;
  } else if (typeof decision.priceSnapshot === "number") {
    entry = decision.priceSnapshot;
  }

  if (entry === null || isNaN(entry) || entry <= 0) {
    return buildRejectedResult("INVALID_ENTRY_PRICE");
  }

  // 4. Check execution volume
  const volume = positionSizing.lotSize;
  if (typeof volume !== "number" || isNaN(volume) || volume <= 0) {
    return buildRejectedResult("INVALID_VOLUME");
  }

  // 5. Populate parameters and approve execution request
  const symbol = String(decision.pair).toUpperCase().trim();
  const action = decision.decision;
  const stopLoss = typeof decision.stopLoss === "number" ? decision.stopLoss : null;
  const takeProfits = Array.isArray(decision.takeProfits) ? [...decision.takeProfits] : [];

  logger.info("trade_execution.request_generated", { symbol, action, volume, entry });

  return deepFreeze({
    symbol,
    action,
    volume,
    entry,
    stopLoss,
    takeProfits,
    status: "APPROVED",
    rejectionReason: null,
    timestamp: new Date(now).toISOString(),
    metadata: {
      confidence: decision.confidence || 0,
      riskGrade: riskAssessment.riskGrade || "NONE",
      rewardToRiskRatio: riskAssessment.rewardToRiskRatio || 0,
      riskAmount: positionSizing.riskAmount || 0,
      stopDistanceUnits: positionSizing.stopDistanceUnits || 0,
      validationTimestamp: validationResult.timestamp || null
    }
  });
}
