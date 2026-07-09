import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import mongoose from "mongoose";

// State-based Circuit Breaker & Telemetry State
const stats = {
  "gemini-2.5-flash": {
    requestsToday: 0,
    successfulRequestsToday: 0,
    failedRequestsToday: 0,
    latencySum: 0,
    latencyCount: 0,
    consecutiveFailures: 0,
    lastSuccessfulRequest: null,
    lastFailure: null,
    status: "HEALTHY",
    cooldownStart: null
  },
  "gemini-2.5-flash-lite": {
    requestsToday: 0,
    successfulRequestsToday: 0,
    failedRequestsToday: 0,
    latencySum: 0,
    latencyCount: 0,
    consecutiveFailures: 0,
    lastSuccessfulRequest: null,
    lastFailure: null,
    status: "HEALTHY",
    cooldownStart: null
  },
  fallbacksCount: 0,
  cacheAccessCount: 0,
  lastResetDate: new Date().toDateString()
};

/**
 * Reset counters automatically at the start of a new day.
 */
export function checkDailyReset() {
  const today = new Date().toDateString();
  if (stats.lastResetDate !== today) {
    for (const m of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
      stats[m].requestsToday = 0;
      stats[m].successfulRequestsToday = 0;
      stats[m].failedRequestsToday = 0;
      stats[m].consecutiveFailures = 0;
      stats[m].status = "HEALTHY";
      stats[m].cooldownStart = null;
    }
    stats.lastResetDate = today;
    logger.info("AI Model Manager: Daily request counters reset successfully.");
  }
}

/**
 * Returns the diagnostic telemetry stats of the AI Model Manager.
 * @returns {Object} Diagnostics stats
 */
export function getModelManagerDiagnostics() {
  checkDailyReset();

  const getAvgLatency = (modelName) => {
    const s = stats[modelName];
    return s.latencyCount > 0 ? Number((s.latencySum / s.latencyCount).toFixed(0)) : 0;
  };

  const getSuccessRate = (modelName) => {
    const s = stats[modelName];
    if (s.requestsToday === 0) return 100;
    return Number(((s.successfulRequestsToday / s.requestsToday) * 100).toFixed(1));
  };

  const flashUsed = stats["gemini-2.5-flash"].requestsToday;
  const liteUsed = stats["gemini-2.5-flash-lite"].requestsToday;
  let mostUsed = "None";
  if (flashUsed > liteUsed) mostUsed = "gemini-2.5-flash";
  else if (liteUsed > flashUsed) mostUsed = "gemini-2.5-flash-lite";
  else if (flashUsed > 0) mostUsed = "Equal (Both used)";

  return {
    models: {
      "gemini-2.5-flash": {
        modelName: "gemini-2.5-flash",
        status: stats["gemini-2.5-flash"].status,
        requestsToday: stats["gemini-2.5-flash"].requestsToday,
        successfulRequestsToday: stats["gemini-2.5-flash"].successfulRequestsToday,
        failedRequestsToday: stats["gemini-2.5-flash"].failedRequestsToday,
        successRate: getSuccessRate("gemini-2.5-flash"),
        consecutiveFailures: stats["gemini-2.5-flash"].consecutiveFailures,
        avgLatencyMs: getAvgLatency("gemini-2.5-flash"),
        lastSuccessfulRequest: stats["gemini-2.5-flash"].lastSuccessfulRequest,
        lastFailure: stats["gemini-2.5-flash"].lastFailure,
        fallbackCount: stats.fallbacksCount,
        circuitBreakerState: stats["gemini-2.5-flash"].status
      },
      "gemini-2.5-flash-lite": {
        modelName: "gemini-2.5-flash-lite",
        status: stats["gemini-2.5-flash-lite"].status,
        requestsToday: stats["gemini-2.5-flash-lite"].requestsToday,
        successfulRequestsToday: stats["gemini-2.5-flash-lite"].successfulRequestsToday,
        failedRequestsToday: stats["gemini-2.5-flash-lite"].failedRequestsToday,
        successRate: getSuccessRate("gemini-2.5-flash-lite"),
        consecutiveFailures: stats["gemini-2.5-flash-lite"].consecutiveFailures,
        avgLatencyMs: getAvgLatency("gemini-2.5-flash-lite"),
        lastSuccessfulRequest: stats["gemini-2.5-flash-lite"].lastSuccessfulRequest,
        lastFailure: stats["gemini-2.5-flash-lite"].lastFailure,
        fallbackCount: stats.fallbacksCount,
        circuitBreakerState: stats["gemini-2.5-flash-lite"].status
      }
    },
    fallbacksCount: stats.fallbacksCount,
    cacheAccessCount: stats.cacheAccessCount,
    mostUsedModel: mostUsed
  };
}

