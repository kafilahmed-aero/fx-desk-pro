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
 * Evaluates Decision Engine outputs and produces a standardized risk assessment snapshot.
 * @param {Object} decision - Decision snapshot from Decision Engine
 * @param {Object} options - Override parameters (now)
 * @returns {Object} Immutable risk assessment object
 */
export function evaluateRisk(decision, options = {}) {
  const now = options.now || Date.now();
  
  const fallbackAssessment = (grade, rrr = 0, isValid = false, notes = []) => {
    return deepFreeze({
      pair: decision?.pair || "UNKNOWN",
      decision: decision?.decision || "HOLD",
      riskGrade: grade,
      rewardToRiskRatio: Number(rrr.toFixed(2)),
      isValidStructure: isValid,
      validationNotes: notes,
      timestamp: new Date(now).toISOString()
    });
  };

  // 1. Check if decision is HOLD
  if (!decision || decision.decision === "HOLD") {
    return fallbackAssessment("NONE", 0, true, []);
  }

  const validationNotes = [];
  let entry = null;

  // 2. Resolve estimated entry price
  if (decision.entryRange && typeof decision.entryRange.low === "number" && typeof decision.entryRange.high === "number") {
    entry = (decision.entryRange.low + decision.entryRange.high) / 2;
  } else if (typeof decision.priceSnapshot === "number") {
    entry = decision.priceSnapshot;
  }

  if (entry === null || isNaN(entry) || entry <= 0) {
    validationNotes.push("Invalid or missing entry price reference");
    return fallbackAssessment("INVALID", 0, false, validationNotes);
  }

  // 3. Resolve Stop Loss and Take Profit targets
  if (typeof decision.stopLoss !== "number" || isNaN(decision.stopLoss) || decision.stopLoss <= 0) {
    validationNotes.push("Missing or invalid stop loss level");
  }

  if (!Array.isArray(decision.takeProfits) || decision.takeProfits.length === 0) {
    validationNotes.push("Missing or invalid take profit targets");
  }

  if (validationNotes.length > 0) {
    return fallbackAssessment("INVALID", 0, false, validationNotes);
  }

  // 4. Validate order structure based on trade action
  if (decision.decision === "BUY") {
    if (decision.stopLoss >= entry) {
      validationNotes.push("Stop Loss must be below Entry price for BUY orders");
    }
    if (decision.takeProfits.some((tp) => tp <= entry)) {
      validationNotes.push("All Take Profit targets must be above Entry price for BUY orders");
    }
  } else if (decision.decision === "SELL") {
    if (decision.stopLoss <= entry) {
      validationNotes.push("Stop Loss must be above Entry price for SELL orders");
    }
    if (decision.takeProfits.some((tp) => tp >= entry)) {
      validationNotes.push("All Take Profit targets must be below Entry price for SELL orders");
    }
  } else {
    validationNotes.push(`Unsupported trade decision type: ${decision.decision}`);
    return fallbackAssessment("INVALID", 0, false, validationNotes);
  }

  if (validationNotes.length > 0) {
    return fallbackAssessment("INVALID", 0, false, validationNotes);
  }

  // 5. Calculate Reward-to-Risk Ratio (RRR)
  const stopDistance = Math.abs(entry - decision.stopLoss);
  if (stopDistance === 0) {
    validationNotes.push("Stop Loss distance cannot be zero");
    return fallbackAssessment("INVALID", 0, false, validationNotes);
  }

  const maxTpDistance = Math.max(...decision.takeProfits.map((tp) => Math.abs(tp - entry)));
  const rewardToRiskRatio = Number((maxTpDistance / stopDistance).toFixed(4));

  // 6. Map Risk Grade based on RRR thresholds
  let riskGrade = "HIGH_RISK";
  if (rewardToRiskRatio >= 1.5) {
    riskGrade = "LOW_RISK";
  } else if (rewardToRiskRatio >= 1.0) {
    riskGrade = "MODERATE_RISK";
  }

  logger.info("risk_engine.evaluated", {
    pair: decision.pair,
    decision: decision.decision,
    riskGrade,
    rrr: rewardToRiskRatio
  });

  return fallbackAssessment(riskGrade, rewardToRiskRatio, true, []);
}
