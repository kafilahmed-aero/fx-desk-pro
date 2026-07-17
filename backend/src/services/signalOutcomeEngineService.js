import { logger } from "../utils/logger.js";
import { getPipValue } from "./signalOutcomeEngine.js";
import { deepFreeze } from "./signalValidationService.js";

/**
 * Stage 7: Outcome Engine.
 * Resolves closed trades into completed outcomes with pips, duration, and profit parameters.
 * @param {Object} context - Executed and Closed SignalValidationContext
 * @param {Object} eventPayload - Optional close event payload from MT5 EA client
 * @param {Object} options - Outcome engine options
 * @returns {Object} Deep-frozen completed SignalValidationContext
 */
export function evaluateSignalOutcome(context = {}, eventPayload = {}, options = {}) {
  const now = options.now || Date.now();

  // 1. Ingestion Guards
  if (
    !context ||
    context.pipelineStatus !== "EXECUTED" ||
    context.monitoring?.status !== "POSITION_CLOSED"
  ) {
    logger.debug("outcome_engine.skipped", {
      signalId: context?.signalId,
      pipelineStatus: context?.pipelineStatus,
      monitoringStatus: context?.monitoring?.status
    });
    return context;
  }

  const symbol = context.symbol;
  const direction = context.direction;
  const mon = context.monitoring || {};
  const closeReason = mon.closeReason || "";

  // 2. Final Outcome Result Mapping
  let result = "UNKNOWN";
  if (closeReason === "TP") {
    result = "FULL_TP";
  } else if (closeReason === "SL") {
    result = "SL_HIT";
  } else if (closeReason === "MANUAL") {
    result = "MANUAL_CLOSE";
  } else if (closeReason === "CANCELLED") {
    result = "CANCELLED";
  } else if (closeReason === "EXPIRED") {
    result = "EXPIRED";
  }

  // 3. Trade Metrics Calculations
  let closedAt = mon.positionClosedAt || new Date(now).toISOString();
  let closePrice = null;
  let tradeDuration = 0;
  let pips = 0;
  let profit = null;

  if (mon.positionOpenedAt === null) {
    // Order never opened/filled (Cancelled or Expired)
    tradeDuration = 0;
    pips = 0;
    profit = 0;
  } else {
    // Position was opened
    closePrice = mon.lastKnownPrice;
    
    // Calculate trade duration in seconds
    const openedTime = new Date(mon.positionOpenedAt).getTime();
    const closedTime = new Date(closedAt).getTime();
    tradeDuration = Math.max(0, Math.round((closedTime - openedTime) / 1000));

    // Calculate pips using entry, exit, direction, and symbol pip scale
    const entryPrice = context.order?.fillPrice || context.order?.plannedEntry || context.entry;
    const directionMultiplier = direction === "BUY" ? 1 : -1;
    const pipVal = getPipValue(symbol);

    if (
      typeof entryPrice === "number" && 
      typeof closePrice === "number" && 
      typeof pipVal === "number" && 
      pipVal > 0
    ) {
      const rawDiff = (closePrice - entryPrice) * directionMultiplier;
      pips = Number((rawDiff / pipVal).toFixed(1));
    } else {
      pips = null;
    }

    // Set realized profit directly from broker payload if reported
    profit = eventPayload?.profit !== undefined ? Number(eventPayload.profit) : null;
  }

  logger.info("outcome_engine.success", {
    signalId: context.signalId,
    result,
    pips,
    profit,
    tradeDuration
  });

  const updatedContext = {
    ...context,
    pipelineStatus: "COMPLETED",
    outcome: {
      ...context.outcome,
      result,
      closedAt,
      closePrice,
      profit,
      pips,
      tradeDuration
    }
  };

  return deepFreeze(updatedContext);
}