/**
 * Helper to query and serialize the latest valid recommendation from Cache.
 * @returns {Promise<{ json: string, cacheAgeSeconds: number, cacheExpired: boolean, originalGeneratedAt: string, originalModel: string }|null>} cached recommendation details or null
 */
async function queryCachedRecommendation() {
  try {
    if (mongoose.connection.readyState !== 1) {
      logger.warn("AI Model Manager: MongoDB is not connected. Cannot fetch cached recommendation.");
      return null;
    }
    const fallback = await AiRecommendationOutcome.findOne({
      pair: "XAUUSD",
      status: { $ne: "PENDING" }
    }).sort({ createdAt: -1 }).lean();

    if (fallback) {
      const generatedAt = fallback.createdAt || fallback.updatedAt || new Date();
      const cacheAgeSeconds = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000);
      const expirationMin = Number(config.signalExpirationMinutes) || 60;
      const cacheExpired = cacheAgeSeconds >= (expirationMin * 60);

      if (cacheExpired) {
        logger.warn(`AI Model Manager Cache Warning: Served recommendation is stale (Age: ${cacheAgeSeconds}s, Limit: ${expirationMin * 60}s).`);
      }

      const mockRec = {
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
        status: "active"
      };

      return {
        json: JSON.stringify(mockRec),
        cacheAgeSeconds,
        cacheExpired,
        originalGeneratedAt: generatedAt.toISOString ? generatedAt.toISOString() : new Date(generatedAt).toISOString(),
        originalModel: fallback.geminiModel || "unknown"
      };
    }
  } catch (err) {
    logger.warn("AI Model Manager: Failed to retrieve cached recommendation from DB", { error: err.message });
  }
  return null;
}

/**
 * Calls Gemini API with automatic fallback logic.
 * @param {string} prompt - Prompt to pass to the model.
 * @param {string} reqId - Correlation request ID.
 * @param {number} startT - Timestamp when generation tick started.
 * @param {Function} logStage - Stage logging utility function.
 * @returns {Promise<{ textResponse: string, modelUsed: string, responseSource: string, requestId: string, generatedAt: string, latencyMs: number, fallbackCount: number, cacheAgeSeconds?: number, cacheExpired?: boolean, originalGeneratedAt?: string, originalModel?: string }>} Result
 */
