import { config } from "../config/env.js";

// utils contains small shared helpers used across the backend.
// Structured output keeps parser tuning readable without committing to pino/winston yet.
const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getLogLevel() {
  try {
    if (config && config.logLevel) {
      return config.logLevel;
    }
  } catch (e) {}
  return process.env.LOG_LEVEL || "info";
}

function shouldLog(level) {
  const activeLevel = getLogLevel();
  return levels[level] >= (levels[activeLevel] || levels.info);
}

export const logger = {
  debug: (event, details = {}) => {
    if (shouldLog("debug")) {
      console.log(formatLog("debug", event, details));
    }
  },
  info: (event, details = {}) => {
    if (shouldLog("info")) {
      console.log(formatLog("info", event, details));
    }
  },
  warn: (event, details = {}) => {
    if (shouldLog("warn")) {
      console.warn(formatLog("warn", event, details));
    }
  },
  error: (event, details = {}) => {
    if (shouldLog("error")) {
      console.error(formatLog("error", event, details));
    }
  },
};

function formatLog(level, event, details) {
  return JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
}
