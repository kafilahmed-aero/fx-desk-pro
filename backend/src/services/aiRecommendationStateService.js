import crypto from "crypto";
import { config } from "../config/env.js";
import { getXauusdRecommendation, getActiveXauusdSignals } from "./geminiAdvisorService.js";
import { getXauusdNewsContext } from "./xauusdNewsService.js";
import { getCurrentPrice } from "./priceIngestionService.js";
import { logger } from "../utils/logger.js";
import { isAiTradingSessionActive, hasEmergencyMacroEvent } from "./tradingSessionService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";

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
/**
 * Event-driven recommendation checker.
 */
export function logStage(requestId, stageNum, stageName, success, startTime, errMsg = "") {
  const duration = Date.now() - startTime;
  logger.info(`
==============================
STAGE ${stageNum}
Component: AI Recommendation Pipeline
Function: ${stageName}
Entered: YES
Execution time: ${duration} ms
Returned value: ${success ? "SUCCESS" : "FAILURE"}
Request ID: ${requestId}
Timestamp: ${new Date().toISOString()}
Exception: ${errMsg || "None"}
==============================`);
}

async function executeRecommendationGeneration(triggerSource, reqId, tickStartTime, activeSignals, currentSignalHash, currentNewsHash, currentPrice) {
  state.currentStageNum = 2;
  state.currentStageName = "Recommendation generation started";
  logStage(reqId, 2, "Recommendation generation started", true, tickStartTime);

  let recommendation = null;
  let timedOut = false;

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error("GENERATION_TIMEOUT"));
    }, 30000);
  });

  const generationPromise = (async () => {
    const res = await getXauusdRecommendation(triggerSource, reqId, tickStartTime);
    return res;
  })();

  try {
    recommendation = await Promise.race([generationPromise, timeoutPromise]);
    clearTimeout(timeoutId);

    if (recommendation && recommendation.status === "error") {
      throw new Error(recommendation.message || "Gemini returned error status");
    }

    // Update in-memory cache
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

    state.currentStageNum = 10;
    state.currentStageName = "In-memory cache updated";
    logStage(reqId, 10, "In-memory cache updated", true, tickStartTime);

    // Trigger Telegram notification dynamically to avoid circular references
    import("./aiRecommendationNotificationService.js").then((mod) => {
      mod.sendAiRecommendationIfChanged(recommendation).catch((err) => {
        logger.warn("ai_state.notification_trigger_failed", { error: err.message });
      });
    }).catch(() => {});

  } catch (err) {
    clearTimeout(timeoutId);
    const stoppedStage = state.currentStageName || "Unknown stage";
    const isTimeout = err.message === "GENERATION_TIMEOUT" || timedOut;
    const errMsg = isTimeout
      ? `Generation exceeded 30 seconds limit. Stopped at stage: ${stoppedStage}`
      : `Generation failed at stage [${stoppedStage}]: ${err.message}`;

    logStage(reqId, state.currentStageNum, state.currentStageName, false, tickStartTime, errMsg);

    // Fall back to most recent valid recommendation
    logger.info("ai_state.falling_back_to_latest_valid", { stoppedStage });
    try {
      let fallback = null;
      try {
        fallback = await AiRecommendationOutcome.findOne({
          pair: "XAUUSD",
          status: { $ne: "PENDING" }
        }).sort({ createdAt: -1 }).lean();
      } catch (dbErr) {
        logger.warn("ai_state.fallback_query_failed", { error: dbErr.message });
      }

      if (fallback) {
        state.lastRecommendation = {
          recommendationId: fallback.recommendationId,
          pair: fallback.pair,
          direction: fallback.direction,
          entryMin: fallback.entryMin,
          entryMax: fallback.entryMax,
          sl: fallback.sl,
          tp: fallback.lowRiskTp || fallback.tp,
          moderateTp: fallback.moderateTp,
          highRiskTp: fallback.highRiskTp,
          tradeQuality: fallback.tradeQuality,
          confidence: fallback.confidence,
          reasoning: fallback.reasoning || [],
          status: "active",
          requestId: reqId
        };
        logger.info("ai_state.fallback_applied_successfully", { recommendationId: fallback.recommendationId });
      } else {
        state.lastRecommendation = {
          recommendationId: `FALLBACK-HOLD-${reqId}`,
          pair: "XAUUSD",
          direction: "HOLD",
          entryMin: currentPrice || 0,
          entryMax: currentPrice || 0,
          sl: null,
          tp: null,
          confidence: 50,
          reasoning: ["System encountered an error during generation. Defaulting to HOLD."],
          status: "active",
          requestId: reqId
        };
        logger.info("ai_state.default_hold_fallback_applied");
      }
      state.lastGenerationTime = new Date().toISOString();
    } catch (fallbackErr) {
      logger.error("ai_state.fallback_completely_failed", { error: fallbackErr.message });
    }
  }
}

