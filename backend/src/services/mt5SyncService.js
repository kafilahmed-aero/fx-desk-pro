import { WebSocketServer } from "ws";
import url from "url";
import crypto from "crypto";
import mongoose from "mongoose";
import http from "http";
import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import { EventEmitter } from "events";

export const mt5Events = new EventEmitter();

// Shared callbacks registry for Signal Validation Mode (Stage 5)
export const signalCallbacks = new Map(); // signalId -> { resolve, reject }

// Global connection registry
export const connectedClients = new Map(); // key: accountId / accountNumber, value: { ws, broker, server, accountNumber, lastSeen, connectedTime, eaVersion, protocolVersion }
export const clientStatsRegistry = new Map(); // key: accountId, value: { reconnects, errors }

let wss = null;
let httpServer = null;
let changeStream = null;
let reconciliationInterval = null;
let pollingInterval = null;
let heartbeatInterval = null;
let reconnectsToday = 0;
const startTimestamp = Date.now();

function getAuthToken() {
  return process.env.MT5_BRIDGE_AUTH_TOKEN || "default-mt5-token-change-me";
}

function getPort() {
  return Number(process.env.MT5_BRIDGE_PORT) || 8080;
}

/**
 * Generates a deterministic magic number (8-digit uint32) from a recommendationId
 */
export function generateMagicNumber(recommendationId) {
  if (!recommendationId) return 0;
  const hash = crypto.createHash("sha256").update(recommendationId).digest();
  const rawNum = hash.readUInt32BE(0);
  return (rawNum % 100000000); // 8-digit range (0 to 99999999)
}

/**
 * Broadcasts a JSON message to all connected MT5 EAs (optionally filtered by targetAccountId)
 */
export function broadcastToEAs(msg, targetAccountId = null) {
  const payload = JSON.stringify(msg);
  let sentCount = 0;
  
  logger.info("DEBUG broadcastToEAs", {
    connectedClientsSize: connectedClients.size,
    targetAccountId,
    clients: Array.from(connectedClients.keys()).map(k => ({
      accountId: k,
      readyState: connectedClients.get(k).ws ? connectedClients.get(k).ws.readyState : "no ws"
    }))
  });

  for (const [accountId, client] of connectedClients.entries()) {
    if (!targetAccountId || accountId === targetAccountId || client.accountNumber === targetAccountId) {
      if (client.ws && client.ws.readyState === 1) { // 1 = OPEN
        try {
          if (msg.action === "OPEN_ORDER") {
            logger.info("T2: Sending OPEN_ORDER", { payload });
          }
          client.ws.send(payload);
          if (msg.action === "OPEN_ORDER") {
            logger.info("T3: OPEN_ORDER sent");
          }
          sentCount++;
        } catch (err) {
          logger.error("mt5_sync.send_error", { accountId, error: err.message });
        }
      }
    }
  }

  if (sentCount === 0) {
    logger.warn("mt5_sync.broadcast_no_recipients", { action: msg.action, targetAccountId });
  }
}

/**
 * Handles sending an open order command to connected EAs
 */
export async function handleSendOpenOrder(doc) {
  logger.info("T1: Preparing OPEN_ORDER");
  if (doc.executionState === "ORDER_SENT" || doc.executionState === "ORDER_ACCEPTED" || doc.executionState === "ORDER_FILLED" || doc.executionState === "POSITION_OPEN") {
    return;
  }

  const magicNumber = generateMagicNumber(doc.recommendationId);

  // Update DB state
  doc.executionState = "ORDER_SENT";
  doc.magicNumber = magicNumber;
  if (!doc.simulationNotes.includes("MT5 Bridge: Order opening instruction sent.")) {
    doc.simulationNotes.push("MT5 Bridge: Order opening instruction sent.");
  }
  await doc.save();

  logger.info("mt5_sync.sending_open_order", { recommendationId: doc.recommendationId, magicNumber });

  // Map to direction volume entry and SL/TP configurations
  const direction = doc.direction === "BUY" ? "BUY" : "SELL";
  const lot = doc.simulationMode === "DEMO"
    ? (config.autoTrade?.lotSize || 0.01)
    : 0.1;
  
  // Decide target TP level (default lowRiskTp or moderateTp or highRiskTp)
  const tpPrice = doc.lowRiskTp || doc.moderateTp || doc.highRiskTp || null;

  const msg = {
    action: "OPEN_ORDER",
    recommendationId: doc.recommendationId,
    magicNumber,
    symbol: doc.pair,
    direction,
    volume: lot,
    price: doc.simulatedEntryPrice || doc.entryMin,
    sl: doc.simulatedSL || doc.sl,
    tp: tpPrice
  };

  broadcastToEAs(msg, doc.mt5AccountId);
}

