import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Sends a Telegram alert message to the configured channel.
 * This function handles its own errors internally and is safe to call asynchronously.
 * 
 * @param {string} pair - Forex pair (e.g. EURUSD)
 * @param {string} action - Action (e.g. BUY, SELL)
 * @param {string} messageKey - Signal unique message key (e.g. channel:messageId)
 */
export async function sendTelegramAlert(pair, action, messageKey) {
  const { botToken, channelId } = config.telegramAlert;

  if (!botToken || !channelId) {
    logger.warn("telegram_alert.skipped_missing_config", {
      messageKey,
      pair,
      action,
      hasBotToken: !!botToken,
      hasChannelId: !!channelId,
    });
    return;
  }

  const message = `🚨 FX DESK PRO ALERT\n\nPAIR: ${pair}\nACTION: ${action}`;

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
      logger.error("telegram_alert.send_failed", {
        messageKey,
        pair,
        action,
        status: response.status,
        error: errorText,
      });
      return;
    }

    logger.info("telegram_alert.send_success", {
      messageKey,
      pair,
      action,
    });
  } catch (error) {
    logger.error("telegram_alert.send_error", {
      messageKey,
      pair,
      action,
      error: error.message,
    });
  }
}
