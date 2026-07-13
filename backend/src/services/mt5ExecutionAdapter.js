import { logger } from "../utils/logger.js";

/**
 * Deep freezes an object recursively to guarantee immutability.
 * @param {Object} obj - Target object
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Translates standardized execution request outputs from Trade Execution Engine into broker-specific MT5 request payloads.
 * @param {Object} executionRequest - Standard execution request snapshot
 * @param {Object} options - Custom optional overrides
 * @returns {Object} Immutable MT5 request payload snapshot
 */
export function translateToMt5Payload(executionRequest, options = {}) {
  const now = options.now || Date.now();
  const timestampIso = new Date(now).toISOString();

  const buildRejectedResult = (reason, errors = []) => {
    return deepFreeze({
      status: "REJECTED",
      payload: null,
      errors: errors.length > 0 ? errors : [reason],
      timestamp: timestampIso,
      metadata: {
        originalRequestTimestamp: executionRequest?.timestamp || null
      }
    });
  };

  // 1. Check presence of required structures
  if (!executionRequest) {
    return buildRejectedResult("MISSING_INPUTS", ["Execution request input structure is undefined or null."]);
  }

  const errors = [];

  // 2. Reject if upstream request is not approved
  if (executionRequest.status !== "APPROVED") {
    errors.push(`Upstream request status is not APPROVED: ${executionRequest.status || "UNKNOWN"}.`);
    if (executionRequest.rejectionReason) {
      errors.push(`Upstream rejection reason: ${executionRequest.rejectionReason}.`);
    }
    return buildRejectedResult("UPSTREAM_REQUEST_REJECTED", errors);
  }

  // 3. Validate Symbol
  const symbol = executionRequest.symbol ? String(executionRequest.symbol).toUpperCase().trim() : "";
  if (!symbol) {
    errors.push("Broker symbol field is missing or blank.");
  }

  // 4. Resolve and Validate Direction
  const action = executionRequest.action ? String(executionRequest.action).toUpperCase().trim() : "";
  let direction = "";
  if (action === "BUY") {
    direction = "BUY";
  } else if (action === "SELL") {
    direction = "SELL";
  } else if (action === "HOLD") {
    errors.push("Upstream request action HOLD is rejected for execution.");
  } else {
    errors.push(`Invalid execution request action: ${action || "NULL"}.`);
  }

  // 5. Validate Price
  const price = typeof executionRequest.entry === "number" ? executionRequest.entry : null;
  if (price === null || isNaN(price) || price <= 0) {
    errors.push(`Invalid execution entry price: ${price}. Price must be a positive number.`);
  }

  // 6. Validate Volume (Lot size)
  const volume = typeof executionRequest.volume === "number" ? executionRequest.volume : null;
  if (volume === null || isNaN(volume)) {
    errors.push("Broker volume lot size must be a valid number.");
  } else if (volume < 0.01 || volume > 100.0) {
    errors.push(`Volume size ${volume} out of broker bounds (0.01 to 100.0).`);
  }

  // 7. Validate SL Relative to Direction
  const sl = typeof executionRequest.stopLoss === "number" ? executionRequest.stopLoss : null;
  if (sl !== null) {
    if (isNaN(sl) || sl <= 0) {
      errors.push(`Invalid Stop Loss price: ${sl}. SL must be a positive number.`);
    } else if (direction === "BUY" && price !== null && sl >= price) {
      errors.push(`Invalid Stop Loss for BUY: SL (${sl}) must be strictly less than entry price (${price}).`);
    } else if (direction === "SELL" && price !== null && sl <= price) {
      errors.push(`Invalid Stop Loss for SELL: SL (${sl}) must be strictly greater than entry price (${price}).`);
    }
  }

  // 8. Resolve and Validate Take Profit (First item of array or null)
  let tp = null;
  const takeProfits = Array.isArray(executionRequest.takeProfits) ? executionRequest.takeProfits : [];
  if (takeProfits.length > 0) {
    const rawTp = takeProfits[0];
    if (typeof rawTp === "number" && !isNaN(rawTp) && rawTp > 0) {
      tp = rawTp;
      if (direction === "BUY" && price !== null && tp <= price) {
        errors.push(`Invalid Take Profit for BUY: TP (${tp}) must be strictly greater than entry price (${price}).`);
      } else if (direction === "SELL" && price !== null && tp >= price) {
        errors.push(`Invalid Take Profit for SELL: TP (${tp}) must be strictly less than entry price (${price}).`);
      }
    } else {
      errors.push(`Invalid Take Profit value: ${rawTp}. TP must be a positive number.`);
    }
  }

  // Check if any validation errors accumulated
  if (errors.length > 0) {
    logger.warn("mt5_execution_adapter.validation_failed", { symbol, action, errors });
    return buildRejectedResult("BROKER_VALIDATION_FAILED", errors);
  }

  logger.info("mt5_execution_adapter.payload_translated", { symbol, direction, volume, price });

  return deepFreeze({
    status: "TRANSLATED",
    payload: {
      action: "OPEN_ORDER",
      symbol,
      direction,
      volume,
      price,
      sl,
      tp
    },
    errors: null,
    timestamp: timestampIso,
    metadata: {
      originalRequestTimestamp: executionRequest.timestamp
    }
  });
}
