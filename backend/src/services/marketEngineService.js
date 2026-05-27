import { config } from "../config/env.js";
import { cleanupExpiredSignals, refreshAllPairStates } from "./pairStateEngine.js";
import { logger } from "../utils/logger.js";

let refreshTimer = null;
let cleanupTimer = null;
let refreshInProgress = false;
let cleanupInProgress = false;
const marketEngineMetrics = {
  refreshCycles: 0,
  cleanupCycles: 0,
  refreshFailures: 0,
  cleanupFailures: 0,
  lastRefreshAt: null,
  lastCleanupAt: null,
  lastRefreshDurationMs: 0,
  lastCleanupDurationMs: 0,
  lastPairCount: 0,
  lastCleanupRemovedCount: 0,
};

export function startMarketEngine() {
  if (refreshTimer || cleanupTimer) {
    return {
      started: true,
      alreadyRunning: true,
    };
  }

  refreshTimer = setInterval(runRefreshCycle, config.marketEngine.refreshIntervalMs);
  cleanupTimer = setInterval(runCleanupCycle, config.marketEngine.cleanupIntervalMs);

  logger.info("market_engine.started", {
    refreshIntervalMs: config.marketEngine.refreshIntervalMs,
    cleanupIntervalMs: config.marketEngine.cleanupIntervalMs,
  });

  runRefreshCycle();
  runCleanupCycle();

  return {
    started: true,
    refreshIntervalMs: config.marketEngine.refreshIntervalMs,
    cleanupIntervalMs: config.marketEngine.cleanupIntervalMs,
  };
}

export function stopMarketEngine() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  logger.info("market_engine.stopped");
}

function runRefreshCycle() {
  if (refreshInProgress) {
    return;
  }

  refreshInProgress = true;
  const startedAt = Date.now();

  try {
    const pairStates = refreshAllPairStates();
    marketEngineMetrics.refreshCycles += 1;
    marketEngineMetrics.lastRefreshAt = new Date().toISOString();
    marketEngineMetrics.lastRefreshDurationMs = Date.now() - startedAt;
    marketEngineMetrics.lastPairCount = pairStates.length;
    logger.debug("market_engine.refresh_cycle_complete", {
      pairCount: pairStates.length,
    });
  } catch (error) {
    marketEngineMetrics.refreshFailures += 1;
    logger.error("market_engine.refresh_cycle_failed", {
      error: error.message,
    });
  } finally {
    refreshInProgress = false;
  }
}

function runCleanupCycle() {
  if (cleanupInProgress) {
    return;
  }

  cleanupInProgress = true;
  const startedAt = Date.now();

  try {
    const results = cleanupExpiredSignals({
      expiredRetentionMinutes: config.marketEngine.expiredRetentionMinutes,
      maxSignalsPerPair: config.marketEngine.maxSignalsPerPair,
    });
    const removedCount = results.reduce((sum, result) => sum + result.removedCount, 0);
    marketEngineMetrics.cleanupCycles += 1;
    marketEngineMetrics.lastCleanupAt = new Date().toISOString();
    marketEngineMetrics.lastCleanupDurationMs = Date.now() - startedAt;
    marketEngineMetrics.lastCleanupRemovedCount = removedCount;

    logger.debug("market_engine.cleanup_cycle_complete", {
      removedCount,
    });
  } catch (error) {
    marketEngineMetrics.cleanupFailures += 1;
    logger.error("market_engine.cleanup_cycle_failed", {
      error: error.message,
    });
  } finally {
    cleanupInProgress = false;
  }
}

export function getMarketEngineMetrics() {
  return {
    running: Boolean(refreshTimer || cleanupTimer),
    refreshInProgress,
    cleanupInProgress,
    refreshIntervalMs: config.marketEngine.refreshIntervalMs,
    cleanupIntervalMs: config.marketEngine.cleanupIntervalMs,
    expiredRetentionMinutes: config.marketEngine.expiredRetentionMinutes,
    maxSignalsPerPair: config.marketEngine.maxSignalsPerPair,
    ...marketEngineMetrics,
  };
}
