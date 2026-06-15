import { getActiveAndPendingOutcomes } from "./signalOutcomeStore.js";
import { fetchPrices } from "./priceIngestionService.js";
import { updateOutcomePrice } from "./signalOutcomeEngine.js";
import { logger } from "../utils/logger.js";

let monitorInterval = null;
let cycleInProgress = false;
let monitorIntervalMs = 60000; // default 1 minute

export async function runMonitoringCycle() {
  if (cycleInProgress) {
    return;
  }
  cycleInProgress = true;

  try {
    // 1. Fetch only outcomes requiring evaluation
    const activeOutcomes = await getActiveAndPendingOutcomes();
    if (activeOutcomes.length === 0) {
      logger.debug("price_monitor.idle", { reason: "no_active_outcomes" });
      cycleInProgress = false;
      return;
    }

    // 2. Extract unique pairs
    const uniquePairs = [...new Set(activeOutcomes.map((o) => o.pair))];
    logger.info("price_monitor.cycle_started", {
      activeOutcomesCount: activeOutcomes.length,
      pairsCount: uniquePairs.length,
      pairs: uniquePairs,
    });

    // 3. Ingest latest prices
    const pricesMap = await fetchPrices(uniquePairs);

    // 4. Update outcomes individually
    let updatedCount = 0;
    for (const outcome of activeOutcomes) {
      const priceInfo = pricesMap.get(outcome.pair);
      if (priceInfo && priceInfo.price) {
        try {
          await updateOutcomePrice(outcome, priceInfo.price, priceInfo.lastUpdated);
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

    logger.info("price_monitor.cycle_complete", {
      evaluated: activeOutcomes.length,
      updated: updatedCount,
    });
  } catch (error) {
    logger.error("price_monitor.cycle_failed", { error: error.message });
  } finally {
    cycleInProgress = false;
  }
}

export function startPriceMonitoring(intervalMs = 60000) {
  if (monitorInterval) {
    return { started: true, alreadyRunning: true };
  }

  monitorIntervalMs = intervalMs;
  monitorInterval = setInterval(runMonitoringCycle, monitorIntervalMs);

  logger.info("price_monitor.started", { intervalMs });
  
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
