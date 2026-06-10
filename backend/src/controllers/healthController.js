import { getLiveStabilitySnapshot } from "../services/liveStabilityService.js";
import { logger } from "../utils/logger.js";
import { getRawMessages } from "../services/rawMessageStore.js";
import { getParsedSignals } from "../services/parsedSignalStore.js";

// controllers contain request handlers.
// Keeping handlers here prevents route files from growing too large.
export function getHealth(_request, response) {
  response.json({
    status: "Backend running",
  });
}

export function getLiveStability(_request, response) {
  logger.debug("api.live_stability_requested");

  response.json({
    stability: getLiveStabilitySnapshot(),
  });
}

export async function getDebugSignals(_request, response) {
  try {
    const raw = await getRawMessages(5);
    const parsed = await getParsedSignals(5);
    response.json({ raw, parsed });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}

import { sendTelegramAlert } from "../services/telegramAlertService.js";
import { processRawMessage } from "../services/signalProcessingService.js";

export async function triggerTelegramTestAlert(request, response) {
  try {
    const { pair = "EURUSD", action = "BUY", signalCount = 4 } = request.body || {};
    const testMessageKey = `test_endpoint:${Date.now()}`;
    await sendTelegramAlert(pair, action, signalCount, testMessageKey);
    response.json({ success: true, messageKey: testMessageKey });
  } catch (err) {
    logger.error("api.test_telegram_alert_failed", { error: err.message });
    response.status(500).json({ error: err.message });
  }
}

export async function triggerTestSignal(request, response) {
  try {
    const { pair = "EURUSD", action = "BUY" } = request.body || {};
    const rawMessage = {
      channel: "debug_channel_123",
      channelTitle: "Debug Ingest Channel",
      messageId: 10000 + Math.floor(Math.random() * 90000),
      text: `${action} ${pair} ENTRY 1.0850 TP 1.0900 SL 1.0800`,
      hasText: true,
      hasMedia: false,
      mediaType: null,
      textLength: 43,
      timestamp: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
    const result = await processRawMessage(rawMessage);
    response.json({ success: true, result });
  } catch (err) {
    logger.error("api.trigger_test_signal_failed", { error: err.message });
    response.status(500).json({ error: err.message });
  }
}
