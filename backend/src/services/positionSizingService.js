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
 * Calculates risk-adjusted lot sizes for trading decisions deterministically.
 * @param {Object} decision - Standardized decision from Decision Engine
 * @param {Object} riskAssessment - Standardized risk assessment from Risk Engine
 * @param {Object} accountState - Account balance and parameters
 * @param {Object} options - Custom parameters (now)
 * @returns {Object} Immutable position sizing details
 */
export function calculatePositionSize(decision, riskAssessment, accountState, options = {}) {
  const now = options.now || Date.now();
  const pair = decision?.pair || "UNKNOWN";
  
  const fallbackSizing = (multiplier = 0, lots = 0, risk = 0, stopDist = 0) => {
    const roundedLots = Math.round((lots + Number.EPSILON) * 100) / 100;
    return deepFreeze({
      pair,
      lotSize: roundedLots,
      riskAmount: Number(risk.toFixed(2)),
      stopDistanceUnits: Number(stopDist.toFixed(6)),
      riskGradeMultiplier: multiplier,
      timestamp: new Date(now).toISOString()
    });
  };

  // 1. Inputs validation
  if (!decision || !riskAssessment || !accountState) {
    return fallbackSizing();
  }

  if (decision.decision === "HOLD" || riskAssessment.riskGrade === "NONE" || riskAssessment.riskGrade === "INVALID") {
    return fallbackSizing();
  }

  const balance = Number(accountState.balance);
  const maxRiskPercent = Number(accountState.maxRiskPercent || 1.0);

  if (isNaN(balance) || balance <= 0 || isNaN(maxRiskPercent) || maxRiskPercent <= 0) {
    logger.warn("position_sizing.invalid_account_parameters_skipped", { balance, maxRiskPercent });
    return fallbackSizing();
  }

  // 2. Resolve estimated entry price
  let entry = null;
  if (decision.entryRange && typeof decision.entryRange.low === "number" && typeof decision.entryRange.high === "number") {
    entry = (decision.entryRange.low + decision.entryRange.high) / 2;
  } else if (typeof decision.priceSnapshot === "number") {
    entry = decision.priceSnapshot;
  }

  if (entry === null || isNaN(entry) || entry <= 0) {
    return fallbackSizing();
  }

  // 3. Calculate Stop Loss Distance
  const stopDistance = Math.abs(entry - decision.stopLoss);
  if (stopDistance === 0 || isNaN(stopDistance)) {
    return fallbackSizing();
  }

  // 4. Resolve Asset Category Contract Sizes
  const normalized = String(pair).toUpperCase().trim();
  let contractSize = 100000; // Default to standard Forex Lot (100,000 units)
  
  if (
    normalized.startsWith("XAU") || 
    normalized.startsWith("XAG") || 
    normalized === "GOLD" || 
    normalized === "SILVER"
  ) {
    contractSize = 100; // Standard Gold/Silver Lot (100 ounces)
  }

  // 5. Solve Raw Position size
  const riskCapital = (balance * maxRiskPercent) / 100;
  const rawLotSize = riskCapital / (stopDistance * contractSize);

  // 6. Apply Risk Grade multipliers
  let multiplier = 0;
  if (riskAssessment.riskGrade === "LOW_RISK") {
    multiplier = 1.0;
  } else if (riskAssessment.riskGrade === "MODERATE_RISK") {
    multiplier = 0.75;
  } else if (riskAssessment.riskGrade === "HIGH_RISK") {
    multiplier = 0.50;
  }

  let lotSize = rawLotSize * multiplier;

  // 7. Clamp to limits (minimum 0.01, standard max 10.00)
  if (lotSize < 0.01) {
    lotSize = 0;
  } else {
    const maxLimit = Number(accountState.maxLotLimit || 10.00);
    lotSize = Math.min(maxLimit, lotSize);
  }

  logger.info("position_sizing.evaluated", {
    pair,
    lotSize,
    riskCapital,
    multiplier
  });

  return fallbackSizing(multiplier, lotSize, riskCapital, stopDistance);
}
