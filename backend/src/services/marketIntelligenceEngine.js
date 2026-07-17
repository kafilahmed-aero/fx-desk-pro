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
 * Trend Subsystem Evaluator
 */
export function evaluateTrend(inputs = {}) {
  const direction = inputs.trendDirection || "Neutral";
  const strength = inputs.trendStrength || "Weak";
  const momentum = inputs.momentum || "Neutral";

  let score = 50; // Neutral baseline
  const reasons = [];
  const warnings = [];

  if (direction === "Bullish") {
    score = 65;
    reasons.push("Market trend is Bullish");
    if (strength === "Strong") {
      score += 15;
      reasons.push("Strong bullish trend strength detected");
    } else if (strength === "Moderate") {
      score += 5;
    } else {
      warnings.push("Weak trend structure despite bullish direction");
    }
    if (momentum === "Bullish") {
      score += 15;
      reasons.push("Momentum is aligned with bullish trend");
    } else if (momentum === "Bearish") {
      score -= 20;
      warnings.push("Bearish momentum divergence on Bullish trend");
    }
  } else if (direction === "Bearish") {
    score = 65;
    reasons.push("Market trend is Bearish");
    if (strength === "Strong") {
      score += 15;
      reasons.push("Strong bearish trend strength detected");
    } else if (strength === "Moderate") {
      score += 5;
    } else {
      warnings.push("Weak trend structure despite bearish direction");
    }
    if (momentum === "Bearish") {
      score += 15;
      reasons.push("Momentum is aligned with bearish trend");
    } else if (momentum === "Bullish") {
      score -= 20;
      warnings.push("Bullish momentum divergence on Bearish trend");
    }
  } else {
    reasons.push("Trend context is ranging/neutral");
  }

  score = Math.max(0, Math.min(100, score));

  let status = "NEUTRAL";
  if (score >= 80) {
    status = direction === "Bullish" ? "STRONG_BULLISH" : "STRONG_BEARISH";
  } else if (score >= 60) {
    status = direction === "Bullish" ? "WEAK_BULLISH" : "WEAK_BEARISH";
  }

  return {
    score,
    status,
    reasons,
    warnings,
    metrics: {
      direction,
      strength,
      momentum
    }
  };
}

/**
 * Market Structure Subsystem Evaluator
 */
export function evaluateStructure(inputs = {}) {
  const valuationZone = inputs.valuationZone || "Equilibrium";
  const liquiditySweep = inputs.liquiditySweep || "Absent";
  const marketRegime = inputs.marketRegime || "Range";

  let score = 60; // Baseline
  const reasons = [];
  const warnings = [];

  if (valuationZone === "Discount") {
    score = 80;
    reasons.push("Price located in Discount range");
    if (liquiditySweep === "Present") {
      score += 15;
      reasons.push("Bullish liquidity sweep confirmed in Discount");
    }
  } else if (valuationZone === "Premium") {
    score = 80;
    reasons.push("Price located in Premium range");
    if (liquiditySweep === "Present") {
      score += 15;
      reasons.push("Bearish liquidity sweep confirmed in Premium");
    }
  } else {
    reasons.push("Price in Equilibrium valuation zone");
  }

  if (marketRegime === "Compression") {
    warnings.push("High compression state; breakout imminent");
  }

  score = Math.max(0, Math.min(100, score));

  const status = score >= 80 ? "FAVORABLE" : (score >= 50 ? "NEUTRAL" : "UNFAVORABLE");

  return {
    score,
    status,
    reasons,
    warnings,
    metrics: {
      valuationZone,
      liquiditySweep,
      marketRegime
    }
  };
}

/**
 * Support & Resistance Subsystem Evaluator
 */
export function evaluateSupportResistance(inputs = {}) {
  const nearestObDistance = typeof inputs.nearestObDistance === "number" ? inputs.nearestObDistance : 25;
  const nearestFvgDistance = typeof inputs.nearestFvgDistance === "number" ? inputs.nearestFvgDistance : 25;
  const obStrength = typeof inputs.obStrength === "number" ? inputs.obStrength : 50;

  let score = 60; // Baseline
  const reasons = [];
  const warnings = [];

  if (nearestObDistance <= 5.0) {
    score = 80;
    reasons.push("Price proximate to valid Order Block (OB)");
    if (obStrength >= 70) {
      score += 10;
      reasons.push("Order Block has high structural strength");
    }
    if (nearestFvgDistance <= 5.0) {
      score += 10;
      reasons.push("Confluence with nearby Fair Value Gap (FVG)");
    }
  } else if (nearestObDistance >= 30.0) {
    score = 40;
    warnings.push("Price far from key structural levels");
  } else {
    reasons.push("Price holding in structural mid-ranges");
  }

  score = Math.max(0, Math.min(100, score));

  const status = score >= 80 ? "STRONG_SUPPORT_RESISTANCE" : (score >= 50 ? "NEUTRAL_ZONE" : "NO_SR_CONFLUENCE");

  return {
    score,
    status,
    reasons,
    warnings,
    metrics: {
      nearestObDistance,
      nearestFvgDistance,
      obStrength
    }
  };
}

