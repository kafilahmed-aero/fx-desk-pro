import { aggregateChannelPerformance } from "./channelPerformanceService.js";
import { logger } from "../utils/logger.js";

let schedulerInterval = null;
let aggregationInProgress = false;
let aggregationIntervalMs = 900000; // default 15 minutes

export async function runAggregationCycle() {
  if (aggregationInProgress) {
    return;
  }
  aggregationInProgress = true;

  try {
    logger.info("performance_scheduler.aggregation_cycle_started");
    const startTime = Date.now();
    const results = await aggregateChannelPerformance();
    const durationMs = Date.now() - startTime;
    logger.info("performance_scheduler.aggregation_cycle_complete", {
      channelsAggregated: results.length,
      durationMs,
    });
  } catch (err) {
    logger.error("performance_scheduler.aggregation_cycle_failed", {
      error: err.message,
    });
  } finally {
    aggregationInProgress = false;
  }
}

export function startPerformanceAggregation(intervalMs = 900000) {
  if (schedulerInterval) {
    return { started: true, alreadyRunning: true };
  }

  aggregationIntervalMs = intervalMs;
  schedulerInterval = setInterval(runAggregationCycle, aggregationIntervalMs);

  logger.info("performance_scheduler.started", { intervalMs });
  
  // Run first cycle asynchronously to populate initial stats
  runAggregationCycle().catch((err) => {
    logger.error("performance_scheduler.initial_run_failed", { error: err.message });
  });

  return { started: true, intervalMs };
}

export function stopPerformanceAggregation() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  logger.info("performance_scheduler.stopped");
}

export function isPerformanceAggregationRunning() {
  return schedulerInterval !== null;
}
