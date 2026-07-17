import { logger } from "../utils/logger.js";
import { deepFreeze } from "./signalValidationService.js";

/**
 * Stage 2: Signal Entry Planner.
 * Determines the execution plan (order type, boundaries, reasoning) without placing trades.
 * @param {Object} context - Stage 1 validated SignalValidationContext
 * @param {number} liveMarketPrice - Latest live price tick for the symbol
 * @param {Object} options - Planning configuration options
 * @returns {Object} Deep-frozen updated SignalValidationContext
 */
export function planSignalEntry(context = {}, liveMarketPrice, options = {}) {
  const now = options.now || Date.now();

  if (!context || context.pipelineStatus !== "VALIDATED") {
    throw new Error("Invalid SignalValidationContext: Must have status 'VALIDATED'.");
  }

  if (typeof liveMarketPrice !== "number" || isNaN(liveMarketPrice) || liveMarketPrice <= 0) {
    throw new Error(`Invalid liveMarketPrice: Must be a positive finite number. Got: '${liveMarketPrice}'`);
  }

  const { symbol, direction, entry, entryFrom, entryTo } = context;

  // 1. Calculate boundaries & planned Entry
  let lower, upper, plannedEntry;

  if (typeof entryFrom === "number" && typeof entryTo === "number") {
    lower = Math.min(entryFrom, entryTo);
    upper = Math.max(entryFrom, entryTo);
    plannedEntry = (entryFrom + entryTo) / 2;
  } else {
    lower = entry;
    upper = entry;
    plannedEntry = entry;
  }

  // 2. Evaluate Zone & Direction logic
  let type = null;
  let planningReason = null;

  const isInside = (liveMarketPrice >= lower && liveMarketPrice <= upper);

  if (isInside) {
    type = "MARKET";
    planningReason = "PRICE_INSIDE_ENTRY_ZONE";
  } else if (direction === "BUY") {
    if (liveMarketPrice < plannedEntry) {
      type = "BUY_STOP";
      planningReason = "BUY_ENTRY_ABOVE_MARKET";
    } else {
      type = "BUY_LIMIT";
      planningReason = "BUY_ENTRY_BELOW_MARKET";
    }
  } else if (direction === "SELL") {
    if (liveMarketPrice > plannedEntry) {
      type = "SELL_STOP";
      planningReason = "SELL_ENTRY_BELOW_MARKET";
    } else {
      type = "SELL_LIMIT";
      planningReason = "SELL_ENTRY_ABOVE_MARKET";
    }
  }

  logger.info("entry_planner.success", {
    signalId: context.signalId,
    symbol,
    direction,
    plannedEntry,
    liveMarketPrice,
    type,
    planningReason
  });

  // 3. Build updated deep-frozen context
  const plannedContext = {
    ...context,
    order: {
      ...context.order,
      type,
      plannedEntry,
      entryZone: {
        lower,
        upper
      },
      currentMarketPrice: liveMarketPrice,
      planningTimestamp: new Date(now).toISOString(),
      planningReason,
      status: "PLANNED"
    }
  };

  return deepFreeze(plannedContext);
}
