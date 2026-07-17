import { getConfig } from "../config/systemConfigManager.js";
import { evaluateMarketContext } from "./marketIntelligenceEngine.js";
import { logger } from "../utils/logger.js";
import { getCurrentTradingSession, isMarketClosed } from "./tradingSessionService.js";

// O(n log n) clustering algorithm matching the one in geminiAdvisorService.js
export function findClusters(numbers, tolerance) {
  if (!numbers || numbers.length === 0) return [];
  const sorted = [...numbers].sort((a, b) => a - b);
  const clusters = [];
  let currentCluster = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= tolerance) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }
  clusters.push(currentCluster);

  return clusters
    .filter(c => c.length >= 2)
    .map(c => ({
      min: Math.min(...c),
      max: Math.max(...c),
      count: c.length
    }))
    .sort((a, b) => b.count - a.count);
}

// Deep freeze helper to guarantee immutability of the returned object
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
 * Deterministic Decision Engine
 * Evaluates market opportunities based on a weighted scoring model.
 * 
 * @param {Object} inputs - Evaluated market parameters
 * @param {Object} configOverride - Optional overrides for testing
 * @returns {Object} Deeply frozen decision response
 */
export async function evaluateMarketOpportunity(inputs = {}, configOverride = null) {
  // 1. Resolve Config (Weights & Thresholds)
  let activeConfig = null;
  try {
    activeConfig = getConfig();
  } catch (err) {}

  const weights = {
    consensus: 35,
    marketIntelligence: 40,
    risk: 15,
    rrr: 10,
    ...((activeConfig && activeConfig.decisionEngine && activeConfig.decisionEngine.weights) || {}),
    ...((configOverride && configOverride.weights) || {})
  };

  const thresholds = {
    gradeA: 90,
    gradeB: 80,
    gradeC: 70,
    ...((activeConfig && activeConfig.decisionEngine && activeConfig.decisionEngine.thresholds) || {}),
    ...((configOverride && configOverride.thresholds) || {})
  };

  const warningPenalty = typeof configOverride?.warningPenalty === "number"
    ? configOverride.warningPenalty
    : (typeof activeConfig?.decisionEngine?.warningPenalty === "number"
      ? activeConfig.decisionEngine.warningPenalty
      : 5);

  const maximumPenalty = typeof configOverride?.maximumPenalty === "number"
    ? configOverride.maximumPenalty
    : (typeof activeConfig?.decisionEngine?.maximumPenalty === "number"
      ? activeConfig.decisionEngine.maximumPenalty
      : 20);

  const policies = {
    blockMarketClosed: true,
    blockSpreadBlocked: true,
    blockExtremeVolatility: true,
    ...((activeConfig && activeConfig.decisionEngine && activeConfig.decisionEngine.policies) || {}),
    ...((configOverride && configOverride.policies) || {})
  };

  const sumOfWeights = Object.values(weights).reduce((a, b) => a + b, 0) || 100;

  // Extract base input structures
  const signals = inputs.parsedSignals || [];
  const pairState = inputs.pairState || {};
  const consensus = inputs.consensus || {};
  const marketState = inputs.marketState || {};
  const riskAssessment = inputs.riskAssessment || {};

  // Extract raw prices/metrics
  const currentPrice = Number(marketState.currentPrice || inputs.currentPrice || 0);
  const buySignals = signals.filter(s => s.action === "BUY");
  const sellSignals = signals.filter(s => s.action === "SELL");
  const totalActiveSignals = buySignals.length + sellSignals.length;

  // Determine dominant direction from consensus inputs
  let buyPercentage = 50;
  let sellPercentage = 50;
  if (consensus.buyConfidence !== undefined && consensus.sellConfidence !== undefined) {
    buyPercentage = Number(consensus.buyConfidence);
    sellPercentage = Number(consensus.sellConfidence);
  } else if (totalActiveSignals > 0) {
    buyPercentage = (buySignals.length / totalActiveSignals) * 100;
    sellPercentage = (sellSignals.length / totalActiveSignals) * 100;
  }
  const dominantDir = buyPercentage > sellPercentage ? "BUY" : (sellPercentage > buyPercentage ? "SELL" : "HOLD");

  // ==========================================
  // Component 1: Telegram Consensus Score
  // ==========================================
  let consensusRaw = 50;
  const agreement = Math.max(buyPercentage, sellPercentage);
  if (totalActiveSignals > 0) {
    if (agreement >= 80) consensusRaw = 100;
    else if (agreement >= 60) consensusRaw = 75;
    else if (agreement >= 50) consensusRaw = 50;
    else consensusRaw = 20;

    // Apply conflict penalty
    const conflictCount = Math.min(buySignals.length, sellSignals.length);
    if (conflictCount > 0) {
      consensusRaw = Math.max(0, consensusRaw - conflictCount * 10);
    }

    // Apply signal age decay
    const now = Date.now();
    const ages = signals.map(s => {
      const time = new Date(s.timestamp || s.createdAt || now).getTime();
      return Math.max(0, now - time);
    });
    const avgAgeMin = ages.length > 0 ? (ages.reduce((a, b) => a + b, 0) / ages.length) / 60000 : 0;
    if (avgAgeMin > 15) {
      const decay = Math.min(0.5, (avgAgeMin - 15) / 45);
      consensusRaw = consensusRaw * (1 - decay);
    }
  } else {
    consensusRaw = 0;
  }

  // ==========================================
  // Component 2: Market Intelligence Subsystem
  // ==========================================
  // Build evaluator inputs for evaluateMarketContext
  const marketIntelInputs = {
    trend: {
      trendDirection: pairState.mtfTrend || "Neutral",
      trendStrength: pairState.mtfTrend?.includes("Strong") ? "Strong" : "Weak",
      momentum: dominantDir
    },
    structure: {
      valuationZone: pairState.valuationZone || "Equilibrium",
      liquiditySweep: pairState.liquiditySweep || "Absent",
      marketRegime: pairState.valuationZone ? "Trending" : "Range"
    },
    supportResistance: {
      nearestObDistance: pairState.nearestOrderBlock ? 3.0 : 25.0,
      nearestFvgDistance: 25.0,
      obStrength: 50
    },
    session: {
      currentSession: getCurrentTradingSession(inputs.timestamp ? new Date(inputs.timestamp) : new Date()), // Resolved via centralized service
      asianRangePips: 15.0
    },
    volatility: {
      volatilityLevel: marketState.volatility || "Medium",
      atr: 1.5,
      stdDev: 1.2
    },
    spread: {
      currentSpread: marketState.spread !== undefined ? Number(marketState.spread) : 1.8,
      maxSpreadLimit: 3.0,
      marketClosed: !!marketState.marketClosed || isMarketClosed(inputs.timestamp ? new Date(inputs.timestamp) : new Date())
    }
  };

  const marketContext = evaluateMarketContext(marketIntelInputs, configOverride?.marketIntelligence);

  // ==========================================
  // Component 3: Risk Profile Raw Score
  // ==========================================
  let riskRaw = 80;
  if (riskAssessment.blocked === true) {
    riskRaw = 0;
  } else if (riskAssessment.riskGrade === "LOW_RISK") {
    riskRaw = 100;
  } else if (riskAssessment.riskGrade === "MEDIUM_RISK") {
    riskRaw = 70;
  } else if (riskAssessment.riskGrade === "HIGH_RISK") {
    riskRaw = 40;
  }

  // ==========================================
  // Component 4: Reward/Risk Ratio Score
  // ==========================================
  let rrrRaw = 70;
  const rrr = Number(riskAssessment.rrr || riskAssessment.averageRR || 1.5);
  if (rrr >= 2.0) {
    rrrRaw = 100;
  } else if (rrr >= 1.5) {
    rrrRaw = 80;
  } else if (rrr >= 1.0) {
    rrrRaw = 50;
  } else {
    rrrRaw = 10;
  }

  // Compute Weighted Score Components
  const score_consensus = consensusRaw * (weights.consensus / sumOfWeights);
  const score_mi = marketContext.overallScore * (weights.marketIntelligence / sumOfWeights);
  const score_risk = riskRaw * (weights.risk / sumOfWeights);
  const score_rrr = rrrRaw * (weights.rrr / sumOfWeights);
  const baseScore = score_consensus + score_mi + score_risk + score_rrr;

  // Apply Warning Penalties
  const penalties = -Math.min(maximumPenalty, marketContext.warnings.length * warningPenalty);
  let finalScore = Math.max(0, Math.min(100, Math.round(baseScore + penalties)));

  const sessionName = getCurrentTradingSession(inputs.timestamp ? new Date(inputs.timestamp) : new Date());
  if (sessionName === "Holiday") {
    finalScore = Math.max(0, finalScore - 20); // Reduce confidence score by 20 points
  }

  // Setup Hard Validation Blocks
  let grade = "REJECT";
  let finalDecision = "HOLD";
  const policyWarnings = [];
  if (sessionName === "Holiday") {
    policyWarnings.push("Low liquidity warning: Holiday market session");
  }

  const isClosedBlocked = policies.blockMarketClosed && marketContext.status === "CLOSED";
  const isSpreadBlocked = policies.blockSpreadBlocked && (marketContext.spread.status === "BLOCKED" || marketContext.spread.status === "WIDE");
  const isVolatilityBlocked = policies.blockExtremeVolatility && marketContext.volatility.status === "EXCESSIVE";

  if (riskAssessment.blocked === true || isClosedBlocked || isSpreadBlocked || isVolatilityBlocked) {
    grade = "REJECT";
    finalDecision = "HOLD";
    finalScore = 0;
    if (isClosedBlocked) policyWarnings.push("Trade blocked: Market is closed (Config Policy Check)");
    if (isSpreadBlocked) policyWarnings.push("Trade blocked: Wide/blocked broker spread (Config Policy Check)");
    if (isVolatilityBlocked) policyWarnings.push("Trade blocked: Excessive volatility (Config Policy Check)");
  } else {
    if (finalScore >= thresholds.gradeA) {
      grade = "GRADE A";
      finalDecision = dominantDir;
    } else if (finalScore >= thresholds.gradeB) {
      grade = "GRADE B";
      finalDecision = dominantDir;
    } else if (finalScore >= thresholds.gradeC) {
      grade = "GRADE C";
      finalDecision = dominantDir;
    } else {
      grade = "REJECT";
      finalDecision = "HOLD";
    }
  }

  // If dominant consensus direction is HOLD, decision becomes HOLD
  if (dominantDir === "HOLD" || finalDecision === "HOLD") {
    finalDecision = "HOLD";
    grade = "REJECT";
  }

  // Gather Reasons and Warnings list
  const reasons = [];
  const warnings = [
    ...marketContext.warnings,
    ...policyWarnings
  ];

  if (consensusRaw >= 80) reasons.push("Strong consensus direction");
  if (marketContext.trend.score >= 80) reasons.push("Trend aligned with direction");
  if (marketContext.structure.score >= 80) reasons.push("Favorable market structure placement");
  if (riskRaw >= 80) reasons.push("Healthy risk profile");
  if (rrrRaw >= 80) reasons.push("Healthy risk:reward ratio");
  if (marketContext.spread.score >= 80) reasons.push("Low spread");
  if (marketContext.session.score >= 80) reasons.push("High volume session");

  if (consensusRaw < 50) warnings.push("Weak consensus agreement");

  // Determine Entry, SL, and TP deterministically from signal parameters
  const entries = [];
  const stopLosses = [];
  const takeProfits = [];

  signals.forEach(s => {
    if (typeof s.entry === "number" && s.entry > 0) entries.push(s.entry);
    else if (Array.isArray(s.entryRange)) entries.push(...s.entryRange.filter(v => typeof v === "number" && v > 0));

    const slVal = s.effectiveStopLoss || s.stopLoss;
    if (typeof slVal === "number" && slVal > 0) stopLosses.push(slVal);

    if (Array.isArray(s.remainingTargets)) {
      takeProfits.push(...s.remainingTargets.filter(v => typeof v === "number" && v > 0));
    } else if (Array.isArray(s.targets)) {
      s.targets.forEach(t => {
        const val = typeof t === "object" ? t.target : t;
        if (typeof val === "number" && val > 0) takeProfits.push(val);
      });
    }
  });

  const entryClusters = findClusters(entries, 2.0);
  const slClusters = findClusters(stopLosses, 3.0);
  const tpClusters = findClusters(takeProfits, 5.0);

  let entryMin = currentPrice || 2000;
  let entryMax = entryMin;
  let sl = entryMin - 15;
  let tp = entryMax + 15;
  let moderateTp = tp + 15;
  let highRiskTp = moderateTp + 15;

  if (finalDecision === "BUY") {
    if (entryClusters.length > 0) {
      entryMin = Number(entryClusters[0].min.toFixed(2));
      entryMax = Number(entryClusters[0].max.toFixed(2));
    } else if (entries.length > 0) {
      entryMin = Number(entries[0].toFixed(2));
      entryMax = Number(entries[entries.length - 1].toFixed(2));
    } else {
      entryMin = Number((currentPrice - 0.5).toFixed(2));
      entryMax = Number((currentPrice + 0.5).toFixed(2));
    }

    const midpoint = (entryMin + entryMax) / 2;

    if (slClusters.length > 0) {
      sl = Number(slClusters[0].min.toFixed(2));
    } else if (stopLosses.length > 0) {
      sl = Number(stopLosses[0].toFixed(2));
    } else {
      sl = Number((midpoint - 15).toFixed(2));
    }
    if (sl >= entryMin) sl = Number((entryMin - 5).toFixed(2));

    const validTps = takeProfits.filter(t => t > midpoint).sort((a, b) => a - b);
    if (validTps.length > 0) {
      tp = Number(validTps[0].toFixed(2));
      moderateTp = Number((validTps[1] || tp + 10).toFixed(2));
      highRiskTp = Number((validTps[2] || moderateTp + 10).toFixed(2));
    } else {
      tp = Number((midpoint + 15).toFixed(2));
      moderateTp = Number((tp + 10).toFixed(2));
      highRiskTp = Number((moderateTp + 10).toFixed(2));
    }

    if (tp >= moderateTp) moderateTp = Number((tp + 5).toFixed(2));
    if (moderateTp >= highRiskTp) highRiskTp = Number((moderateTp + 5).toFixed(2));

  } else if (finalDecision === "SELL") {
    if (entryClusters.length > 0) {
      entryMin = Number(entryClusters[0].min.toFixed(2));
      entryMax = Number(entryClusters[0].max.toFixed(2));
    } else if (entries.length > 0) {
      entryMin = Number(entries[entries.length - 1].toFixed(2));
      entryMax = Number(entries[0].toFixed(2));
    } else {
      entryMin = Number((currentPrice - 0.5).toFixed(2));
      entryMax = Number((currentPrice + 0.5).toFixed(2));
    }

    const midpoint = (entryMin + entryMax) / 2;

    if (slClusters.length > 0) {
      sl = Number(slClusters[0].max.toFixed(2));
    } else if (stopLosses.length > 0) {
      sl = Number(stopLosses[0].toFixed(2));
    } else {
      sl = Number((midpoint + 15).toFixed(2));
    }
    if (sl <= entryMax) sl = Number((entryMax + 5).toFixed(2));

    const validTps = takeProfits.filter(t => t < midpoint).sort((a, b) => b - a);
    if (validTps.length > 0) {
      tp = Number(validTps[0].toFixed(2));
      moderateTp = Number((validTps[1] || tp - 10).toFixed(2));
      highRiskTp = Number((validTps[2] || moderateTp - 10).toFixed(2));
    } else {
      tp = Number((midpoint - 15).toFixed(2));
      moderateTp = Number((tp - 10).toFixed(2));
      highRiskTp = Number((moderateTp - 10).toFixed(2));
    }

    if (tp <= moderateTp) moderateTp = Number((tp - 5).toFixed(2));
    if (moderateTp <= highRiskTp) highRiskTp = Number((moderateTp - 5).toFixed(2));
  }

  const tradeQuality = grade === "GRADE A" ? "Excellent" : (grade === "GRADE B" ? "Good" : (grade === "GRADE C" ? "Average" : "Poor"));

  const recommendation = {
    pair: "XAUUSD",
    direction: finalDecision,
    entryMin: finalDecision === "HOLD" ? 0 : entryMin,
    entryMax: finalDecision === "HOLD" ? 0 : entryMax,
    sl: finalDecision === "HOLD" ? null : sl,
    tp: finalDecision === "HOLD" ? null : tp,
    moderateTp: finalDecision === "HOLD" ? null : moderateTp,
    highRiskTp: finalDecision === "HOLD" ? null : highRiskTp,
    tradeQuality,
    confidence: finalScore,
    estimatedHoldingTime: "30-60 min",
    tradeStyle: "Intraday",
    reasoning: reasons
  };

  const decisionBreakdown = {
    telegramConsensus: Math.round(score_consensus * 100) / 100,
    marketIntelligence: Math.round(score_mi * 100) / 100,
    risk: Math.round(score_risk * 100) / 100,
    rewardRisk: Math.round(score_rrr * 100) / 100,
    penalties,
    finalScore
  };

  let mlAdvisory = { trained: false, status: "UNTRAINED" };
  try {
    const { evaluateOpportunity } = await import("./phoenixMachineLearningEngine.js");
    mlAdvisory = await evaluateOpportunity(inputs);
  } catch (err) {
    logger.warn("decision_engine.ml_advisory_failed", { error: err.message });
  }

  const response = {
    status: "success",
    decision: finalDecision,
    grade,
    score: finalScore,
    confidence: finalScore,
    recommendation,
    decisionBreakdown,
    reasons,
    warnings,
    subsystemScores: decisionBreakdown,
    marketContext,
    mlAdvisory,
    metadata: {
      sumOfWeights,
      weightsUsed: weights,
      thresholdsUsed: thresholds,
      warningPenalty,
      maximumPenalty,
      policies
    },
    timestamp: new Date().toISOString()
  };

  return deepFreeze(response);
}

