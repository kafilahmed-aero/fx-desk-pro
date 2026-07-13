import { logger } from "../utils/logger.js";

function safeLog(level, event, details = {}) {
  try {
    if (typeof logger !== "undefined" && logger && logger[level]) {
      logger[level](event, details);
      return;
    }
  } catch (e) {}
  // Dynamic fallback to console to prevent TDZ circular import failures on boot
  const logMsg = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...details });
  if (level === "error") {
    console.error(logMsg);
  } else if (level === "warn") {
    console.warn(logMsg);
  } else {
    console.log(logMsg);
  }
}

var currentConfig = null;
const listeners = new Set();

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
 * Initializes the configuration manager with a raw configuration object.
 * @param {Object} rawConfig - Base configuration
 */
export function initializeManager(rawConfig) {
  currentConfig = JSON.parse(JSON.stringify(rawConfig));
  safeLog("info", "system_config_manager.initialized");
}

/**
 * Retrieves the current configuration, recursively deep frozen.
 * @returns {Object} Frozen configuration object
 */
export function getConfig() {
  if (!currentConfig) {
    throw new Error("System Configuration Manager has not been initialized yet.");
  }
  return deepFreeze(JSON.parse(JSON.stringify(currentConfig)));
}

/**
 * Validates updates against schemas and ranges.
 * @param {Object} updates - Target settings
 * @returns {string[]} List of error strings
 */
