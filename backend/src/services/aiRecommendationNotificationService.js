import crypto from "crypto";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { isAiTradingSessionActive, hasEmergencyMacroEvent } from "./tradingSessionService.js";
import { getXauusdNewsContext } from "./xauusdNewsService.js";

// In-memory deduplication state
const state = {
  lastSentHash: null,
  lastSentAt: null
};

/**
 * Computes MD5 hash of relevant recommendation fields
 * @param {Object} rec - Recommendation object
 * @returns {string} Hex hash string
 */
function hashRecommendation(rec) {
  const payload = {
    direction: rec.direction,
    entryMin: rec.entryMin,
    entryMax: rec.entryMax,
    sl: rec.sl,
    tp: rec.tp,
    reasoning: rec.reasoning
  };
  return crypto.createHash("md5").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Returns current notification memory state.
 * @returns {Object} State
 */
export function getNotificationState() {
  return state;
}

/**
 * Delivers Telegram notification if the recommendation has changed.
 * @param {Object} recommendation - AI consensus recommendation object
 */
export async function sendAiRecommendationIfChanged(recommendation) {
  if (!recommendation || recommendation.status === "error" || recommendation.status === "pending") {
    logger.debug("ai_notification.skipped_invalid_recommendation");
    return;
  }

  const currentHash = hashRecommendation(recommendation);

  if (currentHash === state.lastSentHash) {
    logger.debug("ai_notification.skipped_duplicate_recommendation");
    return;
  }

  const { botToken, channelId } = config.telegramAlert;

  if (!botToken || !channelId) {
    logger.warn("ai_notification.skipped_missing_config");
    // Prevent repeated warnings by updating tracking fields
    state.lastSentHash = currentHash;
    state.lastSentAt = new Date().toISOString();
    return;
  }

  // Construct message fields
  const direction = recommendation.direction.toUpperCase();
  const entry = recommendation.entryMin && recommendation.entryMax
    ? `${recommendation.entryMin} - ${recommendation.entryMax}`
    : "N/A";
  const sl = recommendation.sl || "N/A";
  const tp = recommendation.tp || "N/A";
  const reasons = recommendation.reasoning
    ? recommendation.reasoning.map(r => `• ${r}`).join("\n")
    : "";

  const formatTime = (dateStr) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    
    const tzString = date.toLocaleDateString("en-US", { timeZoneName: "short" }).split(", ")[1] || "IST";
    return `${yyyy}-${mm}-${dd} ${hh}:${min} ${tzString}`;
  };

  const updatedTime = formatTime(recommendation.lastGenerationTime);

  const message = `🤖 XAUUSD DECISION ENGINE UPDATE\n\n` +
                  `Direction:\n${direction}\n\n` +
                  `Entry:\n${entry}\n\n` +
                  `SL:\n${sl}\n\n` +
                  `TP:\n${tp}\n\n` +
                  `Reasons:\n${reasons}\n\n` +
                  `Updated:\n${updatedTime}`;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: channelId,
        text: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("ai_notification.send_failed", {
        status: response.status,
        error: errorText,
      });
      return;
    }

    state.lastSentHash = currentHash;
    state.lastSentAt = new Date().toISOString();

    logger.info("ai_notification.send_success", {
      direction,
      entryMin: recommendation.entryMin,
      entryMax: recommendation.entryMax
    });

  } catch (error) {
    logger.warn("ai_notification.send_error", {
      error: error.message,
    });
  }
}
