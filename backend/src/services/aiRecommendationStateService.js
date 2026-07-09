import crypto from "crypto";
import { config } from "../config/env.js";
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
  lastSignalHash: null,
  signalsUsed: 0,
  newestSignalTime: null,
  oldestSignalTime: null
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

      const recommendation = await getXauusdRecommendation(triggerSource);

      if (recommendation && recommendation.status === "error") {
        logger.warn("ai_state.generation_failed_retaining_last", { error: recommendation.message });
        // Retain previous recommendation as per failure handling guidelines
      } else {
        state.lastRecommendation = recommendation;
        state.lastGenerationTime = new Date().toISOString();
        state.lastGoldPrice = currentPrice;
        state.lastSignalHash = currentSignalHash;
        state.lastNewsHash = currentNewsHash;

        state.signalsUsed = activeSignals.length;
        if (activeSignals.length > 0) {
          const times = activeSignals.map(s => new Date(s.timestamp || s.createdAt || Date.now()).getTime());
          state.newestSignalTime = new Date(Math.max(...times)).toISOString();
          state.oldestSignalTime = new Date(Math.min(...times)).toISOString();
        } else {
          state.newestSignalTime = null;
          state.oldestSignalTime = null;
        }

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

let schedulerInterval = null;

export async function runAiRecommendationCycle() {
  logger.info("AI scheduler tick");
  
  if (generationInProgress) {
    logger.info("Generation skipped: generation in progress");
    return;
  }
  
  const sessionActive = isAiTradingSessionActive();
  logger.info(`Session active: ${sessionActive ? "YES" : "NO"}`);
  
  if (!sessionActive) {
    logger.info("Generation skipped: outside session hours");
    return;
  }
  
  const recExists = Boolean(state.lastRecommendation);
  logger.info(`Recommendation exists: ${recExists ? "YES" : "NO"}`);
  
  let shouldGenerate = false;
  let reason = "";
  
  if (!recExists) {
    shouldGenerate = true;
    reason = "no recommendation exists";
  } else {
    const lastTime = state.lastGenerationTime ? new Date(state.lastGenerationTime).getTime() : 0;
    const ageMinutes = (Date.now() - lastTime) / 60000;
    const expirationMin = config.signalExpirationMinutes || 60;
    const isExpired = ageMinutes >= expirationMin;
    
    if (isExpired) {
      shouldGenerate = true;
      reason = `recommendation expired (age: ${ageMinutes.toFixed(1)} mins, limit: ${expirationMin} mins)`;
    }
  }
  
  if (shouldGenerate) {
    logger.info(`Generation started: ${reason}`);
    generationInProgress = true;
    try {
      const activeSignals = await getActiveXauusdSignals();
      const signalsString = JSON.stringify(activeSignals.map(s => ({
        id: s._id || s.messageId,
        state: s.signalState,
        timestamp: s.timestamp
      })));
      const currentSignalHash = hashString(signalsString);
      
      let newsContext = { highImpactEvents: [], goldNews: [] };
      try {
        newsContext = await getXauusdNewsContext();
      } catch (err) {
        logger.warn("ai_state.scheduler_fetch_news_failed", { error: err.message });
      }
      const newsString = JSON.stringify(newsContext);
      const currentNewsHash = hashString(newsString);
      
      const priceInfo = await getCurrentPrice("XAUUSD");
      const currentPrice = priceInfo ? priceInfo.price : null;

      const recommendation = await getXauusdRecommendation("SCHEDULER");
      
      if (recommendation && recommendation.status === "error") {
        logger.info(`Generation finished: failed with error: ${recommendation.message}`);
      } else {
        state.lastRecommendation = recommendation;
        state.lastGenerationTime = new Date().toISOString();
        state.lastGoldPrice = currentPrice;
        state.lastSignalHash = currentSignalHash;
        state.lastNewsHash = currentNewsHash;
        state.signalsUsed = activeSignals.length;
        
        if (activeSignals.length > 0) {
          const times = activeSignals.map(s => new Date(s.timestamp || s.createdAt || Date.now()).getTime());
          state.newestSignalTime = new Date(Math.max(...times)).toISOString();
          state.oldestSignalTime = new Date(Math.min(...times)).toISOString();
        } else {
          state.newestSignalTime = null;
          state.oldestSignalTime = null;
        }
        
        logger.info("Generation finished: success");
        
        import("./aiRecommendationNotificationService.js").then((mod) => {
          mod.sendAiRecommendationIfChanged(recommendation).catch((err) => {
            logger.warn("ai_state.notification_trigger_failed", { error: err.message });
          });
        }).catch(() => {});
      }
    } catch (err) {
      logger.error("Generation finished: failed with error", { error: err.message });
    } finally {
      generationInProgress = false;
    }
  } else {
    logger.info("Generation skipped: current recommendation is still valid");
  }
}

export function startAiRecommendationScheduler(intervalMs = 60000) {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(runAiRecommendationCycle, intervalMs);
  logger.info("AI scheduler started", { intervalMs });
  runAiRecommendationCycle().catch((err) => {
    logger.error("AI scheduler initial run failed", { error: err.message });
  });
}

export function stopAiRecommendationScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  logger.info("AI scheduler stopped");
}
