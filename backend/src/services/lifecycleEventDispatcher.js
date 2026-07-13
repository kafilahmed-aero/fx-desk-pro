import { updateOutcomeStatus } from "./signalOutcomeEngine.js";
import { logger } from "../utils/logger.js";

let testEventListener = null;
export function setTestEventListener(listener) {
  testEventListener = listener;
}

const EVENT_TYPE_TO_STATUS_MAP = {
  ENTRY_FILLED: "ACTIVE",
  PARTIAL_TP: "PARTIAL_TP",
  FULL_TP: "FULL_TP",
  SL_HIT: "SL_HIT",
  EXPIRED: "EXPIRED",
  CANCEL_SIGNAL: "CANCELLED"
};

/**
 * Publishes an immutable lifecycle event downstream.
 * Maps eventType to corresponding signal outcome status updates.
 * @param {Object} event - Immutable lifecycle event object
 * @returns {Promise<Object|null>} The updated outcome or null
 */
export async function publishLifecycleEvent(event) {
  if (testEventListener) {
    testEventListener(event);
  }

  logger.info("lifecycle_event.published", {
    eventType: event.eventType,
    messageKey: event.messageKey,
    pair: event.pair,
    detectedPrice: event.detectedPrice,
    source: event.source
  });

  const targetStatus = EVENT_TYPE_TO_STATUS_MAP[event.eventType];
  if (!targetStatus) {
    logger.error("lifecycle_event.unsupported_type", { eventType: event.eventType });
    return null;
  }

  const statusData = {
    price: event.detectedPrice,
    time: event.detectedAt || new Date(),
  };

  if (event.eventType === "PARTIAL_TP" || event.eventType === "FULL_TP") {
    if (typeof event.targetNumber === "number") {
      statusData.hitTargets = [event.targetNumber];
    }
  }

  try {
    const updated = await updateOutcomeStatus(
      event.messageKey,
      targetStatus,
      event.source || "SYSTEM",
      statusData
    );
    return updated;
  } catch (error) {
    logger.error("lifecycle_event.dispatch_failed", {
      messageKey: event.messageKey,
      eventType: event.eventType,
      error: error.message
    });
    return null;
  }
}
