import { logger } from "../utils/logger.js";

/**
 * Deep freezes an object recursively to guarantee immutability.
 * @param {Object} obj
 * @returns {Object} Frozen object
 */
export function deepFreeze(obj) {
  if (
    obj === null ||
    typeof obj !== "object" ||
    Object.isFrozen(obj) ||
    obj instanceof Date ||
    obj instanceof RegExp ||
    ArrayBuffer.isView(obj) ||
    (obj.constructor && obj.constructor.name === "ObjectId") ||
    (obj._bsontype && obj._bsontype === "ObjectID")
  ) {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Stage 1: Validates parsed signals and returns a standardized Validation Result.
 * @param {Object} rawMessage - Raw Telegram message metadata
 * @param {Object} parsedSignal - Output from the noise/signal parser
 * @param {Object} options - Mock overrides and options
 * @returns {Object} Standard Validation Result object
 */
export function validateParsedSignal(rawMessage = {}, parsedSignal = {}, options = {}) {
  const now = options.now || Date.now();
  const errors = [];
  const warnings = [];

  // 1. Validate Signal ID
  const signalId = parsedSignal?.messageId || rawMessage?.messageId || null;
  if (signalId === null || signalId === undefined) {
    errors.push({
      code: "MISSING_SIGNAL_ID",
      field: "signalId",
      message: "Mandatory field 'signalId' (messageId) is missing."
    });
  }

  // 2. Validate Channel Name
  const channelName = parsedSignal?.channel || rawMessage?.channel || null;
  if (!channelName || channelName === "unknown") {
    errors.push({
      code: "MISSING_CHANNEL_NAME",
      field: "channelName",
      message: "Mandatory field 'channelName' is missing or unknown."
    });
  }

  // 3. Validate Symbol
  const symbol = parsedSignal?.pair || null;
  if (!symbol) {
    errors.push({
      code: "MISSING_SYMBOL",
      field: "symbol",
      message: "Mandatory field 'symbol' (pair) is missing."
    });
  }

  // 4. Validate Direction
  const direction = parsedSignal?.action || null;
  if (!direction || (direction !== "BUY" && direction !== "SELL")) {
    errors.push({
      code: "INVALID_DIRECTION",
      field: "direction",
      message: `Mandatory field 'direction' (action) must be 'BUY' or 'SELL'. Got: '${direction}'`
    });
  }

  // 5. Validate Entry
  const entry = parsedSignal?.entry;
  if (entry === null || entry === undefined || typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0) {
    errors.push({
      code: "INVALID_ENTRY",
      field: "entry",
      message: `Mandatory field 'entry' must be a positive number. Got: '${entry}'`
    });
  }

  // 6. Validate Stop Loss
  const stopLoss = parsedSignal?.stopLoss;
  if (stopLoss === null || stopLoss === undefined || typeof stopLoss !== "number" || !Number.isFinite(stopLoss) || stopLoss <= 0) {
    errors.push({
      code: "INVALID_STOP_LOSS",
      field: "stopLoss",
      message: `Mandatory field 'stopLoss' must be a positive number. Got: '${stopLoss}'`
    });
  }

  // 7. Validate Take Profits (targets)
  const takeProfits = parsedSignal?.targets || null;
  if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
    errors.push({
      code: "MISSING_TAKE_PROFITS",
      field: "takeProfits",
      message: "Mandatory field 'takeProfits' (targets) must be a non-empty array."
    });
  } else {
    takeProfits.forEach((tp, idx) => {
      if (typeof tp !== "number" || !Number.isFinite(tp) || tp <= 0) {
        errors.push({
          code: "INVALID_TAKE_PROFIT",
          field: `takeProfits[${idx}]`,
          message: `Take profit level at index ${idx} must be a positive number. Got: '${tp}'`
        });
      }
    });
  }

  const success = errors.length === 0;
  let context = null;

  if (success) {
    // Resolve channelId safely
    const channelId = rawMessage?.channelId || parsedSignal?.channelId || "unknown-channel-id";
    const receivedTimestamp = rawMessage?.timestamp || new Date(now).toISOString();
    const entryFrom = (parsedSignal?.entryRange && parsedSignal.entryRange.length >= 2) ? parsedSignal.entryRange[0] : null;
    const entryTo = (parsedSignal?.entryRange && parsedSignal.entryRange.length >= 2) ? parsedSignal.entryRange[1] : null;

    context = {
      signalId,
      channelId,
      channelName,
      symbol,
      direction,
      entry,
      entryFrom,
      entryTo,
      stopLoss,
      takeProfits,
      receivedTimestamp,
      parserTimestamp: new Date(now).toISOString(),
      pipelineStatus: "VALIDATED",
      executionStatus: "NOT_STARTED",
      order: {
        type: null,
        ticket: null,
        fillPrice: null,
        placedAt: null
      },
      monitoring: {
        status: "NOT_STARTED",
        startedAt: null,
        lastUpdate: null
      },
      outcome: {
        result: null,
        closedAt: null,
        profit: null,
        pips: null
      },
      rating: {
        processed: false
      }
    };

    logger.info("validation.success", {
      signalId,
      channelName,
      symbol,
      direction
    });
  } else {
    logger.warn("validation.rejected", {
      signalId,
      channelName,
      errors
    });
  }

  const report = {
    success,
    context,
    errors,
    warnings,
    metadata: {
      validationTime: new Date(now).toISOString(),
      validatorVersion: "1.0.0"
    }
  };

  return deepFreeze(report);
}
