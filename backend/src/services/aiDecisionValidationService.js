import mongoose from "mongoose";
import { AiDecisionValidation } from "../models/aiDecisionValidationModel.js";
import { getPriceHistory } from "./priceIngestionService.js";
import { logger } from "../utils/logger.js";

// In-memory fallback
export const localValidations = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Calculates scorecard metrics for the recommendation cycle.
 */
function calculateScorecard(parsedRec, context) {
  const scorecard = {
    promptQualityScore: 100,
    signalQualityScore: 50,
    consensusStrength: context.consensusStrength || 50,
    trendAlignmentScore: 50,
    institutionalBiasScore: 50,
    newsRiskScore: 100,
    liquidityScore: 50,
    volatilityScore: 50,
    riskRewardScore: 50,
    finalConfidence: parsedRec?.confidence || 0,
    finalDecision: parsedRec?.direction || "HOLD"
  };

  // 1. Prompt Quality Score
  if (!context.currentPrice) scorecard.promptQualityScore -= 15;
  if (!context.macroAlignment) scorecard.promptQualityScore -= 15;
  if (!context.tradingSession) scorecard.promptQualityScore -= 10;
  if (context.activeSignalsCount === 0) scorecard.promptQualityScore -= 10;
  scorecard.promptQualityScore = Math.max(0, scorecard.promptQualityScore);

  // 2. Signal Quality Score
  const qual = context.telegramQuality || "Moderate";
  if (qual === "High") scorecard.signalQualityScore = 90;
  else if (qual === "Moderate") scorecard.signalQualityScore = 60;
  else scorecard.signalQualityScore = 30;

  // 3. Trend Alignment Score
  const momentum = context.momentumDirection || "Neutral";
  const dominant = context.directionAgreement || "Neutral";
  if (momentum !== "Neutral" && dominant !== "Neutral") {
    if (dominant.includes(momentum.toUpperCase())) {
      scorecard.trendAlignmentScore = 90;
    } else {
      scorecard.trendAlignmentScore = 15;
    }
  } else {
    scorecard.trendAlignmentScore = 50;
  }

  // 4. Institutional Bias Score
  const inst = context.institutionalBias || "Neutral";
  if (inst === "Bullish") scorecard.institutionalBiasScore = 90;
  else if (inst === "Bearish") scorecard.institutionalBiasScore = 10;
  else scorecard.institutionalBiasScore = 50;

  // 5. News Risk Score
  const newsCount = context.newsContext?.highImpactEvents?.length || 0;
  scorecard.newsRiskScore = Math.max(0, 100 - newsCount * 25);

  // 6. Liquidity Score
  const liq = context.liquidityStatus || "None";
  if (liq.includes("Sweep")) scorecard.liquidityScore = 85;
  else if (liq.includes("Equal")) scorecard.liquidityScore = 65;
  else scorecard.liquidityScore = 40;

  // 7. Volatility Score
  const vol = context.volatilityLevel || "Medium";
  if (vol === "Low") scorecard.volatilityScore = 90;
  else if (vol === "Medium") scorecard.volatilityScore = 60;
  else scorecard.volatilityScore = 20;

  // 8. Risk Reward Score
  if (parsedRec?.direction !== "HOLD" && parsedRec?.riskReward?.lowRisk) {
    const rr = parsedRec.riskReward.lowRisk;
    if (rr >= 2.0) scorecard.riskRewardScore = 90;
    else if (rr >= 1.5) scorecard.riskRewardScore = 70;
    else scorecard.riskRewardScore = 40;
  } else {
    scorecard.riskRewardScore = 50;
  }

  return scorecard;
}

/**
 * Performs logical consistency checks on Gemini recommendations.
 */
function performConsistencyCheck(parsedRec, context) {
  const contradictions = [];
  if (!parsedRec) {
    return { hasContradiction: false, contradictions };
  }

  const direction = String(parsedRec.direction || "").toUpperCase();
  const consensus = String(context.directionAgreement || "").toUpperCase();
  const thesis = String(parsedRec.explanation?.thesis || "").toLowerCase();

  // 1. Strong consensus but HOLD
  if (direction === "HOLD" && consensus.includes("STRONG")) {
    contradictions.push(`Strong signal consensus (${consensus}) but AI decided to HOLD.`);
  }

  // 2. BUY recommendation but bearish thesis text
  if (direction === "BUY") {
    if (thesis.includes("bearish") || thesis.includes("downtrend") || thesis.includes("drop")) {
      contradictions.push("BUY direction chosen but thesis contains bearish/downside indicators.");
    }
  }

  // 3. SELL recommendation but bullish thesis text
  if (direction === "SELL") {
    if (thesis.includes("bullish") || thesis.includes("uptrend") || thesis.includes("rally")) {
      contradictions.push("SELL direction chosen but thesis contains bullish/upside indicators.");
    }
  }

  return {
    hasContradiction: contradictions.length > 0,
    contradictions
  };
}