/**
 * Handles sending a close order command to connected EAs
 */
export async function handleSendCloseOrder(doc) {
  if (!doc.mt5TicketId) {
    logger.warn("mt5_sync.cannot_close_missing_ticket", { recommendationId: doc.recommendationId });
    return;
  }

  if (doc.executionState === "POSITION_CLOSED" || doc.executionState === "SYNC_COMPLETE") {
    return;
  }

  // Update state
  doc.executionState = "POSITION_CLOSED";
  if (!doc.simulationNotes.includes("MT5 Bridge: Order closing instruction sent.")) {
    doc.simulationNotes.push("MT5 Bridge: Order closing instruction sent.");
  }
  await doc.save();

  logger.info("mt5_sync.sending_close_order", { recommendationId: doc.recommendationId, ticket: doc.mt5TicketId });

  const msg = {
    action: "CLOSE_ORDER",
    recommendationId: doc.recommendationId,
    magicNumber: doc.magicNumber,
    ticket: doc.mt5TicketId
  };

  broadcastToEAs(msg, doc.mt5AccountId);
}

/**
 * MongoDB Change Stream Event Watcher
 */
function startChangeStreamListener() {
  try {
    const db = mongoose.connection;
    if (!db || db.readyState !== 1 || !db.db) {
      logger.warn("mt5_sync.change_stream_skipped", { reason: "database_not_connected" });
      startFallbackPolling();
      return;
    }

    const collection = db.collection("aiRecommendationOutcomes");
    changeStream = collection.watch();

    changeStream.on("change", async (change) => {
      try {
        if (change.operationType === "update" || change.operationType === "insert") {
          const docId = change.documentKey._id;
          const doc = await AiRecommendationOutcome.findById(docId);
          if (!doc || doc.simulationMode !== "DEMO") return;

          // React ONLY to execution lifecycle changes
          if (doc.status === "ACTIVE" && (!doc.executionState || doc.executionState === "WAITING_FOR_MT5")) {
            await handleSendOpenOrder(doc);
          } else if (["FULL_TP", "SL", "BREAK_EVEN", "EXPIRED", "CANCELLED"].includes(doc.status) && doc.executionState === "POSITION_OPEN") {
            await handleSendCloseOrder(doc);
          }
        }
      } catch (err) {
        logger.error("mt5_sync.change_stream_event_error", { error: err.message });
      }
    });

    changeStream.on("error", (err) => {
      logger.error("mt5_sync.change_stream_error", { error: err.message });
      // Fall back to polling if replica set error occurs
      startFallbackPolling();
    });

    logger.info("mt5_sync.change_stream_listening");
  } catch (err) {
    logger.error("mt5_sync.change_stream_setup_failed", { error: err.message });
    startFallbackPolling();
  }
}

/**
 * Fallback database polling logic for standalone MongoDB setups
 */
function startFallbackPolling() {
  if (pollingInterval) return;

  logger.info("mt5_sync.fallback_polling_started");
  pollingInterval = setInterval(async () => {
    try {
      // Check database state (Issue 1)
      const dbState = mongoose.connection.readyState;
      if (dbState !== 1) {
        // Log info details to audit connection params
        const conn = mongoose.connection;
        const host = conn.host || "unknown-host";
        const dbName = conn.name || "unknown-db";
        logger.debug("mt5_sync.polling_skipped", { 
          reason: "database_disconnected", 
          readyState: dbState,
          database: dbName,
          host: host
        });
        return;
      }

      // 1. Process WAITING -> ACTIVE -> ORDER_SENT
      const pendingOpen = await AiRecommendationOutcome.find({
        simulationMode: "DEMO",
        status: "ACTIVE",
        $or: [
          { executionState: null },
          { executionState: "WAITING_FOR_MT5" }
        ]
      });

      for (const doc of pendingOpen) {
        await handleSendOpenOrder(doc);
      }

      // 2. Process ACTIVE -> TERMINAL -> POSITION_CLOSED
      const pendingClose = await AiRecommendationOutcome.find({
        simulationMode: "DEMO",
        status: { $in: ["FULL_TP", "SL", "BREAK_EVEN", "EXPIRED", "CANCELLED"] },
        executionState: "POSITION_OPEN"
      });

      for (const doc of pendingClose) {
        await handleSendCloseOrder(doc);
      }
    } catch (err) {
      logger.error("mt5_sync.polling_error", { error: err.message });
    }
  }, 15000);
}

