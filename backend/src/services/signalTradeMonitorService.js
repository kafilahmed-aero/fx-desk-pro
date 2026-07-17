import { logger } from "../utils/logger.js";
import { deepFreeze } from "./signalValidationService.js";

/**
 * Stage 6: Trade Monitor.
 * Observes executed trade event packets and updates structural monitoring parameters.
 * @param {Object} context - Executed SignalValidationContext
 * @param {Object} eventPayload - Raw WebSocket event from MT5 EA client
 * @param {Object} options - Monitor options
 * @returns {Object} Deep-frozen evaluated SignalValidationContext
 */
export function evaluateTradeMonitor(context = {}, eventPayload = {}, options = {}) {
  const now = options.now || Date.now();

  // 1. Ingestion Guards
  if (
    !context ||
    context.pipelineStatus !== "EXECUTED" ||
    context.order?.executionStatus !== "EXECUTED"
  ) {
    logger.debug("trade_monitor.skipped", {
      signalId: context?.signalId,
      pipelineStatus: context?.pipelineStatus,
      executionStatus: context?.order?.executionStatus
    });
    return context;
  }

  // 2. Normalization Engine
  const rawEvent = eventPayload.event || eventPayload.action || "";
  let normalizedEvent = null;

  if (rawEvent === "ORDER_FILLED") {
    normalizedEvent = "POSITION_OPENED";
  } else if (rawEvent === "ORDER_CLOSED") {
    normalizedEvent = "POSITION_CLOSED";
  } else if (["ORDER_MODIFIED", "TICK"].includes(rawEvent)) {
    normalizedEvent = "POSITION_UPDATED";
  } else {
    logger.warn("trade_monitor.unknown_event", { signalId: context.signalId, rawEvent });
    return context;
  }

  const prevMonitoring = context.monitoring || {};
  let status = prevMonitoring.status || "NOT_STARTED";
  let positionOpenedAt = prevMonitoring.positionOpenedAt || null;
  let positionClosedAt = prevMonitoring.positionClosedAt || null;
  let closeReason = prevMonitoring.closeReason || null;
  let lastKnownPrice = prevMonitoring.lastKnownPrice || null;

  if (normalizedEvent === "POSITION_OPENED") {
    status = "POSITION_OPEN";
    positionOpenedAt = eventPayload.fillTime 
      ? new Date(eventPayload.fillTime).toISOString() 
      : new Date(now).toISOString();
    lastKnownPrice = Number(eventPayload.fillPrice) || lastKnownPrice;
  } else if (normalizedEvent === "POSITION_CLOSED") {
    status = "POSITION_CLOSED";
    positionClosedAt = eventPayload.exitTime 
      ? new Date(eventPayload.exitTime).toISOString() 
      : new Date(now).toISOString();
    lastKnownPrice = Number(eventPayload.exitPrice) || lastKnownPrice;
    closeReason = eventPayload.reason || "UNKNOWN";
  } else if (normalizedEvent === "POSITION_UPDATED") {
    lastKnownPrice = Number(eventPayload.price || eventPayload.fillPrice || lastKnownPrice || context.order?.plannedEntry || 0);
    if (status === "NOT_STARTED") {
      status = "MONITORING";
    }
  }

  logger.info("trade_monitor.success", {
    signalId: context.signalId,
    normalizedEvent,
    status,
    lastKnownPrice
  });

  const updatedContext = {
    ...context,
    monitoring: {
      ...prevMonitoring,
      status,
      startedAt: prevMonitoring.startedAt || new Date(now).toISOString(),
      lastUpdate: new Date(now).toISOString(),
      lastKnownPrice,
      positionOpenedAt,
      positionClosedAt,
      closeReason,
      lastEvent: normalizedEvent,
      lastEventTimestamp: new Date(now).toISOString()
    }
  };

  return deepFreeze(updatedContext);
}