/**
 * Log a recommendation cycle validation entry.
 */
export async function logDecisionCycle(prompt, rawText, parsedRec, context) {
  try {
    const recId = parsedRec?.recommendationId || context.recommendationId;
    const finalAction = parsedRec?.direction || "HOLD";
    const confidence = parsedRec?.confidence || 0;

    const scorecard = calculateScorecard(parsedRec, context);
    const consistency = performConsistencyCheck(parsedRec, context);

    // Storage Optimization criteria
    const isContradicted = consistency.hasContradiction;
    const isLowConfidence = confidence < 50;
    const isQASample = Math.random() < 0.05;
    const isDebugMode = process.env.VALIDATION_DEBUG === "true";
    const saveFullText = isContradicted || isLowConfidence || isQASample || isDebugMode || !parsedRec;

    const expObj = parsedRec?.explanation || {};

    const validationData = {
      recommendationId: recId,
      timestamp: new Date(),
      currentPrice: context.currentPrice,
      consensusDirection: context.directionAgreement || "Neutral",
      consensusConfidence: context.consensusStrength || 0,
      buyWeight: context.buyWeight || 0,
      sellWeight: context.sellWeight || 0,
      activeSignalsCount: context.activeSignalsCount || 0,
      fullPrompt: saveFullText ? prompt : null,
      rawResponse: saveFullText ? rawText : null,
      parsedRecommendation: parsedRec,
      finalAction,
      generationTimeMs: context.generationTimeMs || null,

      scorecard,
      explanation: {
        thesis: expObj.thesis || null,
        bullishFactors: expObj.bullishFactors || [],
        bearishFactors: expObj.bearishFactors || [],
        risks: expObj.risks || [],
        invalidation: expObj.invalidation || null,
        missingInformation: expObj.missingInformation || [],
        whyNotBuy: expObj.whyNotBuy || null,
        whyNotSell: expObj.whyNotSell || null,
        whyHold: expObj.whyHold || null,
        confidenceExplanation: expObj.confidenceExplanation || null,
        triggerHoldToBuy: expObj.triggerHoldToBuy || null,
        triggerHoldToSell: expObj.triggerHoldToSell || null
      },
      consistency,
      holdAccuracy: {
        holdAvoidedLosingTrade: null,
        holdMissedProfitableTrade: null,
        holdOptimalDecision: null,
        holdRuleTriggered: null
      },
      outcomeTracking: {
        status15m: null,
        status30m: null,
        status1h: null,
        status4h: null
      }
    };

    if (isMongoConnected()) {
      await AiDecisionValidation.create(validationData);
    }
    localValidations.set(recId, validationData);

    logger.info("validation.cycle_logged", { recommendationId: recId, saveFullText });
  } catch (err) {
    logger.error("validation.log_cycle_failed", { error: err.message });
  }
}

/**
 * Calculates outcome metrics in hindsight.
 */
function evaluateHindsight(rec, prices) {
  const entryPrice = rec.currentPrice;
  if (prices.length === 0 || !entryPrice) {
    return { mfe: 0, mae: 0, bestDecision: "HOLD" };
  }

  const values = prices.map(p => p.price);
  const maxPrice = Math.max(...values);
  const minPrice = Math.min(...values);

  // Excursion stats
  const mfeBuy = maxPrice - entryPrice;
  const maeBuy = entryPrice - minPrice;
  const mfeSell = entryPrice - minPrice;
  const maeSell = maxPrice - entryPrice;

  // Hindsight optimal decision calculation ($5 move with < $2.50 drawdown)
  let bestDecision = "HOLD";
  if (mfeBuy >= 5.0 && maeBuy <= 2.50) {
    bestDecision = "BUY";
  } else if (mfeSell >= 5.0 && maeSell <= 2.50) {
    bestDecision = "SELL";
  }

  const mfe = rec.finalAction === "BUY" ? mfeBuy : (rec.finalAction === "SELL" ? mfeSell : 0);
  const mae = rec.finalAction === "BUY" ? maeBuy : (rec.finalAction === "SELL" ? maeSell : 0);

  return {
    mfe: Number(mfe.toFixed(2)),
    mae: Number(mae.toFixed(2)),
    bestDecision,
    mfeBuy,
    maeBuy,
    mfeSell,
    maeSell
  };
}

