import { logger } from "../utils/logger.js";

const clients = new Set();
let nextClientId = 1;
const smartAlertDebugPrefix = "[SMART_ALERT_DEBUG]";

export function subscribeToLiveUpdates(request, response) {
  const client = {
    id: nextClientId,
    response,
    heartbeat: null,
  };
  nextClientId += 1;

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 5000\n\n");

  clients.add(client);
  sendEvent(client, "connected", {
    connected: true,
    timestamp: new Date().toISOString(),
  });

  client.heartbeat = setInterval(() => {
    sendEvent(client, "heartbeat", {
      timestamp: new Date().toISOString(),
    });
  }, 25000);

  request.on("close", () => {
    clearInterval(client.heartbeat);
    clients.delete(client);
  });
}

export function broadcastPairStateUpdate(pairState) {
  if (!pairState?.pair || clients.size === 0) {
    return;
  }

  const payload = {
    type: "PAIR_STATE_UPDATED",
    pair: pairState.pair,
    marketDirection: pairState.marketDirection,
    signalCount: pairState.signalCount,
    buyConfidence: pairState.buyConfidence,
    sellConfidence: pairState.sellConfidence,
    timestamp: new Date().toISOString(),
  };

  logger.debug("realtime.pair_state_update_broadcast", {
    pair: pairState.pair,
    clientCount: clients.size,
  });

  for (const client of clients) {
    sendEvent(client, "pair-state-updated", payload);
  }

  logger.debug("realtime.pair_state_update_sent", {
    pair: pairState.pair,
  });
}

export function broadcastSmartAlert(alert) {
  if (!alert?.pair) {
    logger.info(smartAlertDebugPrefix, {
      stage: "SSE broadcast sent",
      sent: false,
      reason: "missing alert pair",
      alertType: alert?.type,
    });
    return false;
  }

  if (clients.size === 0) {
    logger.info(smartAlertDebugPrefix, {
      stage: "before SSE emit",
      pair: alert.pair,
      direction: alert.direction,
      confidence: alert.confidence,
      activeSignals: alert.activeSignals,
      freshnessLevel: alert.freshnessLevel,
      alertType: alert.type,
      clientCount: 0,
    });
    logger.info(smartAlertDebugPrefix, {
      stage: "after SSE emit",
      sent: false,
      reason: "no SSE clients connected",
      pair: alert.pair,
      direction: alert.direction,
      confidence: alert.confidence,
      activeSignals: alert.activeSignals,
      freshnessLevel: alert.freshnessLevel,
      alertType: alert.type,
      clientCount: 0,
      sentCount: 0,
    });
    logger.info(smartAlertDebugPrefix, {
      stage: "SSE broadcast sent",
      sent: false,
      reason: "no SSE clients connected",
      pair: alert.pair,
      alertType: alert.type,
    });
    return false;
  }

  logger.info(smartAlertDebugPrefix, {
    stage: "before SSE emit",
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    freshnessLevel: alert.freshnessLevel,
    alertType: alert.type,
    clientCount: clients.size,
  });
  logger.debug("realtime.smart_alert_broadcast", {
    pair: alert.pair,
    alertType: alert.type,
    clientCount: clients.size,
  });

  let sentCount = 0;
  for (const client of clients) {
    if (sendEvent(client, "smart-alert", alert)) {
      sentCount += 1;
    }
  }

  const sent = sentCount > 0;
  logger.info(smartAlertDebugPrefix, {
    stage: "after SSE emit",
    sent,
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    freshnessLevel: alert.freshnessLevel,
    alertType: alert.type,
    clientCount: clients.size,
    sentCount,
  });

  if (!sent) {
    return false;
  }

  logger.info(`${smartAlertDebugPrefix} smart-alert SSE emit success`, {
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    freshnessLevel: alert.freshnessLevel,
    alertType: alert.type,
    sentCount,
  });
  logger.info(`${smartAlertDebugPrefix} smart-alert SSE broadcasted`, {
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    alertType: alert.type,
    clientCount: clients.size,
  });
  logger.info(smartAlertDebugPrefix, {
    stage: "SSE broadcast sent",
    sent: true,
    pair: alert.pair,
    direction: alert.direction,
    confidence: alert.confidence,
    activeSignals: alert.activeSignals,
    alertType: alert.type,
    clientCount: clients.size,
  });
  return true;
}

function sendEvent(client, eventName, payload) {
  try {
    client.response.write(`event: ${eventName}\n`);
    client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    clearInterval(client.heartbeat);
    clients.delete(client);
    return false;
  }
}