function validateConfigUpdates(updates) {
  const errors = [];

  const checkPort = (port) => {
    if (port !== undefined) {
      if (typeof port !== "number" || isNaN(port) || port < 1 || port > 65535 || !Number.isInteger(port)) {
        errors.push(`Invalid port: ${port}. Port must be an integer between 1 and 65535.`);
      }
    }
  };

  const checkExpiration = (min) => {
    if (min !== undefined) {
      if (typeof min !== "number" || isNaN(min) || min <= 0 || !Number.isInteger(min)) {
        errors.push(`Invalid signalExpirationMinutes: ${min}. Expiration must be a positive integer.`);
      }
    }
  };

  const checkRetention = (hours) => {
    if (hours !== undefined) {
      if (typeof hours !== "number" || isNaN(hours) || hours <= 0 || !Number.isInteger(hours)) {
        errors.push(`Invalid priceHistoryRetentionHours: ${hours}. Retention must be a positive integer.`);
      }
    }
  };

  const checkLotSize = (lot) => {
    if (lot !== undefined) {
      if (typeof lot !== "number" || isNaN(lot) || lot < 0.01 || lot > 100.0) {
        errors.push(`Invalid lot size: ${lot}. Lot size must be a number between 0.01 and 100.0.`);
      }
    }
  };

  const checkConfidence = (conf) => {
    if (conf !== undefined) {
      if (typeof conf !== "number" || isNaN(conf) || conf < 0 || conf > 100) {
        errors.push(`Invalid minConfidence: ${conf}. Confidence must be a number between 0 and 100.`);
      }
    }
  };

  const checkMinRR = (rr) => {
    if (rr !== undefined) {
      if (typeof rr !== "number" || isNaN(rr) || rr <= 0) {
        errors.push(`Invalid minRR: ${rr}. Minimum Risk/Reward ratio must be a positive number.`);
      }
    }
  };

  checkPort(updates.port);
  checkExpiration(updates.signalExpirationMinutes);
  checkRetention(updates.priceHistoryRetentionHours);

  if (updates.autoTrade !== undefined) {
    if (typeof updates.autoTrade !== "object" || updates.autoTrade === null) {
      errors.push("autoTrade must be an object.");
    } else {
      checkLotSize(updates.autoTrade.lotSize);
      checkConfidence(updates.autoTrade.minConfidence);
      checkMinRR(updates.autoTrade.minRR);
    }
  }

  if (updates.decisionEngine !== undefined) {
    if (typeof updates.decisionEngine !== "object" || updates.decisionEngine === null) {
      errors.push("decisionEngine must be an object.");
    } else {
      if (updates.decisionEngine.weights !== undefined) {
        if (typeof updates.decisionEngine.weights !== "object" || updates.decisionEngine.weights === null) {
          errors.push("decisionEngine.weights must be an object.");
        } else {
          for (const [key, val] of Object.entries(updates.decisionEngine.weights)) {
            if (typeof val !== "number" || isNaN(val) || val < 0) {
              errors.push(`Invalid decisionEngine weight for ${key}: ${val}. Must be a non-negative number.`);
            }
          }
        }
      }
      if (updates.decisionEngine.thresholds !== undefined) {
        if (typeof updates.decisionEngine.thresholds !== "object" || updates.decisionEngine.thresholds === null) {
          errors.push("decisionEngine.thresholds must be an object.");
        } else {
          for (const [key, val] of Object.entries(updates.decisionEngine.thresholds)) {
            if (typeof val !== "number" || isNaN(val) || val < 0 || val > 100) {
              errors.push(`Invalid decisionEngine threshold for ${key}: ${val}. Must be between 0 and 100.`);
            }
          }
        }
      }
      if (updates.decisionEngine.warningPenalty !== undefined) {
        const val = updates.decisionEngine.warningPenalty;
        if (typeof val !== "number" || isNaN(val) || val < 0) {
          errors.push(`Invalid warningPenalty: ${val}. Must be a non-negative number.`);
        }
      }
      if (updates.decisionEngine.maximumPenalty !== undefined) {
        const val = updates.decisionEngine.maximumPenalty;
        if (typeof val !== "number" || isNaN(val) || val < 0) {
          errors.push(`Invalid maximumPenalty: ${val}. Must be a non-negative number.`);
        }
      }
      if (updates.decisionEngine.policies !== undefined) {
        if (typeof updates.decisionEngine.policies !== "object" || updates.decisionEngine.policies === null) {
          errors.push("decisionEngine.policies must be an object.");
        } else {
          for (const [key, val] of Object.entries(updates.decisionEngine.policies)) {
            if (typeof val !== "boolean") {
              errors.push(`Invalid decisionEngine policy for ${key}: ${val}. Must be a boolean.`);
            }
          }
        }
      }
    }
  }

  if (updates.marketIntelligence !== undefined) {
    if (typeof updates.marketIntelligence !== "object" || updates.marketIntelligence === null) {
      errors.push("marketIntelligence must be an object.");
    } else {
      if (updates.marketIntelligence.weights !== undefined) {
        if (typeof updates.marketIntelligence.weights !== "object" || updates.marketIntelligence.weights === null) {
          errors.push("marketIntelligence.weights must be an object.");
        } else {
          for (const [key, val] of Object.entries(updates.marketIntelligence.weights)) {
            if (typeof val !== "number" || isNaN(val) || val < 0) {
              errors.push(`Invalid marketIntelligence weight for ${key}: ${val}. Must be a non-negative number.`);
            }
          }
        }
      }
      if (updates.marketIntelligence.thresholds !== undefined) {
        if (typeof updates.marketIntelligence.thresholds !== "object" || updates.marketIntelligence.thresholds === null) {
          errors.push("marketIntelligence.thresholds must be an object.");
        } else {
          for (const [key, val] of Object.entries(updates.marketIntelligence.thresholds)) {
            if (typeof val !== "number" || isNaN(val) || val < 0 || val > 100) {
              errors.push(`Invalid marketIntelligence threshold for ${key}: ${val}. Must be between 0 and 100.`);
            }
          }
        }
      }
    }
  }

  if (updates.paperRisk !== undefined) {
    if (typeof updates.paperRisk !== "object" || updates.paperRisk === null) {
      errors.push("paperRisk must be an object.");
    } else {
      if (updates.paperRisk.maxOpenTrades !== undefined) {
        const val = updates.paperRisk.maxOpenTrades;
        if (typeof val !== "number" || isNaN(val) || val < 1 || !Number.isInteger(val)) {
          errors.push(`Invalid maxOpenTrades: ${val}. Must be an integer >= 1.`);
        }
      }
      if (updates.paperRisk.maxDailyTrades !== undefined) {
        const val = updates.paperRisk.maxDailyTrades;
        if (typeof val !== "number" || isNaN(val) || val < 1 || !Number.isInteger(val)) {
          errors.push(`Invalid maxDailyTrades: ${val}. Must be an integer >= 1.`);
        }
      }
    }
  }

  if (updates.smartEntry !== undefined) {
    if (typeof updates.smartEntry !== "object" || updates.smartEntry === null) {
      errors.push("smartEntry must be an object.");
    } else {
      const keys = ["minimumRR", "preferredRR", "excellentRR", "maximumTpTravelBeforeReject", "maximumSpreadMultiplier", "minimumEntryDistance", "maximumEntryDistance"];
      keys.forEach((key) => {
        if (updates.smartEntry[key] !== undefined) {
          const val = updates.smartEntry[key];
          if (typeof val !== "number" || isNaN(val) || val < 0) {
            errors.push(`Invalid smartEntry parameter for ${key}: ${val}. Must be a non-negative number.`);
          }
        }
      });
    }
  }

  if (updates.tradeLifecycle !== undefined) {
    if (typeof updates.tradeLifecycle !== "object" || updates.tradeLifecycle === null) {
      errors.push("tradeLifecycle must be an object.");
    } else {
      const numericKeys = [
        "breakEvenTriggerPoints", "breakEvenOffsetPoints", "trailDistancePoints", "trailStepPoints",
        "maximumTradeDurationMin", "minimumProgressPoints", "marketExitThreshold", "emergencySpreadMultiplier"
      ];
      numericKeys.forEach((key) => {
        if (updates.tradeLifecycle[key] !== undefined) {
          const val = updates.tradeLifecycle[key];
          if (typeof val !== "number" || isNaN(val) || val < 0) {
            errors.push(`Invalid tradeLifecycle parameter for ${key}: ${val}. Must be a non-negative number.`);
          }
        }
      });
      if (updates.tradeLifecycle.partialProfitStages !== undefined) {
        if (!Array.isArray(updates.tradeLifecycle.partialProfitStages)) {
          errors.push("tradeLifecycle.partialProfitStages must be an array.");
        } else {
          updates.tradeLifecycle.partialProfitStages.forEach((stage, idx) => {
            if (typeof stage !== "object" || stage === null) {
              errors.push(`Invalid stage at index ${idx}: stage must be an object.`);
            } else {
              if (typeof stage.triggerRR !== "number" || isNaN(stage.triggerRR) || stage.triggerRR < 0) {
                errors.push(`Invalid triggerRR at index ${idx}: ${stage.triggerRR}. Must be a non-negative number.`);
              }
              if (typeof stage.closePercent !== "number" || isNaN(stage.closePercent) || stage.closePercent < 0 || stage.closePercent > 100) {
                errors.push(`Invalid closePercent at index ${idx}: ${stage.closePercent}. Must be between 0 and 100.`);
              }
            }
          });
        }
      }
    }
  }

  if (updates.logLevel !== undefined) {
    const validLevels = ["debug", "info", "warn", "error"];
    if (!validLevels.includes(String(updates.logLevel).toLowerCase())) {
      errors.push(`Invalid logLevel: ${updates.logLevel}. Allowed: ${validLevels.join(", ")}`);
    }
  }

  return errors;
}