/**
 * Reconciliation loop comparing active DB outcomes with active MT5 positions
 */
export async function runReconciliation() {
  try {
    if (connectedClients.size === 0) {
      logger.debug("mt5_sync.reconciliation_skipped", { reason: "no_clients_connected" });
      return;
    }

    logger.info("mt5_sync.reconciliation_triggered", { activeClients: connectedClients.size });

    // Request active positions from all connected accounts
    broadcastToEAs({ action: "POSITION_LIST" });
  } catch (err) {
    logger.error("mt5_sync.reconciliation_failed", { error: err.message });
  }
}

function printHandshakeLog(state) {
  console.log(`===== MT5 HANDSHAKE =====
Timestamp: ${state.timestamp}
Remote IP: ${state.remoteIp}
HTTP Method: ${state.method}
HTTP URL: ${state.url}
All Request Headers: ${state.headers}
Upgrade callback reached: ${state.upgradeCallbackReached}
Authentication passed: ${state.authPassed}
101 Switching Protocols sent: ${state.switchingProtocolsSent}
Socket closed: ${state.socketClosed}
Close reason: ${state.closeReason}
=========================`);
}

/**
 * Starts the MT5 Bridge WebSocket Server (DISABLED IN FX DESK PRO)
 * Note: MT5 Bridge is owned exclusively by FX Execute engine.
 */
export function startMt5SyncService(server = null) {
  logger.info("mt5_sync.disabled_in_fx_desk_pro", {
    message: "MT5 Bridge belongs exclusively to FX Execute execution engine."
  });
}

/**
 * Stops the MT5 Bridge WebSocket Server and associated services
 */
export function stopMt5SyncService() {
  if (changeStream && typeof changeStream.close === "function") {
    changeStream.close();
    changeStream = null;
  }
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (wss) {
    wss.close(() => {
      logger.info("mt5_sync.server_stopped");
    });
    wss = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  connectedClients.clear();
}

export function getMt5BridgeStatus() {
  const clients = [];
  const now = Date.now();

  for (const [accountId, client] of connectedClients.entries()) {
    // Calculate health score (Improvement 3)
    const stats = clientStatsRegistry.get(accountId) || { reconnects: 0, errors: 0 };
    const lastSeen = client.lastSeen || now;
    const delay = Math.max(0, (now - lastSeen) / 1000 - 10); // delay beyond 10s heartbeat
    
    // Heartbeat delay deduction
    let score = 100;
    if (delay > 20) score -= 40; // STALE (missing 30s)
    else if (delay > 10) score -= 20;

    // Reconnect deduction
    score -= Math.min(30, (stats.reconnects || 0) * 5);

    // Errors deduction
    score -= Math.min(30, (stats.errors || 0) * 10);

    // Duration bonus
    const durationMin = (now - (client.connectedTime || now)) / 60000;
    if (durationMin > 360) score += 10;
    else if (durationMin > 60) score += 5;

    score = Math.max(0, Math.min(100, score));

    let healthRating = "Excellent";
    if (score < 40) healthRating = "Critical";
    else if (score < 70) healthRating = "Warning";
    else if (score < 85) healthRating = "Good";

    // Client status based on heartbeat delay
    const clientStatus = (now - lastSeen > 30000) ? "STALE" : "CONNECTED";

    clients.push({
      accountId,
      broker: client.broker,
      server: client.server,
      accountNumber: client.accountNumber,
      clientVersion: client.eaVersion || "1.00",
      protocolVersion: client.protocolVersion || 1,
      lastSeen: new Date(lastSeen).toISOString(),
      connectionDurationMin: Math.round(durationMin),
      healthScore: score,
      healthRating,
      status: clientStatus,
      reconnectCount: stats.reconnects || 0,
      errorCount: stats.errors || 0
    });
  }

  return {
    status: wss ? "ACTIVE" : "INACTIVE",
    connectedClients: connectedClients.size,
    reconnectsToday,
    uptimeSec: Math.round((now - startTimestamp) / 1000),
    clients
  };
}
