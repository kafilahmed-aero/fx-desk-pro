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
 * Validates deterministically whether a trade setup is eligible for execution.
 * @param {Object} decision - Decision snapshot from Decision Engine
 * @param {Object} riskAssessment - Risk snapshot from Risk Engine
 * @param {Object} positionSizing - Position sizing details from Position Sizing Service
 * @param {Object} options - Custom parameters (now, rejectHighRisk)
 * @returns {Object} Immutable validation result
 */
export function validateTrade(decision, riskAssessment, positionSizing, options = {}) {
  const now = options.now || Date.now();
  const pair = decision?.pair || "UNKNOWN";
  const action = decision?.decision || "HOLD";

  const buildResult = (isValid, status, reason = null) => {
    return deepFreeze({
      pair,
      decision: action,
      isValid,
      status,
      rejectionReason: reason,
      timestamp: new Date(now).toISOString()
    });
  };

  // 1. Presence check of all required upstream outputs
  if (!decision || !riskAssessment || !positionSizing) {
    return buildResult(false, "REJECTED", "MISSING_INPUTS");
  }

  // 2. Reject HOLD decisions (no active trade signal)
  if (action !== "BUY" && action !== "SELL") {
    return buildResult(false, "REJECTED", "HOLD_DECISION_REJECTED");
  }

  // 3. Reject structurally invalid trades (defined by the Risk Engine)
  if (riskAssessment.isValidStructure === false) {
    return buildResult(false, "REJECTED", "INVALID_ORDER_STRUCTURE");
  }

  // 4. Reject unacceptable risk grade ratings
  if (riskAssessment.riskGrade === "INVALID") {
    return buildResult(false, "REJECTED", "UNACCEPTABLE_RISK");
  }
  if (options.rejectHighRisk === true && riskAssessment.riskGrade === "HIGH_RISK") {
    return buildResult(false, "REJECTED", "UNACCEPTABLE_RISK");
  }

  // 5. Reject setups that calculated to zero lot size
  if (typeof positionSizing.lotSize !== "number" || positionSizing.lotSize <= 0) {
    return buildResult(false, "REJECTED", "LOT_SIZE_ZERO");
  }

  // 6. Approve setup if all checks pass successfully
  logger.info("trade_validation.approved", { pair, action, lotSize: positionSizing.lotSize });
  return buildResult(true, "APPROVED", null);
}
