// utils contains small shared helpers used across the backend.
// Structured output keeps parser tuning readable without committing to pino/winston yet.
export const logger = {
  info: (event, details = {}) => console.log(formatLog("info", event, details)),
  error: (event, details = {}) => console.error(formatLog("error", event, details)),
};

function formatLog(level, event, details) {
  return JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
}