/**
 * Legacy wrapper mapping positional arguments to evaluateMarketOpportunity named inputs.
 */
export async function evaluateDecision(pair, pairState, activeOpportunities, marketPrice, options = {}) {
  const signals = pairState?.activeSignals || pairState?.signals || [];
  const currentPrice = marketPrice?.price || 0;
  
  // Calculate raw buy / sell percentages
  const buySignals = signals.filter(s => s.action === "BUY");
  const sellSignals = signals.filter(s => s.action === "SELL");
  const totalActive = buySignals.length + sellSignals.length;

  let buyPercentage = pairState?.buyConfidence !== undefined ? Number(pairState.buyConfidence) : 50;
  let sellPercentage = pairState?.sellConfidence !== undefined ? Number(pairState.sellConfidence) : 50;
  if (totalActive > 0 && pairState?.buyConfidence === undefined) {
    buyPercentage = (buySignals.length / totalActive) * 100;
    sellPercentage = (sellSignals.length / totalActive) * 100;
  }

  let dominantDir = pairState?.marketDirection || (buyPercentage > sellPercentage ? "BUY" : (sellPercentage > buyPercentage ? "SELL" : "HOLD"));
  if (dominantDir === "NEUTRAL" || dominantDir === "HOLD") {
    if (buyPercentage > sellPercentage) {
      dominantDir = "BUY";
    } else if (sellPercentage > buyPercentage) {
      dominantDir = "SELL";
    } else if (signals.length > 0) {
      dominantDir = signals[0].action || "HOLD";
    } else {
      dominantDir = "HOLD";
    }
  }

  const decisionInputs = {
    parsedSignals: signals,
    pairState: {
      direction: dominantDir,
      liquidityStatus: "Clear",
      valuationZone: "Discount",
      mtfTrend: pairState?.mtfTrend || "Neutral"
    },
    consensus: {
      buyConfidence: buyPercentage,
      sellConfidence: sellPercentage,
      totalActive
    },
    marketState: {
      currentPrice: currentPrice,
      volatility: "Normal",
      spread: 1.5
    },
    riskAssessment: {
      blocked: false,
      riskGrade: "LOW_RISK",
      rrr: 1.5
    },
    marketContext: {
      mtfTrend: pairState?.mtfTrend || "Neutral"
    },
    newsContext: {
      highImpactEvents: []
    }
  };

  const res = await evaluateMarketOpportunity(decisionInputs);
  
  const legacyResponse = {
    pair: pair,
    decision: res.decision,
    entryRange: {
      low: res.recommendation.entryMin,
      high: res.recommendation.entryMax
    },
    priceSnapshot: currentPrice,
    stopLoss: res.recommendation.sl,
    takeProfits: res.recommendation.tp !== null ? [res.recommendation.tp, res.recommendation.moderateTp, res.recommendation.highRiskTp] : [],
    confidence: res.confidence,
    grade: res.grade,
    subsystemScores: res.subsystemScores,
    marketContext: res.marketContext
  };

  return deepFreeze(legacyResponse);
}
