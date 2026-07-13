import { getConfig } from "../config/systemConfigManager.js";

// Helper function to freeze objects recursively
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
 * Smart Entry Engine
 * Evaluates entry zones and current market pricing to determine the best execution strategy.
 * 
 * @param {Object} inputs - Execution parameters and upstream reports
 * @param {Object} configOverride - Dynamic configuration overrides
 * @returns {Object} Deep-frozen entry strategy report
 */
export function evaluateEntryStrategy(inputs = {}, configOverride = null) {
  let activeConfig = null;
  try {
    activeConfig = getConfig();
  } catch (err) {}

  const config = {
    minimumRR: 1.5,
    preferredRR: 2.0,
    excellentRR: 3.0,
    maximumTpTravelBeforeReject: 0.8,
    maximumSpreadMultiplier: 2.0,
    minimumEntryDistance: 1.0,
    maximumEntryDistance: 10.0,
    ...((activeConfig && activeConfig.smartEntry) || {}),
    ...(configOverride || {})
  };

  const decisionReport = inputs.decisionReport || {};
  const marketContext = inputs.marketContext || {};
  const currentPrice = Number(inputs.currentPrice || 0);
  const entryMin = Number(inputs.entryMin || 0);
  const entryMax = Number(inputs.entryMax || 0);
  const stopLoss = Number(inputs.stopLoss || 0);
  const takeProfits = Array.isArray(inputs.takeProfits) ? inputs.takeProfits.map(Number) : [];
  const currentSpread = Number(inputs.currentSpread || 1.5);
  const timestamp = inputs.timestamp || new Date().toISOString();

  const reasons = [];
  const warnings = [];

  // 1. Decision HOLD or REJECT Block
  if (decisionReport.decision === "HOLD" || decisionReport.grade === "REJECT") {
    return deepFreeze({
      recommendedStrategy: "WAIT",
      alternativeStrategy: "WAIT",
      entryZone: { low: 0, high: 0 },
      entryPrice: 0,
      stopLoss: 0,
      takeProfits,
      expectedRR: 0,
      expectedReward: 0,
      expectedRisk: 0,
      probability: 0,
      entryQuality: "POOR",
      reasons: ["Decision Engine rejected execution / resolved to HOLD."],
      warnings: ["Decision Engine is in HOLD state"],
      timestamp
    });
  }

  // 2. Validate essential parameters
  if (
    !currentPrice ||
    !entryMin ||
    !entryMax ||
    !stopLoss ||
    takeProfits.length === 0 ||
    takeProfits.some(isNaN)
  ) {
    return deepFreeze({
      recommendedStrategy: "WAIT",
      alternativeStrategy: "WAIT",
      entryZone: { low: Math.min(entryMin, entryMax), high: Math.max(entryMin, entryMax) },
      entryPrice: currentPrice,
      stopLoss,
      takeProfits,
      expectedRR: 0,
      expectedReward: 0,
      expectedRisk: 0,
      probability: 0,
      entryQuality: "POOR",
      reasons: ["Invalid parameters: missing entry zone, stop loss, or target take profits."],
      warnings: ["Invalid execution inputs"],
      timestamp
    });
  }

  const direction = decisionReport.decision; // "BUY" or "SELL"
  const primaryTP = takeProfits[0];
  const midpoint = Number(((entryMin + entryMax) / 2).toFixed(2));
  const entryZone = {
    low: Number(Math.min(entryMin, entryMax).toFixed(2)),
    high: Number(Math.max(entryMin, entryMax).toFixed(2))
  };

  // 3. Chasing Filter (maximumTpTravelBeforeReject)
  const totalTradeRange = Math.abs(primaryTP - midpoint);
  let travelledDistance = 0;

  if (direction === "BUY") {
    travelledDistance = currentPrice - midpoint;
  } else if (direction === "SELL") {
    travelledDistance = midpoint - currentPrice;
  }

  const travelRatio = totalTradeRange > 0 ? (travelledDistance / totalTradeRange) : 0;
  if (travelRatio >= config.maximumTpTravelBeforeReject) {
    return deepFreeze({
      recommendedStrategy: "WAIT",
      alternativeStrategy: "WAIT",
      entryZone,
      entryPrice: currentPrice,
      stopLoss,
      takeProfits,
      expectedRR: 0,
      expectedReward: 0,
      expectedRisk: 0,
      probability: 0,
      entryQuality: "POOR",
      reasons: ["Price too close to TP; chasing risk is high (Config Policy check)."],
      warnings: [`Travel ratio ${travelRatio.toFixed(2)} exceeds limit ${config.maximumTpTravelBeforeReject}`],
      timestamp
    });
  }

  // 4. Basic Recommended and Alternative Strategy Routing
  let recommendedStrategy = "WAIT";
  let alternativeStrategy = "WAIT";
  let entryPrice = currentPrice;
  let strategyReason = "";

  const isInsideZone = currentPrice >= entryZone.low && currentPrice <= entryZone.high;

  if (direction === "BUY") {
    if (isInsideZone) {
      recommendedStrategy = "MARKET";
      alternativeStrategy = "BUY_LIMIT";
      entryPrice = currentPrice;
      strategyReason = "Price holding inside ideal entry zone.";
    } else if (currentPrice > entryZone.high) {
      recommendedStrategy = "BUY_LIMIT";
      alternativeStrategy = "MARKET";
      entryPrice = midpoint;
      strategyReason = "Market has extended beyond ideal entry zone; waiting for retracement.";
    } else {
      recommendedStrategy = "BUY_STOP";
      alternativeStrategy = "BUY_LIMIT";
      entryPrice = entryZone.low;
      strategyReason = "Price is below the entry zone; waiting for breakout confirmation.";
    }
  } else if (direction === "SELL") {
    if (isInsideZone) {
      recommendedStrategy = "MARKET";
      alternativeStrategy = "SELL_LIMIT";
      entryPrice = currentPrice;
      strategyReason = "Price holding inside ideal entry zone.";
    } else if (currentPrice < entryZone.low) {
      recommendedStrategy = "SELL_LIMIT";
      alternativeStrategy = "MARKET";
      entryPrice = midpoint;
      strategyReason = "Market has extended below ideal entry zone; waiting for retracement.";
    } else {
      recommendedStrategy = "SELL_STOP";
      alternativeStrategy = "SELL_LIMIT";
      entryPrice = entryZone.high;
      strategyReason = "Price is above the entry zone; waiting for breakdown confirmation.";
    }
  }

  reasons.push(strategyReason);

  // 5. Risk-Reward Checks & Retracement Optimization
  let expectedRisk = Number(Math.abs(entryPrice - stopLoss).toFixed(2));
  let expectedReward = Number(Math.abs(primaryTP - entryPrice).toFixed(2));
  let expectedRR = expectedRisk > 0 ? Number((expectedReward / expectedRisk).toFixed(2)) : 0;

  if (expectedRR < config.minimumRR) {
    if (recommendedStrategy === "MARKET") {
      // Optimize to a Limit order to guarantee the minimum RR
      const targetLimitPrice = direction === "BUY"
        ? stopLoss + (expectedReward / config.minimumRR)
        : stopLoss - (expectedReward / config.minimumRR);
      
      const roundedLimit = Number(targetLimitPrice.toFixed(2));

      // Make sure the optimized limit price resides on the valid side of current price
      const isValidLimit = direction === "BUY" ? roundedLimit < currentPrice : roundedLimit > currentPrice;

      if (isValidLimit) {
        recommendedStrategy = direction === "BUY" ? "BUY_LIMIT" : "SELL_LIMIT";
        entryPrice = roundedLimit;
        expectedRisk = Number(Math.abs(entryPrice - stopLoss).toFixed(2));
        expectedReward = Number(Math.abs(primaryTP - entryPrice).toFixed(2));
        expectedRR = expectedRisk > 0 ? Number((expectedReward / expectedRisk).toFixed(2)) : 0;
        reasons.push(`Optimized entry to limit order at ${roundedLimit} to secure minimum RR of ${config.minimumRR}`);
      } else {
        recommendedStrategy = "WAIT";
        reasons.push("Expected Risk-Reward ratio falls below minimum threshold.");
        warnings.push(`Expected RR ${expectedRR} < minimum ${config.minimumRR}`);
      }
    } else {
      recommendedStrategy = "WAIT";
      reasons.push("Expected Risk-Reward ratio falls below minimum threshold.");
      warnings.push(`Expected RR ${expectedRR} < minimum ${config.minimumRR}`);
    }
  }

  // 6. Entry Quality Scoring
  let qualityScore = 75; // Neutral baseline

  // RR scoring
  if (expectedRR >= config.excellentRR) {
    qualityScore += 15;
    reasons.push(`Excellent risk:reward ratio: ${expectedRR}`);
  } else if (expectedRR >= config.preferredRR) {
    qualityScore += 5;
  } else if (expectedRR < config.minimumRR) {
    qualityScore -= 40;
  }

  // Distance from ideal entry zone
  const dist = Math.abs(currentPrice - midpoint);
  if (dist > config.maximumEntryDistance) {
    qualityScore -= 15;
    warnings.push(`Price is far from entry zone midpoint (Distance: ${dist.toFixed(2)})`);
  } else if (dist <= config.minimumEntryDistance) {
    qualityScore += 5;
  }

  // Spread checks
  const maxSpreadLimit = Number(marketContext.spread?.metrics?.maxSpreadLimit || 3.0);
  if (currentSpread > maxSpreadLimit * config.maximumSpreadMultiplier) {
    qualityScore -= 20;
    warnings.push(`Abnormally high broker spread: ${currentSpread} exceeds multiplier limit`);
  } else if (currentSpread <= maxSpreadLimit) {
    qualityScore += 5;
  }

  // Market Intelligence details
  if (marketContext.overallScore >= 80) {
    qualityScore += 10;
  } else if (marketContext.overallScore < 50) {
    qualityScore -= 15;
  }

  // Trend & Structure details
  if (marketContext.trend?.status?.includes("STRONG")) {
    qualityScore += 5;
  }
  if (marketContext.structure?.status === "FAVORABLE") {
    qualityScore += 5;
  }

  let entryQuality = "POOR";
  if (recommendedStrategy === "WAIT") {
    entryQuality = "POOR";
  } else if (qualityScore >= 85) {
    entryQuality = "GRADE A";
  } else if (qualityScore >= 70) {
    entryQuality = "GRADE B";
  } else if (qualityScore >= 55) {
    entryQuality = "GRADE C";
  } else {
    entryQuality = "POOR";
  }

  // Estimate winning probability deterministically (incorporating upstream MI and decision engine confidence)
  const miWeight = 0.5;
  const decWeight = 0.5;
  const miScore = marketContext.overallScore || 50;
  const decScore = decisionReport.confidence || 50;
  const probability = recommendedStrategy === "WAIT" ? 0 : Math.round(miScore * miWeight + decScore * decWeight);

  return deepFreeze({
    recommendedStrategy,
    alternativeStrategy,
    entryZone,
    entryPrice,
    stopLoss,
    takeProfits,
    expectedRR,
    expectedReward,
    expectedRisk,
    probability,
    entryQuality,
    reasons,
    warnings,
    timestamp
  });
}
