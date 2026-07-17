import { logger } from "../utils/logger.js";
import { deepFreeze } from "./signalValidationService.js";

/**
 * Stage 3: Signal Execution Scheduler.
 * Coordinates validation/planning data into immediate or pending order schedules.
 * @param {Object} context - Stage 2 planned SignalValidationContext
 * @param {Object} options - Scheduling configuration options
 * @returns {Object} Deep-frozen scheduled SignalValidationContext
 */
export function scheduleSignalExecution(context = {}, options = {}) {
  const now = options.now || Date.now();

  if (!context || context.order?.status !== "PLANNED") {
    throw new Error("Invalid SignalValidationContext: Order must have status 'PLANNED' to schedule.");
  }

  const { type } = context.order;
  let executionMode = null;
  let executionStatus = null;
  let schedulerReason = null;

  if (type === "MARKET") {
    executionMode = "MARKET";
    executionStatus = "READY_FOR_EXECUTION";
    schedulerReason = "MARKET_ORDER";
  } else if (["BUY_STOP", "BUY_LIMIT", "SELL_STOP", "SELL_LIMIT"].includes(type)) {
    executionMode = "PENDING";
    executionStatus = "WAITING_FOR_PRICE";
    schedulerReason = "PENDING_ORDER";
  } else {
    throw new Error(`Invalid planned order type for scheduling: '${type}'`);
  }

  logger.info("execution_scheduler.success", {
    signalId: context.signalId,
    symbol: context.symbol,
    type,
    executionMode,
    executionStatus,
    schedulerReason
  });

  // Build scheduled deep-frozen context
  const scheduledContext = {
    ...context,
    pipelineStatus: "SCHEDULED",
    order: {
      ...context.order,
      executionMode,
      executionStatus,
      scheduledAt: new Date(now).toISOString(),
      nextEvaluationTime: null,
      schedulerVersion: "1.0.0",
      schedulerReason
    }
  };

  return deepFreeze(scheduledContext);
}
