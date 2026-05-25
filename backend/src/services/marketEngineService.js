import { config } from "../config/env.js";
import { cleanupExpiredSignals, refreshAllPairStates } from "./pairStateEngine.js";

let refreshTimer = null;
let cleanupTimer = null;
let refreshInProgress = false;
let cleanupInProgress = false;

export function startMarketEngine() {
  if (refreshTimer || cleanupTimer) {
    return {
      started: true,
      alreadyRunning: true,
    };
  }

  refreshTimer = setInterval(runRefreshCycle, config.marketEngine.refreshIntervalMs);
  cleanupTimer = setInterval(runCleanupCycle, config.marketEngine.cleanupIntervalMs);

  console.log("[ENGINE LOOP]");
  console.log("Market engine started");

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

  console.log("[ENGINE LOOP]");
  console.log("Market engine stopped");
}

function runRefreshCycle() {
  if (refreshInProgress) {
    return;
  }

  refreshInProgress = true;

  try {
    const pairStates = refreshAllPairStates();
    console.log("[ENGINE LOOP]");
    console.log(`Freshness decay cycle complete: ${pairStates.length} pairs`);
  } catch (error) {
    console.error("[ENGINE LOOP]");
    console.error(`Refresh cycle failed: ${error.message}`);
  } finally {
    refreshInProgress = false;
  }
}

function runCleanupCycle() {
  if (cleanupInProgress) {
    return;
  }

  cleanupInProgress = true;

  try {
    const results = cleanupExpiredSignals({
      expiredRetentionMinutes: config.marketEngine.expiredRetentionMinutes,
      maxSignalsPerPair: config.marketEngine.maxSignalsPerPair,
    });
    const removedCount = results.reduce((sum, result) => sum + result.removedCount, 0);

    console.log("[ENGINE LOOP]");
    console.log(`Stale cleanup cycle complete: removed ${removedCount}`);
  } catch (error) {
    console.error("[ENGINE LOOP]");
    console.error(`Cleanup cycle failed: ${error.message}`);
  } finally {
    cleanupInProgress = false;
  }
}