/**
 * Merges updates recursively into target.
 */
function mergeRecursive(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      mergeRecursive(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

/**
 * Updates configuration settings dynamically.
 * @param {Object} updates - Config overrides
 * @returns {Object} Updated deep-frozen config snapshot
 */
export function updateConfig(updates = {}) {
  if (!currentConfig) {
    throw new Error("System Configuration Manager has not been initialized yet.");
  }

  const validationErrors = validateConfigUpdates(updates);
  if (validationErrors.length > 0) {
    safeLog("warn", "system_config_manager.update_failed", { errors: validationErrors });
    const err = new Error("Configuration Validation Failed");
    err.code = "VALIDATION_FAILED";
    err.errors = validationErrors;
    throw err;
  }

  // Perform merge
  mergeRecursive(currentConfig, updates);
  safeLog("info", "system_config_manager.config_updated", { updates });

  const frozenConfig = getConfig();

  // Notify listeners
  for (const listener of listeners) {
    try {
      listener(frozenConfig);
    } catch (err) {
      safeLog("error", "system_config_manager.listener_error", { error: err.message });
    }
  }

  return frozenConfig;
}

/**
 * Subscribes a callback listener to configuration changes.
 * @param {Function} callback - Listener callback
 */
export function registerListener(callback) {
  if (typeof callback === "function") {
    listeners.add(callback);
  }
}
