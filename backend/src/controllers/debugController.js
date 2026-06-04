import { broadcastLiveUpdateEvent } from "../services/liveUpdateService.js";
import { markSmartAlertCooldown } from "../services/smartAlertEngine.js";
import { logger } from "../utils/logger.js";

const smartAlertDebugPrefix = "[SMART_ALERT_DEBUG]";

export function emitDebugSmartAlertController(_request, response) {
  const alert = {
    id: `debug-smart-alert:${Date.now()}`,
    type: "DEBUG_SMART_ALERT",
    pair: "DEBUGPAIR",
    direction: "BUY",
    confidence: 99,
    activeSignals: 2,
    signalCount: 2,
    freshnessLevel: "VERY_FRESH",
    timestamp: new Date().toISOString(),
    title: "DEBUGPAIR BUY Smart Alert",
    body: "Direction: BUY\nConfidence: 99%\nSignals: 2",
  };

  const sentCount = broadcastLiveUpdateEvent("smart-alert", alert);
  const sent = sentCount > 0;

  if (sent) {
    logger.info(`${smartAlertDebugPrefix} smart-alert pushed into live SSE stream`, {
      pair: alert.pair,
      direction: alert.direction,
      confidence: alert.confidence,
      activeSignals: alert.activeSignals,
      freshnessLevel: alert.freshnessLevel,
      alertType: alert.type,
      eventName: "smart-alert",
      sentCount,
      route: "/api/debug/emit-smart-alert",
    });
    markSmartAlertCooldown(alert);
  }

  response.json({
    ok: sent,
    event: "smart-alert",
    pushedToLiveSseStream: sent,
    sentCount,
    alert,
  });
}
