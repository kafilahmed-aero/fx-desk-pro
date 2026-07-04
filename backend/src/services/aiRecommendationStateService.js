import crypto from "crypto";
import { getXauusdRecommendation, getActiveXauusdSignals } from "./geminiAdvisorService.js";
import { getXauusdNewsContext } from "./xauusdNewsService.js";
import { getCurrentPrice } from "./priceIngestionService.js";
import { logger } from "../utils/logger.js";
import { isAiTradingSessionActive, hasEmergencyMacroEvent } from "./tradingSessionService.js";

// In-memory state storage (backend session life-cycle only)
const state = {
  lastRecommendation: null,
  lastGenerationTime: null,
  lastGoldPrice: null,
  lastNewsHash: null,
  lastSignalHash: null
};

// Lock to prevent concurrent overlapping executions
let generationInProgress = false;

/**
 * Computes MD5 hash of a serialized string
 * @param {string} str - String to hash
 * @returns {string} Hex hash string
 */
function hashString(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

/**
 * Returns the currently stored recommendation.
 * @returns {Object|null} Cached recommendation or null
 */
export function getLastRecommendation() {
  return state.lastRecommendation;
}

/**
 * Returns the active recommendation state object.
 * @returns {Object} State
 */
export function getRecommendationState() {
  return state;
}

/**
 * Event-driven recommendation checker.
 * Evaluates triggers (new signal, market price move >= $5, or news context changes),
 * invokes Gemini if needed, and maintains in-memory state.
 * @param {string} triggerSource - Source of change ("STARTUP", "NEW_SIGNAL", "PRICE_CHANGE")
 * @param {any} triggerData - Context data of the trigger event
 */
export async function generateRecommendationIfNeeded(triggerSource, triggerData) {
  if (generationInProgress) {
    logger.debug("ai_state.generation_skipped_in_progress");
    return;
  }

  generationInProgress = true;
  try {
    // 1. Fetch current price
    const priceInfo = await getCurrentPrice("XAUUSD");
    const currentPrice = priceInfo ? priceInfo.price : null;

    // 2. Fetch active signals and hash them
    const activeSignals = await getActiveXauusdSignals();
    const signalsString = JSON.stringify(activeSignals.map(s => ({
      id: s._id || s.messageId,
      state: s.signalState,
      timestamp: s.timestamp
    })));
    const currentSignalHash = hashString(signalsString);

    // 3. Fetch news context and hash it
    let newsContext = { highImpactEvents: [], goldNews: [] };
    try {
      newsContext = await getXauusdNewsContext();
    } catch (err) {
      logger.warn("ai_state.fetch_news_failed", { error: err.message });
    }
    const newsString = JSON.stringify(newsContext);
    const currentNewsHash = hashString(newsString);

    // Enforce trading session window or emergency overrides
    const sessionActive = isAiTradingSessionActive();
    const hasOverride = hasEmergencyMacroEvent(newsContext);

    if (!sessionActive && !hasOverride) {
      logger.info("ai_state.skipped_outside_session", {
        triggerSource,
        currentPrice,
        message: "AI generation skipped: outside London-US session"
      });
      return;
    }

    // 4. Evaluate triggers
    let shouldGenerate = false;
    const reasons = [];

    if (!state.lastRecommendation) {
      shouldGenerate = true;
      reasons.push("INITIALIZATION");
    } else {
      // Trigger A: New Active Signal
      if (currentSignalHash !== state.lastSignalHash) {
        shouldGenerate = true;
        reasons.push("SIGNAL_CHANGE");
      }

      // Trigger B: Market move >= $5
      if (currentPrice !== null && state.lastGoldPrice !== null) {
        const priceDiff = Math.abs(currentPrice - state.lastGoldPrice);
        if (priceDiff >= 5.0) {
          shouldGenerate = true;
          reasons.push(`MARKET_MOVE_BY_${priceDiff.toFixed(2)}`);
        }
      }

      // Trigger C: News Context Change
      if (currentNewsHash !== state.lastNewsHash) {
        shouldGenerate = true;
        reasons.push("NEWS_CHANGE");
      }
    }

    if (shouldGenerate) {
      logger.info("ai_state.generating_recommendation", {
        triggerSource,
        reasons,
        currentPrice,
        signalCount: activeSignals.length
      });

      const recommendation = await getXauusdRecommendation();

      if (recommendation && recommendation.status === "error") {
        logger.warn("ai_state.generation_failed_retaining_last", { error: recommendation.message });
        // Retain previous recommendation as per failure handling guidelines
      } else {
        state.lastRecommendation = recommendation;
        state.lastGenerationTime = new Date().toISOString();
        state.lastGoldPrice = currentPrice;
        state.lastSignalHash = currentSignalHash;
        state.lastNewsHash = currentNewsHash;

        logger.info("ai_state.generation_success", {
          direction: recommendation.direction,
          entryMin: recommendation.entryMin,
          entryMax: recommendation.entryMax
        });

        // Trigger Telegram notification dynamically to avoid circular references
        import("./aiRecommendationNotificationService.js").then((mod) => {
          mod.sendAiRecommendationIfChanged(recommendation).catch((err) => {
            logger.warn("ai_state.notification_trigger_failed", { error: err.message });
          });
        }).catch(() => {});
      }
    } else {
      logger.debug("ai_state.no_generation_needed", {
        currentPrice,
        lastPrice: state.lastGoldPrice,
        signalsMatch: currentSignalHash === state.lastSignalHash,
        newsMatch: currentNewsHash === state.lastNewsHash
      });
    }

  } catch (err) {
    logger.error("ai_state.check_failed", { error: err.message });
  } finally {
    generationInProgress = false;
  }
}
