import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Sends a Telegram alert message to both the VIP and Public channels.
 * Safe to call asynchronously; never throws.
 * 
 * @param {string} pair - Forex pair (e.g. XAUUSD)
 * @param {string} action - Action (e.g. BUY, SELL)
 * @param {number} signalCount - Current active signal count
 * @param {string} messageKey - Signal unique message key
 * @param {object} signalData - Parsed signal object with entry, targets, stopLoss, entryRange
 */
export async function sendTelegramAlert(pair, action, signalCount, messageKey, signalData = {}) {
  const { botToken, channelId, publicChannelId } = config.telegramAlert;
  const displayCount = signalCount || 1;

  if (!botToken) {
    logger.warn("telegram_alert.skipped_missing_bot_token", { messageKey, pair, action });
    return;
  }

  const entry = signalData.entry || signalData.entryRange?.[0] || "CMP";
  const entryRangeStr = signalData.entryRange && signalData.entryRange.length === 2
    ? `${signalData.entryRange[0]} - ${signalData.entryRange[1]}`
    : `${entry}`;

  const targets = signalData.targets || [];
  const sl = signalData.stopLoss || "Open";
  const channelSource = signalData.channelTitle || signalData.channel || "Consensus Engine";

  // 1. VIP Message (Full multi-target breakdown)
  let vipMessage = `👑 *GOLD SIGNAL RADAR™ [VIP SIGNAL]*\n\n`;
  vipMessage += `📊 *Pair:* ${pair}\n`;
  vipMessage += `⚡️ *Action:* ${action === "BUY" ? "🟢 BUY" : "🔴 SELL"}\n`;
  vipMessage += `🎯 *Entry Zone:* ${entryRangeStr}\n\n`;

  if (targets.length > 0) {
    targets.forEach((tp, i) => {
      vipMessage += `🎯 *TP ${i + 1}:* ${tp}\n`;
    });
  } else {
    vipMessage += `🎯 *TP 1:* Open Target\n`;
  }

  vipMessage += `\n🛑 *Stop Loss:* ${sl}\n`;
  vipMessage += `\n📡 *Source / Consensus:* ${channelSource}\n`;
  vipMessage += `⚖️ *Risk:* 1% - 2% | Follow Money Management`;

  // 2. Public Message (High-level clean signal)
  let publicMessage = `📡 *GOLD SIGNAL RADAR™ | NEW TRADE ALERT*\n\n`;
  publicMessage += `📊 *Pair:* ${pair}\n`;
  publicMessage += `⚡️ *Action:* ${action === "BUY" ? "🟢 BUY" : "🔴 SELL"}\n`;
  publicMessage += `🎯 *Entry Zone:* ${entryRangeStr}\n`;
  if (targets.length > 0) {
    publicMessage += `🎯 *TP 1:* ${targets[0]}\n`;
    if (targets.length > 1) {
      publicMessage += `🎯 *Targets:* ${targets.length} Verified Take Profit Levels\n`;
    }
  }
  publicMessage += `🛑 *Stop Loss:* ${sl}\n\n`;
  publicMessage += `👑 _Full Multi-TP targets streaming in VIP Consensus Channel._`;

  // Post to VIP channel
  if (channelId) {
    await postToTelegram(botToken, channelId, vipMessage, "VIP", messageKey);
  }

  // Post to Public channel
  if (publicChannelId && publicChannelId !== channelId) {
    await postToTelegram(botToken, publicChannelId, publicMessage, "PUBLIC", messageKey);
  }
}

async function postToTelegram(botToken, chatId, text, label, messageKey) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("telegram_alert.send_failed", {
        label,
        chatId,
        messageKey,
        status: response.status,
        error: errorText,
      });
      return false;
    }

    logger.info("telegram_alert.send_success", { label, chatId, messageKey });
    return true;
  } catch (error) {
    logger.error("telegram_alert.send_error", {
      label,
      chatId,
      messageKey,
      error: error.message,
    });
    return false;
  }
}
