import { getXauusdRecommendation } from "../services/geminiAdvisorService.js";
import { getLastRecommendation } from "../services/aiRecommendationStateService.js";
import { isAiTradingSessionActive, hasEmergencyMacroEvent } from "../services/tradingSessionService.js";
import { getXauusdNewsContext } from "../services/xauusdNewsService.js";
import { logger } from "../utils/logger.js";

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
        message: "AI Advisor Offline"
      });
    }

    const recommendation = getLastRecommendation();

    if (!recommendation) {
      return res.status(200).json({
        status: "pending",
        message: "No recommendation generated yet"
      });
    }

    return res.status(200).json(recommendation);
  } catch (err) {
    logger.error("api.get_latest_recommendation_failed", { error: err.message });
    return res.status(500).json({
      status: "error",
      message: "Internal server error"
    });
  }
}
