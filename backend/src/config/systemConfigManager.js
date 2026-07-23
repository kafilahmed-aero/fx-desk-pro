import { logger } from "../utils/logger.js";

function safeLog(level, event, details = {}) {
  try {
    if (typeof logger !== "undefined" && logger && logger[level]) {
      logger[level](event, details);
      return;
    }
  } catch (e) {}
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

export function initializeManager(rawConfig) {
  currentConfig = JSON.parse(JSON.stringify(rawConfig));
  safeLog("info", "system_config_manager.initialized");
}

export function getConfig() {
  if (!currentConfig) {
    throw new Error("System Configuration Manager has not been initialized yet.");
  }
  return deepFreeze(JSON.parse(JSON.stringify(currentConfig)));
}

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

  checkPort(updates.port);
  checkExpiration(updates.signalExpirationMinutes);
  checkRetention(updates.priceHistoryRetentionHours);

  if (updates.logLevel !== undefined) {
    const validLevels = ["debug", "info", "warn", "error"];
    if (!validLevels.includes(String(updates.logLevel).toLowerCase())) {
      errors.push(`Invalid logLevel: ${updates.logLevel}. Allowed: ${validLevels.join(", ")}`);
    }
  }

  return errors;
}

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

  mergeRecursive(currentConfig, updates);
  safeLog("info", "system_config_manager.config_updated", { updates });

  const frozenConfig = getConfig();

  for (const listener of listeners) {
    try {
      listener(frozenConfig);
    } catch (err) {
      safeLog("error", "system_config_manager.listener_error", { error: err.message });
    }
  }

  return frozenConfig;
}

export function registerListener(callback) {
  if (typeof callback === "function") {
    listeners.add(callback);
  }
}