/**
 * Evaluates HOLD decision accuracy specifically.
 */
function evaluateHoldAccuracy(rec, hindsight) {
  const buyFailed = hindsight.maeBuy > 3.0; // Drawdown exceeded threshold
  const sellFailed = hindsight.maeSell > 3.0;

  // HOLD avoided a losing trade if either active side would have hit severe drawdown
  const holdAvoidedLosingTrade = buyFailed || sellFailed;

  // HOLD missed a profitable trade if an active side reached a profitable target cleanly
  const holdMissedProfitableTrade = (hindsight.mfeBuy >= 5.0 && hindsight.maeBuy <= 1.5) ||
                                    (hindsight.mfeSell >= 5.0 && hindsight.maeSell <= 1.5);

  const holdOptimalDecision = holdAvoidedLosingTrade && !holdMissedProfitableTrade;

  let holdRuleTriggered = "Standard neutral filter";
  if (rec.consensusConfidence < 50) {
    holdRuleTriggered = "Low consensus filter";
  } else if (rec.scorecard?.newsRiskScore < 50) {
    holdRuleTriggered = "High macroeconomic news risk";
  } else if (rec.scorecard?.volatilityScore < 40) {
    holdRuleTriggered = "High market volatility";
  }

  return {
    holdAvoidedLosingTrade,
    holdMissedProfitableTrade,
    holdOptimalDecision,
    holdRuleTriggered
  };
}

/**
 * Background loop to track outcomes periodically.
 */
async function processPendingOutcomes() {
  try {
    const list = isMongoConnected()
      ? await AiDecisionValidation.find({
          $or: [
            { "outcomeTracking.status15m": null },
            { "outcomeTracking.status30m": null },
            { "outcomeTracking.status1h": null },
            { "outcomeTracking.status4h": null }
          ]
        }).lean()
      : Array.from(localValidations.values());

    const now = Date.now();
    const priceHistory = getPriceHistory("XAUUSD");

    for (const rec of list) {
      const startTime = new Date(rec.timestamp).getTime();
      const ageMs = now - startTime;
      const updates = {};
      let changed = false;

      const milestones = [
        { key: "status15m", limitMs: 15 * 60 * 1000 },
        { key: "status30m", limitMs: 30 * 60 * 1000 },
        { key: "status1h", limitMs: 60 * 60 * 1000 },
        { key: "status4h", limitMs: 240 * 60 * 1000 }
      ];

      for (const m of milestones) {
        if (rec.outcomeTracking?.[m.key] === null && ageMs >= m.limitMs) {
          const pricesInRange = priceHistory.filter(
            p => p.timestamp >= startTime && p.timestamp <= startTime + m.limitMs
          );

          if (pricesInRange.length > 0) {
            const hindsight = evaluateHindsight(rec, pricesInRange);
            updates[`outcomeTracking.${m.key}`] = {
              mfe: hindsight.mfe,
              mae: hindsight.mae,
              bestDecision: hindsight.bestDecision,
              isCorrectAction: rec.finalAction === hindsight.bestDecision
            };

            // If final action was HOLD and we are at the 1 hour milestone, evaluate HOLD Accuracy
            if (rec.finalAction === "HOLD" && m.key === "status1h") {
              const holdAcc = evaluateHoldAccuracy(rec, hindsight);
              updates["holdAccuracy"] = holdAcc;
            }
            changed = true;
          }
        }
      }

      if (changed) {
        if (isMongoConnected()) {
          await AiDecisionValidation.findByIdAndUpdate(rec._id, { $set: updates });
        }
        // Update local cache
        const localRecord = localValidations.get(rec.recommendationId);
        if (localRecord) {
          Object.assign(localRecord, updates);
        }
        logger.info("validation.outcome_updated", { recommendationId: rec.recommendationId });
      }
    }
  } catch (err) {
    logger.error("validation.outcome_tracker_failed", { error: err.message });
  }
}

let outcomeInterval = null;

export function startOutcomeTracker(intervalMs = 60000) {
  if (outcomeInterval) return;
  outcomeInterval = setInterval(processPendingOutcomes, intervalMs);
  logger.info("AI Validation Outcome Tracker started", { intervalMs });
}

export function stopOutcomeTracker() {
  if (outcomeInterval) {
    clearInterval(outcomeInterval);
    outcomeInterval = null;
  }
  logger.info("AI Validation Outcome Tracker stopped");
}
