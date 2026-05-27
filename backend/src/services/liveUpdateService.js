import { logger } from "../utils/logger.js";

const clients = new Set();
let nextClientId = 1;

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

function sendEvent(client, eventName, payload) {
  try {
    client.response.write(`event: ${eventName}\n`);
    client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (_error) {
    clearInterval(client.heartbeat);
    clients.delete(client);
  }
}
