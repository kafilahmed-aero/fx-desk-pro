import { config } from "../config/env.js";

/**
 * Evaluates whether the current local time in Asia/Kolkata timezone 
 * falls within the configured trading session interval (AI_SESSION_START_IST and AI_SESSION_END_IST).
 * 
 * Supports sessions crossing midnight (e.g. 23:00 to 04:00).
 * 
 * @param {Date} now - Optional Date instance to evaluate (defaults to current time)
 * @returns {boolean} True if trading session is active, false otherwise
 */
export function isAiTradingSessionActive(now = new Date()) {
  const startStr = config.aiSessionStartIst || "17:30";
  const endStr = config.aiSessionEndIst || "21:30";

  const [startH, startM] = startStr.split(":").map(Number);
  const [endH, endM] = endStr.split(":").map(Number);

  // Format to Asia/Kolkata timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const currentH = Number(parts.find(p => p.type === "hour").value);
  const currentM = Number(parts.find(p => p.type === "minute").value);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const currentMinutes = currentH * 60 + currentM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Session wraps around midnight
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

/**
 * Evaluates whether any high-impact USD economic calendar event matching override 
 * triggers is scheduled or published within 2 hours of the current time.
 * 
 * @param {Object} newsContext - News and calendar context payload
 * @param {Date} now - Optional Date instance representing current time
 * @returns {boolean} True if a matching high-impact override is active, false otherwise
 */
export function hasEmergencyMacroEvent(newsContext, now = new Date()) {
  if (!newsContext || !Array.isArray(newsContext.highImpactEvents)) {
    return false;
  }

  const overrideKeywords = [
    "NFP",
    "NON-FARM",
    "EMPLOYMENT",
    "CPI",
    "INFLATION",
    "CONSUMER PRICE INDEX",
    "PPI",
    "PRODUCER PRICE INDEX",
    "FOMC",
    "FEDERAL OPEN MARKET",
    "FED SPEECH",
    "POWELL",
    "INTEREST RATE",
    "FUNDS RATE",
    "RATE DECISION",
    "SPEECH",
    "UNEMPLOYMENT",
    "GDP"
  ];

  return newsContext.highImpactEvents.some(event => {
    const titleUpper = String(event.title || "").toUpperCase();
    const matchesKeyword = overrideKeywords.some(keyword => titleUpper.includes(keyword));
    
    if (!matchesKeyword) return false;

    try {
      const eventTime = new Date(event.publishedAt).getTime();
      const timeDiffMs = Math.abs(now.getTime() - eventTime);
      const diffMinutes = timeDiffMs / (1000 * 60);
      return diffMinutes <= 120; // Active within a 2-hour window
    } catch {
      return false;
    }
  });
}