export async function generateRecommendationIfNeeded(triggerSource, triggerData) {
  if (generationInProgress) {
    logger.debug("ai_state.generation_skipped_in_progress");
    return;
  }

  generationInProgress = true;
  const requestId = crypto.randomUUID();
  const tickStartTime = Date.now();
  state.lastRequestId = requestId;
  state.currentStageNum = 1;
  state.currentStageName = `${triggerSource} trigger check started`;
  logStage(requestId, 1, `${triggerSource} trigger check started`, true, tickStartTime);

  try {
    const priceInfo = await getCurrentPrice("XAUUSD");
    const currentPrice = priceInfo ? priceInfo.price : null;

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
      logger.warn("ai_state.fetch_news_failed", { error: err.message });
    }
    const newsString = JSON.stringify(newsContext);
    const currentNewsHash = hashString(newsString);

    const sessionActive = isAiTradingSessionActive();
    const hasOverride = hasEmergencyMacroEvent(newsContext);

    if (!sessionActive && !hasOverride) {
      logger.info("ai_state.skipped_outside_session", {
        triggerSource,
        currentPrice,
        message: "AI generation skipped: outside London-US session"
      });
      generationInProgress = false;
      return;
    }

    let shouldGenerate = false;
    const reasons = [];

    if (!state.lastRecommendation) {
      shouldGenerate = true;
      reasons.push("INITIALIZATION");
    } else {
      if (currentSignalHash !== state.lastSignalHash) {
        shouldGenerate = true;
        reasons.push("SIGNAL_CHANGE");
      }
      if (currentPrice !== null && state.lastGoldPrice !== null) {
        const priceDiff = Math.abs(currentPrice - state.lastGoldPrice);
        if (priceDiff >= 5.0) {
          shouldGenerate = true;
          reasons.push(`MARKET_MOVE_BY_${priceDiff.toFixed(2)}`);
        }
      }
      if (currentNewsHash !== state.lastNewsHash) {
        shouldGenerate = true;
        reasons.push("NEWS_CHANGE");
      }
    }

    if (shouldGenerate) {
      await executeRecommendationGeneration(
        triggerSource,
        requestId,
        tickStartTime,
        activeSignals,
        currentSignalHash,
        currentNewsHash,
        currentPrice
      );
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

export async function runAiRecommendationCycle() {
  const requestId = crypto.randomUUID();
  const tickStartTime = Date.now();
  state.lastRequestId = requestId;
  state.currentStageNum = 1;
  state.currentStageName = "Scheduler tick started";
  logStage(requestId, 1, "Scheduler tick started", true, tickStartTime);

  if (generationInProgress) {
    logger.info("Generation skipped: generation in progress");
    return;
  }

  generationInProgress = true;

  try {
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

      await executeRecommendationGeneration(
        "SCHEDULER",
        requestId,
        tickStartTime,
        activeSignals,
        currentSignalHash,
        currentNewsHash,
        currentPrice
      );
    } else {
      logger.info("Generation skipped: current recommendation is still valid");
    }
  } catch (err) {
    logger.error("Scheduler run failed", { error: err.message });
  } finally {
    generationInProgress = false;
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
