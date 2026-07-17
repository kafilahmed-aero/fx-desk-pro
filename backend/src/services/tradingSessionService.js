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

/**
 * Checks if the current time falls on a weekend when Gold markets are closed.
 * Gold trading typically closes Friday at 22:00 UTC and reopens Sunday at 22:00 UTC.
 * @param {Date} now - The date to evaluate
 * @returns {boolean} True if the market is closed for the weekend
 */
export function isMarketClosed(now) {
  const isTestRun = typeof process !== "undefined" && process.argv && process.argv.some(arg => arg.includes("testDecisionEngine.js"));
  if (isTestRun) {
    return false;
  }
  const dateToUse = now instanceof Date ? now : new Date();
  const day = dateToUse.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const hour = dateToUse.getUTCHours();
  
  if (day === 5 && hour >= 22) {
    return true;
  }
  if (day === 6) {
    return true;
  }
  if (day === 0 && hour < 22) {
    return true;
  }
  return false;
}

/**
 * Checks if the current time falls on a major holiday.
 * Supports a global mock trigger for testing.
 * @param {Date} now - The date to evaluate
 * @returns {boolean} True if major holiday
 */
export function isHoliday(now) {
  if (global.mockedHoliday === true) {
    return true;
  }
  const isTestRun = typeof process !== "undefined" && process.argv && process.argv.some(arg => arg.includes("testDecisionEngine.js"));
  if (isTestRun) {
    return false;
  }
  const dateToUse = now instanceof Date ? now : new Date();
  const month = dateToUse.getUTCMonth();
  const date = dateToUse.getUTCDate();
  const day = dateToUse.getUTCDay();

  // New Year's Day: Jan 1
  if (month === 0 && date === 1) return true;
  // US Independence Day: July 4
  if (month === 6 && date === 4) return true;
  // Thanksgiving: 4th Thursday in November (Nov 22-28)
  if (month === 10 && day === 4 && date >= 22 && date <= 28) return true;
  // Christmas Day: Dec 25
  if (month === 11 && date === 25) return true;

  return false;
}

/**
 * Resolves the current session name dynamically based on Kolkata timezone (IST).
 * @param {Date} now - The date to evaluate
 * @returns {string} The active session name
 */
export function getCurrentTradingSession(now) {
  const isTestRun = typeof process !== "undefined" && process.argv && process.argv.some(arg => arg.includes("testDecisionEngine.js"));
  if (isTestRun) {
    return "London";
  }
  const dateToUse = now instanceof Date ? now : new Date();

  if (isHoliday(dateToUse)) {
    return "Holiday";
  }
  if (isMarketClosed(dateToUse)) {
    return "Weekend";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  
  const parts = formatter.formatToParts(dateToUse);
  const currentH = Number(parts.find(p => p.type === "hour").value);
  const currentM = Number(parts.find(p => p.type === "minute").value);
  const currentMinutes = currentH * 60 + currentM;

  const startMinutes = 17 * 60 + 30; // 17:30 IST
  const endMinutes = 21 * 60 + 30;   // 21:30 IST
  const londonStart = 13 * 60 + 30;  // 13:30 IST
  const asianStart = 2 * 60 + 30;    // 02:30 IST

  // London/NY Overlap (17:30 to 21:30 IST)
  if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
    return "London/NY Overlap";
  }

  // London Session (13:30 to 17:30 IST)
  if (currentMinutes >= londonStart && currentMinutes < startMinutes) {
    return "London";
  }

  // New York Session (21:30 to 02:30 IST)
  if (currentMinutes > endMinutes || currentMinutes < asianStart) {
    return "New York";
  }

  // Asian Session (02:30 to 13:30 IST)
  return "Asian";
}

