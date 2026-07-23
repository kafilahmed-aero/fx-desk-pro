import { WebSocketServer } from "ws";
import url from "url";
import crypto from "crypto";
import mongoose from "mongoose";
import http from "http";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
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
 * Starts the MT5 Bridge WebSocket Server
 */
export function startMt5SyncService(server = null) {
  if (wss) return;

  const port = getPort();
  const authToken = getAuthToken();

  const attachUpgradeLogger = (targetServer) => {
    targetServer.prependListener("upgrade", (req, socket, head) => {
      socket._upgradedToWs = true;
      console.log(`\n====================================
HTTP UPGRADE EVENT FIRED
====================================
Timestamp: ${new Date().toISOString()}
Remote IP: ${socket.remoteAddress}
Request URL: ${req.url}
====================================\n`);

      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname !== "/mt5" && parsedUrl.pathname !== "/") {
        return; // Skip if it's some other endpoint
      }

      const token = parsedUrl.query?.token || "";
      const headers = req.headers;
      
      console.log(`\n====================================
WEBSOCKET UPGRADE RECEIVED
====================================
Timestamp: ${new Date().toISOString()}
Remote IP: ${req.socket.remoteAddress}
Request URL: ${req.url}
Request Path: ${parsedUrl.pathname}
Query String: ${url.parse(req.url).query || ""}

Headers:
- Host: ${headers['host'] || ""}
- Upgrade: ${headers['upgrade'] || ""}
- Connection: ${headers['connection'] || ""}
- Sec-WebSocket-Key: ${headers['sec-websocket-key'] || ""}
- Sec-WebSocket-Version: ${headers['sec-websocket-version'] || ""}
- User-Agent: ${headers['user-agent'] || ""}
- Origin: ${headers['origin'] || ""}
- Authorization: ${headers['authorization'] || "Not Present"}

Token extracted: ${token}
====================================\n`);

      const state = {
        timestamp: new Date().toISOString(),
        remoteIp: req.socket.remoteAddress,
        method: req.method,
        url: req.url,
        headers: JSON.stringify(req.headers, null, 2),
        upgradeCallbackReached: "YES",
        authPassed: "NO",
        switchingProtocolsSent: "NO",
        socketClosed: "NO",
        closeReason: "N/A"
      };
      req._handshakeState = state;
      printHandshakeLog(state);

      socket.on("drain", () => {
        console.log(`[INSTRUMENTATION] socket emitted "drain" event at ${new Date().toISOString()}`);
      });
      socket.on("error", (err) => {
        console.log(`[INSTRUMENTATION] socket emitted "error" event: ${err.message} at ${new Date().toISOString()}`);
      });

      const originalWrite = socket.write;
      socket.write = function(chunk, encoding, callback) {
        let buffer;
        if (Buffer.isBuffer(chunk)) {
          buffer = chunk;
        } else if (typeof chunk === "string") {
          buffer = Buffer.from(chunk, encoding || "utf8");
        } else {
          buffer = Buffer.from(chunk);
        }

        const hexStr = buffer.toString("hex").match(/.{1,2}/g)?.join(" ") || "";
        const asciiStr = buffer.toString("utf8");

        console.log("========================================");
        console.log("HANDSHAKE TRANSMISSION");
        console.log("========================================");
        console.log("\nTimestamp: " + new Date().toISOString());
        console.log("\nASCII Payload:\n" + asciiStr);
        console.log("\nHEX Payload:\n" + hexStr);
        console.log("========================================");

        const writeRes = originalWrite.apply(this, arguments);
        console.log(`[INSTRUMENTATION] socket.write() returned: ${writeRes}`);
        return writeRes;
      };
    });
  };

  const isProduction = process.env.NODE_ENV === "production";
  if (server && isProduction) {
    wss = new WebSocketServer({ server, path: "/mt5" });
    logger.info("mt5_sync.shared_server_started", { path: "/mt5" });
    attachUpgradeLogger(server);
  } else {
    httpServer = http.createServer((req, res) => {
      const state = {
        timestamp: new Date().toISOString(),
        remoteIp: req.socket.remoteAddress,
        method: req.method,
        url: req.url,
        headers: JSON.stringify(req.headers, null, 2),
        upgradeCallbackReached: "NO",
        authPassed: "NO",
        switchingProtocolsSent: "NO",
        socketClosed: "YES",
        closeReason: "Non-upgrade HTTP request"
      };
      printHandshakeLog(state);

      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Upgrade Required");
    });

    httpServer.on("connection", (socket) => {
      console.log(`\n====================================
TCP CONNECTION ACCEPTED
====================================
Timestamp: ${new Date().toISOString()}
Remote IP: ${socket.remoteAddress}
Remote Port: ${socket.remotePort}
====================================\n`);

      let receivedBytes = 0;
      let rawDataChunks = [];

      socket.on("data", (chunk) => {
        receivedBytes += chunk.length;
        rawDataChunks.push(chunk);

        const hexStr = chunk.toString("hex").match(/.{1,2}/g)?.join(" ") || "";
        const asciiStr = chunk.toString("utf8");

        console.log(`\n====================================
RAW BYTES RECEIVED BEFORE HTTP PARSER
====================================
Timestamp: ${new Date().toISOString()}
Bytes in chunk: ${chunk.length}
Total bytes so far: ${receivedBytes}

ASCII Payload:
${asciiStr}

HEX Payload:
${hexStr}
====================================\n`);
      });

      socket.on("close", (hadError) => {
        if (!socket._upgradedToWs) {
          console.log(`\n====================================
TCP SOCKET CLOSED BEFORE UPGRADE
====================================
Timestamp: ${new Date().toISOString()}
Total Bytes Received: ${receivedBytes}
Had Error: ${hadError}
====================================\n`);
          if (receivedBytes === 0) {
            console.log("TCP connected but zero application bytes received.");
          } else {
            const fullRawRequest = Buffer.concat(rawDataChunks).toString("utf8");
            console.log(`\n====================================
COMPLETE RAW HTTP REQUEST RECEIVED (NO UPGRADE)
====================================
${fullRawRequest}
====================================\n`);
          }
        }
      });

      socket.on("error", (err) => {
        console.log(`\n====================================
TCP SOCKET/PARSER ERROR
====================================
Timestamp: ${new Date().toISOString()}
Error Message: ${err.message}
Error Code: ${err.code}
====================================\n`);
      });
    });

    httpServer.on("request", (req, res) => {
      console.log(`\n====================================
HTTP PARSER EMITTED "REQUEST" EVENT
====================================
Timestamp: ${new Date().toISOString()}
Method: ${req.method}
URL: ${req.url}
====================================\n`);
    });

    wss = new WebSocketServer({ server: httpServer });
    attachUpgradeLogger(httpServer);

    httpServer.listen(port, () => {
      logger.info("mt5_sync.http_server_listening", { port });
    });
    logger.info("mt5_sync.server_started", { port });
  }

  wss.on("headers", (headers, req) => {
    if (req._handshakeState) {
      req._handshakeState.switchingProtocolsSent = "YES";
      printHandshakeLog(req._handshakeState);
    }
  });

  wss.on("connection", (ws, req) => {
    let clientInfo = null;
    let isAuthenticated = false;

    ws._handshakeState = req._handshakeState;

    // Parse token from query parameter: ?token=TOKEN
    const parameters = url.parse(req.url, true).query;
    const token = parameters.token;

    if (token) {
      if (token === authToken) {
        isAuthenticated = true;
        if (ws._handshakeState) {
          ws._handshakeState.authPassed = "YES";
          printHandshakeLog(ws._handshakeState);
        }
      } else {
        logger.warn("mt5_sync.auth_failed_invalid_query_token", { ip: req.socket.remoteAddress });
        if (ws._handshakeState) {
          ws._handshakeState.socketClosed = "YES";
          ws._handshakeState.closeReason = "Invalid Authentication Token";
          printHandshakeLog(ws._handshakeState);
        }
        ws.close(4401, "Invalid Authentication Token");
        return;
      }
    }

    // Set connection close timeout if registration fails
    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) {
        logger.warn("mt5_sync.auth_failed_timeout", { ip: req.socket.remoteAddress });
        if (ws._handshakeState) {
          ws._handshakeState.socketClosed = "YES";
          ws._handshakeState.closeReason = "Authentication Timeout";
          printHandshakeLog(ws._handshakeState);
        }
        ws.close(4401, "Authentication Timeout");
      }
    }, 5000);

    ws.on("message", async (message) => {
      try {
        const payload = JSON.parse(message.toString());
        const eventType = payload.event || payload.action;

        if (!eventType) {
          logger.warn("mt5_sync.invalid_message_format", { message: message.toString() });
          return;
        }

        // Handle PING first
        if (eventType === "PING") {
          ws.send(JSON.stringify({ event: "PONG" }));
          if (clientInfo) clientInfo.lastSeen = Date.now();
          return;
        }

        // Handle PONG
        if (eventType === "PONG") {
          if (clientInfo) {
            clientInfo.lastSeen = Date.now();
          }
          return;
        }

        // Emit trade event for Signal Validation Mode (Stage 6-7 background worker)
        mt5Events.emit("tradeEvent", { eventType, payload });

        // Check database connection state for DB-interactive messages (Issue 1)
        if (mongoose.connection.readyState !== 1 && eventType !== "REGISTER" && eventType !== "PONG") {
          logger.warn("mt5_sync.message_skipped_database_disconnected", { event: eventType });
          return;
        }

        // Handle registration / auth message if not already authenticated
        if (eventType === "REGISTER") {
          const clientToken = payload.token;

          const regReceivedCodes = clientToken ? Array.from(clientToken).map(c => c.charCodeAt(0)) : [];
          const regExpectedCodes = authToken ? Array.from(authToken).map(c => c.charCodeAt(0)) : [];
          console.log("-------------------------");
          console.log("Received Register Token:\n" + clientToken);
          console.log("\nExpected Token:\n" + authToken);
          console.log("\nReceived Length:\n" + (clientToken ? clientToken.length : 0));
          console.log("\nExpected Length:\n" + (authToken ? authToken.length : 0));
          console.log("\nComparison Result:\n" + (clientToken === authToken));
          console.log("-------------------------");

          if (clientToken === authToken || isAuthenticated) {
            const accountId = payload.accountId || `${payload.broker || "broker"}_${payload.accountNumber || "account"}`;

            // Version and Protocol Checks (Improvement 2)
            const clientVersion = payload.eaVersion || "1.00";
            const clientProtocol = payload.protocolVersion !== undefined ? Number(payload.protocolVersion) : 1;

            const MIN_CLIENT_VERSION = "1.00";
            const SUPPORTED_PROTOCOL = 2; // Supported backend protocol version

            const isProduction = process.env.NODE_ENV === "production";
            // Allow protocol v1 only in local dev if not strictly overridden
            if (clientProtocol < SUPPORTED_PROTOCOL && isProduction) {
              logger.warn("mt5_sync.register_failed_protocol_mismatch", { accountId, clientProtocol });
              ws.send(JSON.stringify({ event: "REGISTER", status: "FAILED", reason: "Protocol Version Mismatch" }));
              ws.close(4402, "Protocol Version Mismatch");
              return;
            }

            if (clientVersion < MIN_CLIENT_VERSION) {
              logger.warn("mt5_sync.register_failed_version_outdated", { accountId, clientVersion });
              ws.send(JSON.stringify({ event: "REGISTER", status: "FAILED", reason: "Client Version Outdated" }));
              ws.close(4403, "Client Version Outdated");
              return;
            }

            isAuthenticated = true;
            if (ws._handshakeState) {
              ws._handshakeState.authPassed = "YES";
              printHandshakeLog(ws._handshakeState);
            }
            clearTimeout(authTimeout);

            clientInfo = {
              ws,
              broker: payload.broker || "Unknown",
              server: payload.server || "Unknown",
              accountNumber: payload.accountNumber || "Unknown",
              lastSeen: Date.now(),
              connectedTime: Date.now(),
              eaVersion: clientVersion,
              protocolVersion: clientProtocol
            };

            connectedClients.set(accountId, clientInfo);

            // Record clientStats entry
            const stats = clientStatsRegistry.get(accountId) || { reconnects: 0, errors: 0 };
            clientStatsRegistry.set(accountId, stats);

            logger.info("mt5_sync.ea_registered", {
              accountId,
              broker: clientInfo.broker,
              server: clientInfo.server,
              accountNumber: clientInfo.accountNumber,
              timestamp: new Date()
            });

            ws.send(JSON.stringify({ event: "REGISTER", status: "SUCCESS", accountId }));

            // Trigger positions list request immediately on registration for restart recovery reconciliation
            ws.send(JSON.stringify({ action: "POSITION_LIST" }));

            // Reconnect State Recovery (Improvement 4)
            let activeOpportunities = [];
            let currentAiRecommendation = null;
            try {
              if (mongoose.connection.readyState === 1) {
                const activeOutcomes = await AiRecommendationOutcome.find({
                  simulationMode: "DEMO",
                  status: "ACTIVE"
                }).sort({ createdAt: -1 }).lean();
                
                activeOpportunities = activeOutcomes.map(o => ({
                  recommendationId: o.recommendationId,
                  pair: o.pair,
                  direction: o.direction,
                  entryPrice: o.simulatedEntryPrice || o.entryMin,
                  sl: o.sl,
                  tp: o.tp
                }));

                if (activeOutcomes.length > 0) {
                  currentAiRecommendation = activeOutcomes[0];
                }
              } else {
                logger.info("mt5_sync.state_recovery_db_skipped", { reason: "database_disconnected" });
              }
            } catch (dbErr) {
              logger.error("mt5_sync.state_recovery_db_failed", { error: dbErr.message });
            }

            const statePayload = {
              event: "STATE_SYNC",
              serverTime: new Date().toISOString(),
              backendVersion: "2.0.0",
              protocolVersion: 2,
              heartbeatIntervalSec: 10,
              currentAiRecommendation,
              activeOpportunities,
              pendingCommands: activeOpportunities
            };

            ws.send(JSON.stringify(statePayload));
            logger.info("mt5_sync.state_recovery_sent", { accountId, activeOpportunitiesCount: activeOpportunities.length });

          } else {
            logger.warn("mt5_sync.auth_failed_token_mismatch", { token: clientToken });
            if (ws._handshakeState) {
              ws._handshakeState.socketClosed = "YES";
              ws._handshakeState.closeReason = "Invalid Authentication Token (REGISTER mismatch)";
              printHandshakeLog(ws._handshakeState);
            }
            ws.close(4401, "Invalid Authentication Token");
          }
          return;
        }


        // Reject other messages if not authenticated
        if (!isAuthenticated) {
          logger.warn("mt5_sync.unauthenticated_event_blocked", { event: eventType });
          return;
        }

        // Event Router
        switch (eventType) {
          case "ORDER_ACCEPTED": {
            const { recommendationId } = payload;
            const doc = await AiRecommendationOutcome.findOne({ recommendationId });
            if (doc) {
              doc.executionState = "ORDER_ACCEPTED";
              await doc.save();
              logger.info("mt5_sync.state.order_accepted", {
                recommendationId,
                magicNumber: doc.magicNumber,
                account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                timestamp: new Date()
              });
            }
            break;
          }

          case "ORDER_FILLED": {
            const { recommendationId, ticket, fillPrice, fillTime, slippage, spread, latencyMs } = payload;
            
            // Resolve Signal Validation Mode execution bridge callback
            if (recommendationId && signalCallbacks.has(String(recommendationId))) {
              const cb = signalCallbacks.get(String(recommendationId));
              signalCallbacks.delete(String(recommendationId));
              cb.resolve(payload);
            }

            const doc = await AiRecommendationOutcome.findOne({ recommendationId });
            if (doc) {
              doc.mt5TicketId = String(ticket);
              doc.actualEntryPrice = Number(fillPrice);

              // Calculate executionSlippage: actualEntryPrice - recommendedEntryPrice
              const recommendedPrice = doc.simulatedEntryPrice || (doc.entry && doc.entry.entryPrice) || doc.entryMin || 0;
              const calculatedSlippage = recommendedPrice ? (Number(fillPrice) - recommendedPrice) : 0;
              doc.executionSlippage = Number(calculatedSlippage.toFixed(5));

              doc.spreadAtEntry = spread !== undefined ? Number(spread) : null;
              doc.executionLatencyMs = latencyMs !== undefined ? Number(latencyMs) : null;
              doc.brokerName = clientInfo?.broker || "Unknown";
              doc.serverName = clientInfo?.server || "Unknown";
              doc.accountNumber = clientInfo?.accountNumber || "Unknown";
              doc.lastMt5Sync = new Date();
              doc.executionState = "POSITION_OPEN";

              // Check if partial TP pending
              if (doc.positionManagement && doc.positionManagement.pendingAction === "PARTIAL_TP") {
                const pm = doc.positionManagement;
                const prevStage = pm.lifecycleStage || "POSITION_OPEN";
                const closedVol = pm.pendingVolume || 0;
                pm.partialTpExecuted = true;
                pm.remainingVolume = doc.volume - closedVol;
                pm.lifecycleStage = "PARTIAL_TP_TAKEN";
                pm.pendingAction = null;
                pm.history.push({
                  action: "PARTIAL_TP_CONFIRMED",
                  timestamp: new Date(),
                  previousState: prevStage,
                  newState: "PARTIAL_TP_TAKEN",
                  mt5TicketId: String(ticket),
                  reason: `MT5 confirmed partial close of ${closedVol} lots executed.`
                });
              }

              const fillMsg = `MT5 Order Filled: Ticket ${ticket}, Price ${fillPrice}`;
              if (!doc.simulationNotes.includes(fillMsg)) {
                doc.simulationNotes.push(fillMsg);
              }
              await doc.save();
              logger.info("mt5_sync.state.order_filled", {
                recommendationId,
                magicNumber: doc.magicNumber,
                ticket,
                fillPrice,
                executionSlippage: doc.executionSlippage,
                spreadAtEntry: doc.spreadAtEntry,
                executionLatencyMs: doc.executionLatencyMs,
                account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                timestamp: new Date()
              });
            }
            break;
          }

          case "ORDER_CLOSED": {
            const { recommendationId, ticket, exitPrice, exitTime, reason } = payload;
            // Lookup by ticket first, then recommendationId
            const doc = await AiRecommendationOutcome.findOne({
              $or: [
                { mt5TicketId: String(ticket) },
                { recommendationId }
              ]
            });
            if (doc) {
              doc.actualExitPrice = Number(exitPrice);
              doc.executionState = "POSITION_CLOSED";
              doc.lastMt5Sync = new Date();

              // Map terminal status based on reason if not already closed
              if (["PENDING", "ACTIVE", "PARTIAL_TP"].includes(doc.status)) {
                if (reason === "SL") {
                  doc.status = "SL";
                  doc.exitType = "SL";
                } else if (reason === "TP") {
                  doc.status = "FULL_TP";
                  doc.exitType = "TP";
                } else if (reason === "BREAK_EVEN") {
                  doc.status = "BREAK_EVEN";
                  doc.exitType = "BREAK_EVEN";
                  doc.closedAtBreakEven = true;
                } else {
                  doc.status = "CANCELLED";
                }
                doc.outcomePrice = Number(exitPrice);
                doc.outcomeTime = exitTime ? new Date(exitTime) : new Date();
              }

              doc.executionState = "SYNC_COMPLETE";

              // Position Manager close confirmation
              if (doc.positionManagement) {
                const pm = doc.positionManagement;
                const prevStage = pm.lifecycleStage || "POSITION_OPEN";
                let newState = "SYNC_COMPLETE";
                let actionName = "CLOSE_CONFIRMED";
                let desc = `MT5 confirmed position closed: ${reason}`;
                
                if (pm.pendingAction === "TIME_EXIT") {
                  newState = "TIME_EXIT";
                  actionName = "TIME_EXIT_CONFIRMED";
                  desc = "MT5 confirmed Time Exit executed successfully.";
                  doc.status = "EXPIRED";
                } else if (pm.pendingAction === "MARKET_EXIT") {
                  newState = "MARKET_EXIT";
                  actionName = "MARKET_EXIT_CONFIRMED";
                  desc = "MT5 confirmed Market Exit executed successfully.";
                  doc.status = "CANCELLED";
                } else if (reason === "SL") {
                  newState = "SL_HIT";
                  actionName = "SL_HIT_CONFIRMED";
                  desc = "Stop Loss hit on MT5 terminal.";
                } else if (reason === "TP") {
                  newState = "FULL_TP";
                  actionName = "TP_HIT_CONFIRMED";
                  desc = "Take Profit hit on MT5 terminal.";
                }
                
                pm.lifecycleStage = newState;
                pm.pendingAction = null;
                pm.history.push({
                  action: actionName,
                  timestamp: new Date(),
                  previousState: prevStage,
                  newState,
                  mt5TicketId: String(ticket),
                  reason: desc
                });
              }
              const closeMsg = `MT5 Order Closed: Ticket ${ticket}, Price ${exitPrice}, Reason ${reason}`;
              if (!doc.simulationNotes.includes(closeMsg)) {
                doc.simulationNotes.push(closeMsg);
              }
              await doc.save();
              logger.info("mt5_sync.state.order_closed", {
                recommendationId: doc.recommendationId,
                magicNumber: doc.magicNumber,
                ticket,
                exitPrice,
                reason,
                account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                timestamp: new Date()
              });
            }
            break;
          }

          case "ORDER_MODIFIED": {
            const { recommendationId, ticket, sl, tp } = payload;
            const doc = await AiRecommendationOutcome.findOne({
              $or: [
                { mt5TicketId: String(ticket) },
                { recommendationId }
              ]
            });
            if (doc) {
              doc.simulatedSL = sl !== undefined ? Number(sl) : doc.simulatedSL;
              if (tp !== undefined) {
                // If the TP modified, update the low/moderate/high TP boundaries to match
                if (doc.lowRiskTp) doc.lowRiskTp = Number(tp);
                else if (doc.moderateTp) doc.moderateTp = Number(tp);
                else if (doc.highRiskTp) doc.highRiskTp = Number(tp);
              }
              doc.lastMt5Sync = new Date();

              // Position Manager SL modification confirmation
              if (doc.positionManagement) {
                const pm = doc.positionManagement;
                const prevStage = pm.lifecycleStage || "POSITION_OPEN";
                if (pm.pendingAction === "BREAK_EVEN") {
                  pm.breakEvenTriggered = true;
                  pm.breakEvenActive = true;
                  pm.lifecycleStage = "BREAK_EVEN_ACTIVE";
                  pm.pendingAction = null;
                  pm.history.push({
                    action: "BREAK_EVEN_CONFIRMED",
                    timestamp: new Date(),
                    previousState: prevStage,
                    newState: "BREAK_EVEN_ACTIVE",
                    mt5TicketId: String(ticket),
                    reason: "MT5 confirmed Stop Loss moved to Entry"
                  });
                } else if (pm.pendingAction === "TRAILING_STOP") {
                  pm.lastTrailingSL = sl !== undefined ? Number(sl) : pm.lastTrailingSL;
                  pm.lifecycleStage = "TRAILING_ACTIVE";
                  pm.pendingAction = null;
                  pm.history.push({
                    action: "TRAILING_STOP_CONFIRMED",
                    timestamp: new Date(),
                    previousState: prevStage,
                    newState: "TRAILING_ACTIVE",
                    mt5TicketId: String(ticket),
                    reason: `MT5 confirmed Trailing SL adjusted to ${sl}`
                  });
                }
              }
              const modMsg = `MT5 Order Modified: SL ${sl}, TP ${tp}`;
              if (!doc.simulationNotes.includes(modMsg)) {
                doc.simulationNotes.push(modMsg);
              }
              await doc.save();
              logger.info("mt5_sync.order_modified", {
                recommendationId: doc.recommendationId,
                magicNumber: doc.magicNumber,
                ticket,
                sl,
                tp,
                account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                timestamp: new Date()
              });
            }
            break;
          }

          case "TRADE_FAILED": {
            const { recommendationId, reason, retcode } = payload;

            // Reject Signal Validation Mode execution bridge callback
            if (recommendationId && signalCallbacks.has(String(recommendationId))) {
              const cb = signalCallbacks.get(String(recommendationId));
              signalCallbacks.delete(String(recommendationId));
              cb.reject(new Error(reason || `MT5 trade execution failed with retcode: ${retcode}`));
            }

            const doc = await AiRecommendationOutcome.findOne({ recommendationId });
            if (doc) {
              // Revert execution state to null and set status to CANCELLED to prevent auto-retry
              doc.executionState = null;
              doc.executionStatus = "BLOCKED";
              doc.status = "CANCELLED";
              const failMsg = `MT5 Trade Failed: ${reason} (Code: ${retcode || "Unknown"}). Auto-retry disabled.`;
              if (!doc.simulationNotes.includes(failMsg)) {
                doc.simulationNotes.push(failMsg);
              }
              await doc.save();
              logger.warn("mt5_sync.trade_failed", {
                recommendationId,
                magicNumber: doc.magicNumber,
                reason,
                retcode: retcode || "Unknown",
                account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                timestamp: new Date()
              });
            }
            break;
          }

          case "ACCOUNT_SUMMARY": {
            logger.info("mt5_sync.account_summary", {
              accountId: payload.accountId,
              balance: payload.balance,
              equity: payload.equity,
              timestamp: new Date()
            });
            break;
          }

          case "POSITION_LIST": {
            const { positions } = payload;
            const incomingPositions = Array.isArray(positions) ? positions : [];
            logger.info("mt5_sync.position_list_received", {
              account: clientInfo?.accountNumber || clientInfo?.accountId,
              positionCount: incomingPositions.length
            });
            break;
          }

          default:
            logger.warn("mt5_sync.unknown_event_type", { event: eventType });
        }
      } catch (err) {
        logger.error("mt5_sync.message_processing_failed", { error: err.message, raw: message.toString() });
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(authTimeout);
      if (ws._handshakeState) {
        ws._handshakeState.socketClosed = "YES";
        ws._handshakeState.closeReason = `Code: ${code}, Reason: ${reason.toString() || "None"}`;
        printHandshakeLog(ws._handshakeState);
      }
      if (clientInfo) {
        // Clean up from registry
        for (const [key, value] of connectedClients.entries()) {
          if (value.ws === ws) {
            connectedClients.delete(key);

            // Record stats registry disconnect entry (Improvement 3)
            const stats = clientStatsRegistry.get(key) || { reconnects: 0, errors: 0 };
            stats.reconnects = (stats.reconnects || 0) + 1;
            stats.lastDisconnectReason = `Code: ${code}, Reason: ${reason.toString() || "None"}`;
            clientStatsRegistry.set(key, stats);
            reconnectsToday++;

            logger.info("mt5_sync.ea_disconnected", { accountId: key, code, reason: reason.toString() });
            break;
          }
        }
      }
    });

    ws.on("error", (err) => {
      logger.error("mt5_sync.websocket_client_error", { error: err.message });
      if (clientInfo) {
        for (const [key, value] of connectedClients.entries()) {
          if (value.ws === ws) {
            const stats = clientStatsRegistry.get(key) || { reconnects: 0, errors: 0 };
            stats.errors = (stats.errors || 0) + 1;
            clientStatsRegistry.set(key, stats);
            break;
          }
        }
      }
      if (ws._handshakeState) {
        ws._handshakeState.socketClosed = "YES";
        ws._handshakeState.closeReason = `Socket Error: ${err.message}`;
        printHandshakeLog(ws._handshakeState);
      }
    });
  });

  // Start MongoDB Change Stream & fallback polling
  startChangeStreamListener();

  // Setup periodic reconciliation loop (every 5 minutes)
  reconciliationInterval = setInterval(runReconciliation, 5 * 60 * 1000);

  // Setup heartbeat ping loop (every 10 seconds) with timeout checks
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const pingPayload = JSON.stringify({ action: "PING" });
    for (const [accountId, client] of connectedClients.entries()) {
      const lastSeen = client.lastSeen || now;
      const inactiveMs = now - lastSeen;

      if (inactiveMs > 60000) {
        logger.warn("mt5_sync.heartbeat_timeout_disconnecting", { accountId, inactiveMs });
        // Increment errors for health score tracking
        const stats = clientStatsRegistry.get(accountId) || { reconnects: 0, errors: 0 };
        stats.errors = (stats.errors || 0) + 1;
        clientStatsRegistry.set(accountId, stats);

        client.ws.close(4408, "Heartbeat Timeout");
        connectedClients.delete(accountId);
      } else {
        if (client.ws.readyState === 1) {
          try {
            client.ws.send(pingPayload);
          } catch (err) {
            logger.error("mt5_sync.heartbeat_failed", { accountId, error: err.message });
          }
        }
      }
    }
  }, 10000);
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
