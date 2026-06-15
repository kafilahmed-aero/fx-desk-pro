import { aggregatePairPerformance } from "./pairPerformanceService.js";
import { logger } from "../utils/logger.js";

let schedulerInterval = null;
let aggregationInProgress = false;
let aggregationIntervalMs = 900000; // default 15 minutes

export async function runPairAggregationCycle() {
  if (aggregationInProgress) {
    return;
  }
  aggregationInProgress = true;

  try {
    logger.info("pair_performance_scheduler.aggregation_cycle_started");
    const startTime = Date.now();
    const results = await aggregatePairPerformance();
    const durationMs = Date.now() - startTime;
    logger.info("pair_performance_scheduler.aggregation_cycle_complete", {
      pairsAggregated: results.length,
      durationMs,
    });
  } catch (err) {
    logger.error("pair_performance_scheduler.aggregation_cycle_failed", {
      error: err.message,
    });
  } finally {
    aggregationInProgress = false;
  }
}

export function startPairPerformanceAggregation(intervalMs = 900000) {
  if (schedulerInterval) {
    return { started: true, alreadyRunning: true };
  }

  aggregationIntervalMs = intervalMs;
  schedulerInterval = setInterval(runPairAggregationCycle, aggregationIntervalMs);

  logger.info("pair_performance_scheduler.started", { intervalMs });
  
  // Run first cycle asynchronously to populate initial stats
  runPairAggregationCycle().catch((err) => {
    logger.error("pair_performance_scheduler.initial_run_failed", { error: err.message });
  });

  return { started: true, intervalMs };
}

export function stopPairPerformanceAggregation() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  logger.info("pair_performance_scheduler.stopped");
}

export function isPairPerformanceAggregationRunning() {
  return schedulerInterval !== null;
}