/**
 * Session Subsystem Evaluator
 */
export function evaluateSession(inputs = {}) {
  const currentSession = inputs.currentSession || "Asian";
  const asianRangePips = typeof inputs.asianRangePips === "number" ? inputs.asianRangePips : 15;

  let score = 60;
  const reasons = [];
  const warnings = [];

  if (currentSession === "London/NY Overlap" || currentSession === "Crossover" || currentSession === "London–New York overlap") {
    score = 95;
    reasons.push("High liquidity London-NY overlap session");
  } else if (currentSession === "London" || currentSession === "NewYork" || currentSession === "New York") {
    score = 85;
    reasons.push(`Active volume session context: ${currentSession}`);
  } else if (currentSession === "Asian") {
    score = 55;
    warnings.push("Trading in lower volume Asian session environment");
  } else if (currentSession === "Holiday") {
    score = 30;
    warnings.push("Trading during holiday period; extremely low volume expected");
  } else if (currentSession === "Weekend") {
    score = 0;
    warnings.push("Market is closed for the weekend");
  } else {
    score = 50;
    warnings.push("Trading in lower volume session environment");
  }

  if (asianRangePips > 30.0) {
    score = Math.max(0, score - 10);
    warnings.push("Abnormally wide Asian session range limits intraday volatility potential");
  }

  score = Math.max(0, Math.min(100, score));

  const status = score >= 80 ? "HIGH_VOLUME" : (score >= 60 ? "MEDIUM_VOLUME" : "LOW_VOLUME");

  return {
    score,
    status,
    reasons,
    warnings,
    metrics: {
      currentSession,
      asianRangePips
    }
  };
}

/**
 * Volatility Subsystem Evaluator
 */
export function evaluateVolatility(inputs = {}) {
  const volatilityLevel = inputs.volatilityLevel || "Medium";
  const atr = typeof inputs.atr === "number" ? inputs.atr : 1.5;
  const stdDev = typeof inputs.stdDev === "number" ? inputs.stdDev : 1.2;

  let score = 75;
  const reasons = [];
  const warnings = [];

  if (volatilityLevel === "Low") {
    score = 90;
    reasons.push("Intraday volatility is compressed and stable");
  } else if (volatilityLevel === "Medium") {
    score = 80;
    reasons.push("Intraday volatility within normal historical boundaries");
  } else if (volatilityLevel === "High") {
    score = 50;
    warnings.push("Elevated volatility increases entry slippage risk");
  } else if (volatilityLevel === "Extreme") {
    score = 20;
    warnings.push("Extreme volatility spikes; execution highly risky");
  }

  score = Math.max(0, Math.min(100, score));

  const status = score >= 85 ? "STABLE" : (score >= 60 ? "NORMAL" : (score >= 40 ? "ELEVATED" : "EXCESSIVE"));

  return {
    score,
    status,
    reasons,
    warnings,
    metrics: {
      volatilityLevel,
      atr,
      stdDev
    }
  };
}

/**
 * Spread Subsystem Evaluator
 */
