import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import mongoose from "mongoose";
import { aiProviderRegistry } from "./aiProviderRegistry.js";
import { GeminiProvider } from "./geminiProvider.js";
import { MockProvider } from "./mockProvider.js";
import {
  getPrioritizedProviders,
  reportSuccess,
  reportFailure,
  getDiagnostics as getProviderDiagnostics
} from "./aiProviderManager.js";

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
 * Deep freezes an object recursively to guarantee immutability.
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
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
 * Reset counters automatically at the start of a new day.
 */
export function checkDailyReset() {
  const today = new Date().toDateString();
  if (stats.lastResetDate !== today) {
    for (const m of Object.keys(stats)) {
      if (m === "fallbacksCount" || m === "cacheAccessCount" || m === "lastResetDate") continue;
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
    return s && s.latencyCount > 0 ? Number((s.latencySum / s.latencyCount).toFixed(0)) : 0;
  };

  const getSuccessRate = (modelName) => {
    const s = stats[modelName];
    if (!s || s.requestsToday === 0) return 100;
    return Number(((s.successfulRequestsToday / s.requestsToday) * 100).toFixed(1));
  };

  const flashUsed = stats["gemini-2.5-flash"]?.requestsToday || 0;
  const liteUsed = stats["gemini-2.5-flash-lite"]?.requestsToday || 0;
  let mostUsed = "None";
  if (flashUsed > liteUsed) mostUsed = "gemini-2.5-flash";
  else if (liteUsed > flashUsed) mostUsed = "gemini-2.5-flash-lite";
  else if (flashUsed > 0) mostUsed = "Equal (Both used)";

  const modelDiags = {};
  for (const key of Object.keys(stats)) {
    if (key === "fallbacksCount" || key === "cacheAccessCount" || key === "lastResetDate") continue;
    const modelState = stats[key];
    modelDiags[key] = {
      modelName: key,
      status: modelState.status,
      requestsToday: modelState.requestsToday,
      successfulRequestsToday: modelState.successfulRequestsToday,
      failedRequestsToday: modelState.failedRequestsToday,
      successRate: getSuccessRate(key),
      consecutiveFailures: modelState.consecutiveFailures,
      avgLatencyMs: getAvgLatency(key),
      lastSuccessfulRequest: modelState.lastSuccessfulRequest,
      lastFailure: modelState.lastFailure,
      fallbackCount: stats.fallbacksCount,
      circuitBreakerState: modelState.status
    };
  }

  return {
    models: modelDiags,
    fallbacksCount: stats.fallbacksCount,
    cacheAccessCount: stats.cacheAccessCount,
    mostUsedModel: mostUsed,
    providers: getProviderDiagnostics()
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
 * Calls registered AI Provider with automatic fallback logic.
 * @param {string} prompt - Prompt to pass to the model.
 * @param {string} reqId - Correlation request ID.
 * @param {number} startT - Timestamp when generation tick started.
 * @param {Function} logStage - Stage logging utility function.
 * @returns {Promise<{ textResponse: string, modelUsed: string, responseSource: string, requestId: string, generatedAt: string, latencyMs: number, fallbackCount: number, cacheAgeSeconds?: number, cacheExpired?: boolean, originalGeneratedAt?: string, originalModel?: string }>} Result
 */
export async function callGeminiWithFallback(prompt, reqId, startT, logStage) {
  checkDailyReset();

  // Resolve prioritized providers list dynamically
  const prioritized = getPrioritizedProviders();

  const candidateModels = [];
  const configuredModels = [
    config.models.primary || "gemini-2.5-flash",
    config.models.secondary || "gemini-2.5-flash-lite"
  ];

  for (const provider of prioritized) {
    const providerId = provider.id;
    let matchedAny = false;

    for (const modelName of configuredModels) {
      let modelProviderId = "gemini";
      if (modelName.startsWith("mock")) {
        modelProviderId = "mock";
      }

      if (modelProviderId === providerId) {
        candidateModels.push({ modelName, providerId });
        matchedAny = true;
      }
    }

    if (!matchedAny) {
      if (providerId === "gemini") {
        candidateModels.push({ modelName: "gemini-2.5-flash", providerId: "gemini" });
      } else if (providerId === "mock") {
        candidateModels.push({ modelName: "mock-model", providerId: "mock" });
      } else {
        candidateModels.push({ modelName: `${providerId}-model`, providerId });
      }
    }
  }

  let lastError = null;
  const overallStart = Date.now();

  for (let i = 0; i < candidateModels.length; i++) {
    const candidate = candidateModels[i];
    const modelName = candidate.modelName;
    const providerId = candidate.providerId;

    // Ensure stats exist for dynamic/configured models
    if (!stats[modelName]) {
      stats[modelName] = {
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
      };
    }
    const modelState = stats[modelName];

    if (config.enableModelTelemetry) {
      logger.info(`[req: ${reqId}] AI Model Manager: Attempting ${modelName} via provider ${providerId}`);
    }

    const modelStart = Date.now();
    modelState.requestsToday++;

    try {
      const provider = aiProviderRegistry.getProvider(providerId);
      if (!provider) {
        throw new Error(`Provider "${providerId}" not found in registry`);
      }

      // Generate content via abstraction layer
      const response = await provider.generateContent(prompt, {
        modelName,
        requestId: reqId,
        timeoutMs: 20000,
        geminiApiKey: config.geminiApiKey
      });

      const latency = Date.now() - modelStart;
      modelState.latencySum += latency;
      modelState.latencyCount++;

      // Success transition
      modelState.successfulRequestsToday++;
      modelState.consecutiveFailures = 0;
      modelState.status = "HEALTHY";
      modelState.lastSuccessfulRequest = new Date().toISOString();

      // Report success to the provider manager state tracker
      reportSuccess(providerId);

      const responseSource = providerId === "gemini"
        ? (modelName === "gemini-2.5-flash" ? "GEMINI_FLASH" : "GEMINI_FLASH_LITE")
        : `${providerId.toUpperCase()}_PROVIDER`;

      return deepFreeze({
        textResponse: response.textResponse,
        modelUsed: modelName,
        responseSource,
        requestId: reqId,
        generatedAt: new Date().toISOString(),
        latencyMs: Date.now() - overallStart,
        fallbackCount: stats.fallbacksCount
      });

    } catch (err) {
      const latency = Date.now() - modelStart;
      const isTimeout = err.name === "AbortError";
      const status = err.status || null;
      
      const isRetryableException = isTimeout || 
        err.message === "fetch failed" || 
        err.code === "ECONNRESET" || 
        err.code === "ECONNREFUSED" || 
        err.code === "ENOTFOUND" ||
        [429, 500, 502, 503, 504].includes(status);

      logger.warn(`[req: ${reqId}] AI Model: ${modelName} threw exception: ${err.message} (Retryable: ${isRetryableException})`);
      lastError = err;

      // Track exception failure
      modelState.failedRequestsToday++;
      modelState.consecutiveFailures++;
      modelState.lastFailure = new Date().toISOString();
      modelState.status = "DEGRADED";

      // Report failure to the provider manager state tracker
      reportFailure(providerId);

      if (logStage) {
        logStage(reqId, 6, `Gemini HTTP response received (${modelName})`, false, startT, `Exception: ${err.message}`);
      }

      if (config.enableModelFallback && isRetryableException && i < candidateModels.length - 1) {
        stats.fallbacksCount++;
        logger.info(`[req: ${reqId}] Fallback triggered after exception. Next model selected: ${candidateModels[i + 1].modelName}`);
        continue;
      }
    }
  }

  // Final cache fallback
  logger.warn(`[req: ${reqId}] AI Model Manager: All models failed. Attempting final cache lookup.`);
  
  const cacheData = await queryCachedRecommendation();
  if (cacheData) {
    stats.cacheAccessCount++;
    logger.info(`[req: ${reqId}] AI Model Manager: Serving cached recommendation.`);
    return deepFreeze({
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
    });
  }

  throw lastError || new Error("ALL_MODELS_AND_CACHE_FAILED");
}

// Auto-register default providers
aiProviderRegistry.registerProvider("gemini", new GeminiProvider({ geminiApiKey: config.geminiApiKey }));
aiProviderRegistry.registerProvider("mock", new MockProvider());
