import {
  getActiveAndPendingOutcomes,
  purgeHistoricalOutcomes,
  getActiveAndPendingAiOutcomes,
  adaptAiToSignalOutcome
} from "./signalOutcomeStore.js";
import { fetchPrices } from "./priceIngestionService.js";
import { publishLifecycleEvent } from "./lifecycleEventDispatcher.js";
import { logger } from "../utils/logger.js";

let monitorInterval = null;
let cycleInProgress = false;
let monitorIntervalMs = 60000; // default 1 minute

export async function evaluatePriceCrossovers(outcome, price, timestamp = new Date()) {
  const t = new Date(timestamp);
  const currentPrice = Number(price);

  if (["FULL_TP", "SL_HIT", "EXPIRED", "CANCELLED"].includes(outcome.status)) {
    return;
  }

  // 1. Expiration check
  if (t >= new Date(outcome.expiresAt)) {
    await publishLifecycleEvent({
      eventType: "EXPIRED",
      messageKey: outcome.messageKey,
      pair: outcome.pair,
      detectedPrice: currentPrice,
      detectedAt: t,
      source: "PRICE_MONITOR"
    });
    return;
  }

  // 2. Pending to Active entry crossing check
  if (outcome.status === "PENDING") {
    let entryTriggered = false;
    const entry = outcome.entry;

    if (entry.entryType === "RANGE") {
      if (currentPrice >= entry.entryLow && currentPrice <= entry.entryHigh) {
        entryTriggered = true;
      }
    } else if (entry.entryPrice !== null) {
      if (outcome.action === "BUY") {
        if (currentPrice <= entry.entryPrice) {
          entryTriggered = true;
        }
      } else if (outcome.action === "SELL") {
        if (currentPrice >= entry.entryPrice) {
          entryTriggered = true;
        }
      }
    }

    if (entryTriggered) {
      await publishLifecycleEvent({
        eventType: "ENTRY_FILLED",
        messageKey: outcome.messageKey,
        pair: outcome.pair,
        detectedPrice: currentPrice,
        detectedAt: t,
        source: "PRICE_MONITOR"
      });
    }
    return;
  }

  // 3. Active / Partial TP crossovers
  if (outcome.status === "ACTIVE" || outcome.status === "PARTIAL_TP") {
    // 3a. Check Stop Loss crossover
    let slTriggered = false;
    if (outcome.stopLoss !== null) {
      if (outcome.action === "BUY") {
        if (currentPrice <= outcome.stopLoss) {
          slTriggered = true;
        }
      } else if (outcome.action === "SELL") {
        if (currentPrice >= outcome.stopLoss) {
          slTriggered = true;
        }
      }
    }

    if (slTriggered) {
      await publishLifecycleEvent({
        eventType: "SL_HIT",
        messageKey: outcome.messageKey,
        pair: outcome.pair,
        detectedPrice: currentPrice,
        detectedAt: t,
        source: "PRICE_MONITOR"
      });
      return;
    }

    // 3b. Check Take Profit targets crossover
    if (Array.isArray(outcome.targets) && outcome.targets.length > 0) {
      const activeTargets = outcome.targets.filter((tgt) => !tgt.isHit);

      for (const target of activeTargets) {
        let tpTriggered = false;
        if (outcome.action === "BUY") {
          if (currentPrice >= target.price) {
            tpTriggered = true;
          }
        } else if (outcome.action === "SELL") {
          if (currentPrice <= target.price) {
            tpTriggered = true;
          }
        }

        if (tpTriggered) {
          // If this is the last remaining target, it's FULL_TP, else PARTIAL_TP
          const isLastTarget = activeTargets.length === 1;
          await publishLifecycleEvent({
            eventType: isLastTarget ? "FULL_TP" : "PARTIAL_TP",
            messageKey: outcome.messageKey,
            pair: outcome.pair,
            detectedPrice: currentPrice,
            detectedAt: t,
            source: "PRICE_MONITOR",
            targetNumber: target.targetNumber
          });
        }
      }
    }
  }
}

export async function runMonitoringCycle() {
  if (cycleInProgress) {
    return;
  }
  cycleInProgress = true;
  const startTime = Date.now();
  let activeOutcomeCount = 0;
  let monitoredPairsCount = 0;

  try {
    // 1. Fetch only outcomes requiring evaluation
    const activeOutcomes = await getActiveAndPendingOutcomes();
    const activeAiOutcomes = await getActiveAndPendingAiOutcomes();
    const adaptedAiOutcomes = activeAiOutcomes.map(adaptAiToSignalOutcome);
    const combinedOutcomes = [...activeOutcomes, ...adaptedAiOutcomes];

    activeOutcomeCount = combinedOutcomes.length;
    if (combinedOutcomes.length === 0) {
      logger.debug("price_monitor.idle", { reason: "no_active_outcomes" });
      cycleInProgress = false;
      return;
    }

    // 2. Extract unique pairs
    const uniquePairs = [...new Set(combinedOutcomes.map((o) => o.pair))];
    monitoredPairsCount = uniquePairs.length;
    logger.info("price_monitor.cycle_started", {
      activeOutcomesCount: combinedOutcomes.length,
      pairsCount: uniquePairs.length,
      pairs: uniquePairs,
    });

    // 3. Ingest latest prices
    const pricesMap = await fetchPrices(uniquePairs);

    // 4. Update outcomes individually
    let updatedCount = 0;
    for (const outcome of combinedOutcomes) {
      const priceInfo = pricesMap.get(outcome.pair);
      if (priceInfo && priceInfo.price) {
        try {
          await evaluatePriceCrossovers(outcome, priceInfo.price, priceInfo.lastUpdated);
          updatedCount++;
        } catch (outcomeErr) {
          logger.error("price_monitor.outcome_update_failed", {
            messageKey: outcome.messageKey,
            pair: outcome.pair,
            error: outcomeErr.message,
          });
        }
      } else {
        logger.warn("price_monitor.price_missing", {
          messageKey: outcome.messageKey,
          pair: outcome.pair,
        });
      }
    }

    // 5. Purge obsolete historical outcomes
    await purgeHistoricalOutcomes().catch((purgeErr) => {
      logger.error("price_monitor.purge_failed", { error: purgeErr.message });
    });

    logger.info("price_monitor.cycle_complete", {
      evaluated: combinedOutcomes.length,
      updated: updatedCount,
    });
  } catch (error) {
    logger.error("price_monitor.cycle_failed", { error: error.message });
  } finally {
    cycleInProgress = false;
    const cycleDuration = Date.now() - startTime;
    logger.info("price_monitoring.cycle", {
      activeOutcomeCount,
      monitoredPairsCount,
      cycleDuration,
    });
  }
}

export function startPriceMonitoring(intervalMs = 60000) {
  if (monitorInterval) {
    return { started: true, alreadyRunning: true };
  }

  monitorIntervalMs = intervalMs;
  monitorInterval = setInterval(runMonitoringCycle, monitorIntervalMs);

  logger.info("price_monitoring.started", {
    pollingInterval: monitorIntervalMs,
    timestamp: new Date().toISOString()
  });
  
  // Run first cycle asynchronously
  runMonitoringCycle().catch((err) => {
    logger.error("price_monitor.initial_run_failed", { error: err.message });
  });

  return { started: true, intervalMs };
}

export function stopPriceMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  logger.info("price_monitor.stopped");
}

export function isPriceMonitoringRunning() {
  return monitorInterval !== null;
}
