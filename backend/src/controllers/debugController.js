import { broadcastDebugSmartAlert } from "../services/liveUpdateService.js";

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

  const sent = broadcastDebugSmartAlert(alert);

  response.json({
    ok: sent,
    event: "smart-alert",
    bypassedCooldown: true,
    alert,
  });
}
