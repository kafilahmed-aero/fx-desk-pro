import { getXauusdRecommendation } from "../services/geminiAdvisorService.js";
import { getLastRecommendation, getRecommendationState, logStage } from "../services/aiRecommendationStateService.js";
import { isAiTradingSessionActive, hasEmergencyMacroEvent } from "../services/tradingSessionService.js";
import { getXauusdNewsContext } from "../services/xauusdNewsService.js";
import { getAiAnalytics } from "../services/aiAnalyticsService.js";
import { logger } from "../utils/logger.js";
import mongoose from "mongoose";
import { AiDecisionValidation } from "../models/aiDecisionValidationModel.js";
import { localValidations } from "../services/aiDecisionValidationService.js";
import { getModelManagerDiagnostics } from "../services/aiModelManager.js";

/**
 * Controller to fetch AI trade recommendation for XAUUSD.
 */
export async function getXauusdRecommendationController(req, res) {
  try {
    const recommendation = await getXauusdRecommendation();

    if (recommendation && recommendation.status === "error") {
      return res.status(503).json(recommendation);
    }

    return res.status(200).json(recommendation);
  } catch (err) {
    logger.error("api.get_xauusd_recommendation_failed", { error: err.message });
    return res.status(503).json({
      status: "error",
      message: "Gemini recommendation unavailable"
    });
  }
}

/**
 * Controller to fetch the latest cached AI trade recommendation for XAUUSD.
 */
export async function getLatestXauusdRecommendationController(req, res) {
  req.startTime = Date.now();
  try {
    const sessionActive = isAiTradingSessionActive();
    let hasOverride = false;

    if (!sessionActive) {
      try {
        const newsContext = await getXauusdNewsContext();
        hasOverride = hasEmergencyMacroEvent(newsContext);
      } catch (err) {
        logger.warn("api.latest_check_override_failed", { error: err.message });
      }
    }

    if (!sessionActive && !hasOverride) {
      return res.status(200).json({
        status: "offline",
        message: "Decision Engine Offline"
      });
    }

    const recommendation = getLastRecommendation();

    if (!recommendation) {
      return res.status(200).json({
        status: "pending",
        message: "No recommendation generated yet"
      });
    }

    const state = getRecommendationState();
    const reqId = recommendation.requestId || state.lastRequestId || "UNKNOWN-REQUEST";

    // Stage 11: API endpoint returns recommendation
    state.currentStageNum = 11;
    state.currentStageName = "API endpoint returns recommendation";
    logStage(reqId, 11, "API endpoint returns recommendation", true, req.startTime);

    return res.status(200).json({
      ...recommendation,
      lastGenerationTime: state.lastGenerationTime,
      signalsUsed: state.signalsUsed || 0,
      newestSignalTime: state.newestSignalTime || null,
      oldestSignalTime: state.oldestSignalTime || null,
      stats: {
        ...state.stats,
        callsRemaining: 20 - state.stats.geminiCallsToday
      }
    });
  } catch (err) {
    logger.error("api.get_latest_recommendation_failed", { error: err.message });
    return res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
}

/**
 * Controller to fetch AI trade analytics.
 */
export async function getAiAnalyticsController(req, res) {
  try {
    const analytics = await getAiAnalytics();
    return res.status(200).json(analytics);
  } catch (err) {
    logger.error("api.get_ai_analytics_failed", { error: err.message });
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve AI analytics"
    });
  }
}

/**
 * Controller to fetch AI Decision Validation diagnostics metrics.
 */
export async function getAiDiagnosticsController(req, res) {
  try {
    let list = [];
    if (mongoose.connection.readyState === 1) {
      list = await AiDecisionValidation.find({}).lean();
    } else {
      list = Array.from(localValidations.values());
    }

    const total = list.length;
    const buys = list.filter(r => r.finalAction === "BUY").length;
    const sells = list.filter(r => r.finalAction === "SELL").length;
    const holds = list.filter(r => r.finalAction === "HOLD").length;
    const holdPct = total > 0 ? Number(((holds / total) * 100).toFixed(1)) : 0;

    const confidences = list.map(r => r.consensusConfidence || 0);
    const avgConfidence = confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(1))
      : 0;

    const latencies = list.filter(r => typeof r.generationTimeMs === "number").map(r => r.generationTimeMs);
    const avgGenerationTime = latencies.length > 0
      ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0))
      : 0;

    const contradictionCount = list.filter(r => r.consistency?.hasContradiction).length;

    // HOLD Accuracy Analysis stats
    const holdsWithAccuracy = list.filter(r => r.holdAccuracy && typeof r.holdAccuracy.holdAvoidedLosingTrade === "boolean");
    const holdAvoidedCount = holdsWithAccuracy.filter(r => r.holdAccuracy.holdAvoidedLosingTrade).length;
    const holdMissedCount = holdsWithAccuracy.filter(r => r.holdAccuracy.holdMissedProfitableTrade).length;
    const holdOptimalCount = holdsWithAccuracy.filter(r => r.holdAccuracy.holdOptimalDecision).length;
    const holdAccuracyRate = holdsWithAccuracy.length > 0
      ? Number(((holdOptimalCount / holdsWithAccuracy.length) * 100).toFixed(1))
      : 100;

    // Find the latest prompt and raw response that is actually populated
    const populated = list.filter(r => r.fullPrompt && r.rawResponse);
    const latestSample = populated.length > 0 ? populated[populated.length - 1] : null;

    return res.status(200).json({
      total,
      buys,
      sells,
      holds,
      holdPct,
      avgConfidence,
      avgGenerationTime,
      contradictionCount,
      holdStats: {
        totalEvaluated: holdsWithAccuracy.length,
        avoidedLosing: holdAvoidedCount,
        missedProfitable: holdMissedCount,
        optimalCount: holdOptimalCount,
        accuracyRate: holdAccuracyRate
      },
      latestPrompt: latestSample ? latestSample.fullPrompt : "No prompt sampled yet",
      latestRawResponse: latestSample ? latestSample.rawResponse : "No response sampled yet",
      modelManager: getModelManagerDiagnostics()
    });
  } catch (err) {
    logger.error("api.get_ai_diagnostics_failed", { error: err.message });
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve AI diagnostics"
    });
  }
}