export async function callGeminiWithFallback(prompt, reqId, startT, logStage) {
  checkDailyReset();

  const models = [
    config.models.primary || "gemini-2.5-flash",
    config.models.secondary || "gemini-2.5-flash-lite"
  ];

  let lastError = null;
  const overallStart = Date.now();

  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    const modelState = stats[modelName];

    // Evaluate Circuit Breaker State & Cooldowns
    if (modelState.status === "DISABLED") {
      const cooldownLimit = Number(process.env.CB_COOLDOWN_MS) || 600000;
      const elapsed = Date.now() - modelState.cooldownStart;
      if (elapsed >= cooldownLimit) {
        modelState.status = "HALF_OPEN";
        modelState.cooldownStart = null;
        logger.info(`[req: ${reqId}] AI Model Manager: ${modelName} cooldown expired. Transitioned to HALF_OPEN for trial request.`);
      } else {
        logger.warn(`[req: ${reqId}] AI Model Manager: Skipping ${modelName} - Circuit Breaker is active (${Math.ceil((cooldownLimit - elapsed) / 1000)}s remaining).`);
        if (i < models.length - 1) {
          stats.fallbacksCount++;
          continue;
        } else {
          break; // Fallback directly to Cache
        }
      }
    }

    const apiVersion = "v1beta"; 
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${config.geminiApiKey}`;

    if (config.enableModelTelemetry) {
      logger.info(`[req: ${reqId}] AI Model Manager: Attempting ${modelName} (${apiVersion})`);
    }

    const generationConfig = {
      responseMimeType: "application/json"
    };

    const modelStart = Date.now();
    modelState.requestsToday++;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - modelStart;

      modelState.latencySum += latency;
      modelState.latencyCount++;

      const status = response.status;
      const success = response.ok;

      if (config.enableModelTelemetry) {
        logger.info(`[req: ${reqId}] AI Model Attempt - Model: ${modelName}, Status: ${status}, Latency: ${latency}ms, Success: ${success}`);
      }

      const isRetryableStatus = [429, 500, 502, 503, 504].includes(status);

      if (isRetryableStatus) {
        const errorText = await response.text();
        logger.warn(`[req: ${reqId}] AI Model: ${modelName} failed with retryable status: ${status}`, { error: errorText });

        // Update failure metrics & handle state transition
        modelState.failedRequestsToday++;
        modelState.consecutiveFailures++;
        modelState.lastFailure = new Date().toISOString();

        if (modelState.consecutiveFailures >= (Number(process.env.CB_MAX_FAILURES) || 3)) {
          modelState.status = "DISABLED";
          modelState.cooldownStart = Date.now();
          logger.error(`[req: ${reqId}] AI Model Manager: ${modelName} DISABLED. Circuit Breaker activated.`);
        } else {
          modelState.status = "DEGRADED";
        }

        if (logStage) {
          logStage(reqId, 6, `Gemini HTTP response received (${modelName})`, false, startT, `Retryable status ${status}`);
        }

        if (config.enableModelFallback && i < models.length - 1) {
          stats.fallbacksCount++;
          logger.info(`[req: ${reqId}] Fallback triggered. Next model selected: ${models[i + 1]}`);
          continue;
        } else {
          throw new Error(`MODEL_FAILED_${status}`);
        }
      }

      if (!success) {
        const errorText = await response.text();
        logger.error(`[req: ${reqId}] AI Model: ${modelName} failed with non-retryable status: ${status}`, { error: errorText });
        modelState.failedRequestsToday++;
        modelState.lastFailure = new Date().toISOString();
        throw new Error(`API_ERROR_${status}: ${errorText}`);
      }

      const data = await response.json();
      const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        logger.error(`[req: ${reqId}] AI Model: ${modelName} returned empty candidates`);
        modelState.failedRequestsToday++;
        modelState.lastFailure = new Date().toISOString();
        throw new Error("EMPTY_RESPONSE_CANDIDATES");
      }

      // Success transition
      modelState.successfulRequestsToday++;
      modelState.consecutiveFailures = 0;
      modelState.status = "HEALTHY";
      modelState.lastSuccessfulRequest = new Date().toISOString();

      const responseSource = modelName === "gemini-2.5-flash" ? "GEMINI_FLASH" : "GEMINI_FLASH_LITE";
      return {
        textResponse,
        modelUsed: modelName,
        responseSource,
        requestId: reqId,
        generatedAt: new Date().toISOString(),
        latencyMs: Date.now() - overallStart,
        fallbackCount: stats.fallbacksCount
      };

    } catch (err) {
      const latency = Date.now() - modelStart;
      const isTimeout = err.name === "AbortError";
      const isRetryableException = isTimeout || 
        err.message === "fetch failed" || 
        err.code === "ECONNRESET" || 
        err.code === "ECONNREFUSED" || 
        err.code === "ENOTFOUND";

      logger.warn(`[req: ${reqId}] AI Model: ${modelName} threw exception: ${err.message} (Retryable: ${isRetryableException})`);
      lastError = err;

      // Track exception failure
      modelState.failedRequestsToday++;
      modelState.consecutiveFailures++;
      modelState.lastFailure = new Date().toISOString();

      if (modelState.consecutiveFailures >= (Number(process.env.CB_MAX_FAILURES) || 3)) {
        modelState.status = "DISABLED";
        modelState.cooldownStart = Date.now();
      } else {
        modelState.status = "DEGRADED";
      }

      if (config.enableModelFallback && isRetryableException && i < models.length - 1) {
        stats.fallbacksCount++;
        logger.info(`[req: ${reqId}] Fallback triggered after exception. Next model selected: ${models[i + 1]}`);
        continue;
      }
    }
  }

  // Final cache fallback
  logger.warn(`[req: ${reqId}] AI Model Manager: All Gemini models failed. Attempting final cache lookup.`);
  
  const cacheData = await queryCachedRecommendation();
  if (cacheData) {
    stats.cacheAccessCount++;
    logger.info(`[req: ${reqId}] AI Model Manager: Serving cached recommendation.`);
    return {
      textResponse: cacheData.json,
      modelUsed: "cached",
      responseSource: "CACHE",
      requestId: reqId,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - overallStart,
      fallbackCount: stats.fallbacksCount,
      cacheAgeSeconds: cacheData.cacheAgeSeconds,
      cacheExpired: cacheData.cacheExpired,
      originalGeneratedAt: cacheData.originalGeneratedAt,
      originalModel: cacheData.originalModel
    };
  }

  throw lastError || new Error("ALL_MODELS_AND_CACHE_FAILED");
}