export function evaluateSpread(inputs = {}) {
  const currentSpread = typeof inputs.currentSpread === "number" ? inputs.currentSpread : 1.8;
  const maxSpreadLimit = typeof inputs.maxSpreadLimit === "number" ? inputs.maxSpreadLimit : 3.0;
  const marketClosed = !!inputs.marketClosed;

  let score = 80;
  const reasons = [];
  const warnings = [];

  if (marketClosed) {
    score = 0;
    warnings.push("Spread check blocked; broker market is currently closed");
  } else {
    if (currentSpread <= 1.5) {
      score = 100;
      reasons.push("Spread is highly optimal for execution");
    } else if (currentSpread <= maxSpreadLimit) {
      score = 80;
      reasons.push("Spread is acceptable and within normal boundaries");
    } else {
      score = Math.max(0, Math.round(80 - (currentSpread - maxSpreadLimit) * 15));
      warnings.push(`Wide spread detected: ${currentSpread} exceeds limit of ${maxSpreadLimit}`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  const status = marketClosed ? "CLOSED" : (score >= 90 ? "OPTIMAL" : (score >= 70 ? "ACCEPTABLE" : (score >= 40 ? "WIDE" : "BLOCKED")));

  return {
    score,
    status,
    reasons,
    warnings,
    metrics: {
      currentSpread,
      maxSpreadLimit,
      marketClosed
    }
  };
}

/**
 * Orchestrator: Aggregates subsystem analysis outputs into a standardized, recursively deep-frozen report.
 * 
 * @param {Object} inputs - Context parameters for subsystems
 * @param {Object} configOverride - Dynamic configuration overrides
 * @returns {Object} Deep-frozen Market Intelligence Report
 */
export function evaluateMarketContext(inputs = {}, configOverride = null) {
  let activeConfig = null;
  try {
    activeConfig = getConfig();
  } catch (err) {}

  const weights = {
    trend: 25,
    structure: 20,
    supportResistance: 15,
    session: 15,
    volatility: 15,
    spread: 10,
    ...((activeConfig && activeConfig.marketIntelligence && activeConfig.marketIntelligence.weights) || {}),
    ...((configOverride && configOverride.weights) || {})
  };

  const thresholds = {
    gradeA: 90,
    gradeB: 80,
    gradeC: 70,
    ...((activeConfig && activeConfig.marketIntelligence && activeConfig.marketIntelligence.thresholds) || {}),
    ...((configOverride && configOverride.thresholds) || {})
  };

  const sumOfWeights = Object.values(weights).reduce((a, b) => a + b, 0) || 100;

  // 1. Invoke Evaluators
  const trendRes = evaluateTrend(inputs.trend || {});
  const structureRes = evaluateStructure(inputs.structure || {});
  const srRes = evaluateSupportResistance(inputs.supportResistance || {});
  const sessionRes = evaluateSession(inputs.session || {});
  const volRes = evaluateVolatility(inputs.volatility || {});
  const spreadRes = evaluateSpread(inputs.spread || {});

  // 2. Aggregate Score
  const overallScore = Math.round(
    (trendRes.score * weights.trend +
     structureRes.score * weights.structure +
     srRes.score * weights.supportResistance +
     sessionRes.score * weights.session +
     volRes.score * weights.volatility +
     spreadRes.score * weights.spread) / sumOfWeights
  );

  // 3. Determine overall grade
  const isClosed = inputs.spread?.marketClosed === true || inputs.session?.currentSession === "Weekend";

  let overallGrade = "REJECT";
  if (isClosed) {
    overallGrade = "REJECT";
  } else if (overallScore >= thresholds.gradeA) {
    overallGrade = "GRADE A";
  } else if (overallScore >= thresholds.gradeB) {
    overallGrade = "GRADE B";
  } else if (overallScore >= thresholds.gradeC) {
    overallGrade = "GRADE C";
  }

  // 4. Gather warnings and reasons
  const reasons = [
    ...trendRes.reasons,
    ...structureRes.reasons,
    ...srRes.reasons,
    ...sessionRes.reasons,
    ...volRes.reasons,
    ...spreadRes.reasons
  ];

  const warnings = [
    ...trendRes.warnings,
    ...structureRes.warnings,
    ...srRes.warnings,
    ...sessionRes.warnings,
    ...volRes.warnings,
    ...spreadRes.warnings
  ];

  if (isClosed) {
    warnings.push("Market check blocked: Trading is closed");
  }

  // 5. Construct subsystem metrics aggregation
  const subsystemMetrics = {
    trend: trendRes.metrics,
    structure: structureRes.metrics,
    supportResistance: srRes.metrics,
    session: sessionRes.metrics,
    volatility: volRes.metrics,
    spread: spreadRes.metrics
  };

  const status = isClosed ? "CLOSED" : (overallGrade === "REJECT" ? "WARNING" : "HEALTHY");

  const report = {
    status,
    overallScore,
    overallGrade,
    trend: trendRes,
    structure: structureRes,
    supportResistance: srRes,
    session: sessionRes,
    volatility: volRes,
    spread: spreadRes,
    subsystemMetrics,
    reasons,
    warnings,
    timestamp: new Date().toISOString()
  };

  return deepFreeze(report);
}
