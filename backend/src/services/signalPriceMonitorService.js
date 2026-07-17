import { logger } from "../utils/logger.js";
import { deepFreeze } from "./signalValidationService.js";

/**
 * Stage 4: Signal Price Monitor.
 * Evaluates live price ticks relative to pending entries and promotes execution readiness.
 * @param {Object} context - Scheduled SignalValidationContext
 * @param {number} liveMarketPrice - Latest live price tick for the symbol
 * @param {Object} options - Price Monitor options
 * @returns {Object} Deep-frozen evaluated SignalValidationContext
 */
export function evaluatePriceMonitor(context = {}, liveMarketPrice, options = {}) {
  const now = options.now || Date.now();

  if (typeof liveMarketPrice !== "number" || isNaN(liveMarketPrice) || liveMarketPrice <= 0) {
    throw new Error(`Invalid liveMarketPrice: Must be a positive finite number. Got: '${liveMarketPrice}'`);
  }

  // 1. Transition Guards
  let resultStatus = null;

  if (!context || context.pipelineStatus !== "SCHEDULED") {
    resultStatus = "IGNORED_INVALID_STAGE";
  } else if (context.order?.executionStatus === "READY_FOR_EXECUTION") {
    resultStatus = "IGNORED_ALREADY_READY";
  } else if (["EXECUTED", "CANCELLED", "EXPIRED", "FAILED"].includes(context.order?.executionStatus)) {
    resultStatus = "IGNORED_INVALID_STAGE";
  } else if (context.order?.executionStatus !== "WAITING_FOR_PRICE") {
    resultStatus = "IGNORED_INVALID_STAGE";
  }

  if (resultStatus) {
    logger.warn("price_monitor.ignored", {
      signalId: context?.signalId,
      executionStatus: context?.order?.executionStatus,
      resultStatus
    });

    const ignoredContext = {
      ...context,
      order: {
        ...context.order,
        lastEvaluation: {
          timestamp: new Date(now).toISOString(),
          marketPrice: liveMarketPrice,
          result: resultStatus
        }
      }
    };
    return deepFreeze(ignoredContext);
  }

  // 2. Evaluate Promotion Rules
  const { type, plannedEntry } = context.order;
  let promoted = false;
  let promotionReason = null;

  if (type === "BUY_LIMIT") {
    if (liveMarketPrice <= plannedEntry) {
      promoted = true;
      promotionReason = "PRICE_REACHED_BUY_LIMIT";
    }
  } else if (type === "BUY_STOP") {
    if (liveMarketPrice >= plannedEntry) {
      promoted = true;
      promotionReason = "PRICE_REACHED_BUY_STOP";
    }
  } else if (type === "SELL_LIMIT") {
    if (liveMarketPrice >= plannedEntry) {
      promoted = true;
      promotionReason = "PRICE_REACHED_SELL_LIMIT";
    }
  } else if (type === "SELL_STOP") {
    if (liveMarketPrice <= plannedEntry) {
      promoted = true;
      promotionReason = "PRICE_REACHED_SELL_STOP";
    }
  }

  let finalContext;

  if (promoted) {
    logger.info("price_monitor.promoted", {
      signalId: context.signalId,
      symbol: context.symbol,
      type,
      plannedEntry,
      liveMarketPrice,
      promotionReason
    });

    finalContext = {
      ...context,
      order: {
        ...context.order,
        executionStatus: "READY_FOR_EXECUTION",
        promotionTimestamp: new Date(now).toISOString(),
        promotionReason,
        lastEvaluation: {
          timestamp: new Date(now).toISOString(),
          marketPrice: liveMarketPrice,
          result: "PROMOTED"
        }
      }
    };
  } else {
    logger.debug("price_monitor.no_action", {
      signalId: context.signalId,
      type,
      plannedEntry,
      liveMarketPrice
    });

    finalContext = {
      ...context,
      order: {
        ...context.order,
        lastEvaluation: {
          timestamp: new Date(now).toISOString(),
          marketPrice: liveMarketPrice,
          result: "NO_ACTION"
        }
      }
    };
  }

  return deepFreeze(finalContext);
}
