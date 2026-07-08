import { WebSocketServer } from "ws";
import url from "url";
import crypto from "crypto";
import mongoose from "mongoose";
import http from "http";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { logger } from "../utils/logger.js";

// Global connection registry
export const connectedClients = new Map(); // key: accountId / accountNumber, value: { ws, broker, server, accountNumber, lastSeen }

let wss = null;
let httpServer = null;
let changeStream = null;
let reconciliationInterval = null;
let pollingInterval = null;
let heartbeatInterval = null;

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

  for (const [accountId, client] of connectedClients.entries()) {
    if (!targetAccountId || accountId === targetAccountId || client.accountNumber === targetAccountId) {
      if (client.ws && client.ws.readyState === 1) { // 1 = OPEN
        try {
          client.ws.send(payload);
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
  const lot = 0.1; // Default volume for demo account execution
  
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
    if (!db || db.readyState !== 1) {
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
  }, 2000);
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
export function startMt5SyncService() {
  if (wss) return;

  const port = getPort();
  const authToken = getAuthToken();

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

  wss = new WebSocketServer({ server: httpServer });
  logger.info("mt5_sync.server_started", { port });

  httpServer.prependListener("upgrade", (req, socket, head) => {
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

      socket.once("drain", () => console.log("BACKEND SOCKET EVENT: drain"));
      socket.once("finish", () => console.log("BACKEND SOCKET EVENT: finish"));
      socket.once("close", (hadError) => console.log("BACKEND SOCKET EVENT: close (hadError=" + hadError + ")"));
      socket.once("error", (err) => console.log("BACKEND SOCKET EVENT: error (" + err.message + ")"));

      const writeResult = originalWrite.apply(this, arguments);
      console.log("\nsocket.write() return value: " + writeResult);
      console.log("\nsocket.bytesWritten: " + socket.bytesWritten);
      console.log("\nsocket.destroyed: " + socket.destroyed);
      console.log("\nsocket.writable: " + socket.writable);
      console.log("\n========================================");

      return writeResult;
    };
  });

  httpServer.on("upgrade", (req, socket, head) => {
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
  });

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
      const receivedCodes = token ? Array.from(token).map(c => c.charCodeAt(0)) : [];
      const expectedCodes = authToken ? Array.from(authToken).map(c => c.charCodeAt(0)) : [];
      console.log("-------------------------");
      console.log("Received Query Token:\n" + token);
      console.log("\nExpected Token:\n" + authToken);
      console.log("\nReceived Length:\n" + (token ? token.length : 0));
      console.log("\nExpected Length:\n" + (authToken ? authToken.length : 0));
      console.log("\nComparison Result:\n" + (token === authToken));
      console.log("\nCharacter Codes:\nReceived:\n" + JSON.stringify(receivedCodes) + "\n\nExpected:\n" + JSON.stringify(expectedCodes));
      console.log("-------------------------");

      if (token === authToken) {
        isAuthenticated = true;
        if (ws._handshakeState) {
          ws._handshakeState.authPassed = "YES";
          printHandshakeLog(ws._handshakeState);
        }
      } else {
        console.log("REJECTED BY: `if (token === authToken)` else block (Line 342)");
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
        console.log("REJECTED BY: `authTimeout` timeout block (Line 358)");
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

        if (eventType === "PONG") {
          if (clientInfo) clientInfo.lastSeen = Date.now();
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
          console.log("\nCharacter Codes:\nReceived:\n" + JSON.stringify(regReceivedCodes) + "\n\nExpected:\n" + JSON.stringify(regExpectedCodes));
          console.log("-------------------------");

          if (clientToken === authToken || isAuthenticated) {
            isAuthenticated = true;
            if (ws._handshakeState) {
              ws._handshakeState.authPassed = "YES";
              printHandshakeLog(ws._handshakeState);
            }
            clearTimeout(authTimeout);

            const accountId = payload.accountId || `${payload.broker || "broker"}_${payload.accountNumber || "account"}`;
            
            clientInfo = {
              ws,
              broker: payload.broker || "Unknown",
              server: payload.server || "Unknown",
              accountNumber: payload.accountNumber || "Unknown",
              lastSeen: Date.now()
            };

            connectedClients.set(accountId, clientInfo);
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
          } else {
            console.log("REJECTED BY: `if (clientToken === authToken || isAuthenticated)` else block (Line 447)");
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

            // Fetch active DEMO outcomes in DB
            const activeDbTrades = await AiRecommendationOutcome.find({
              simulationMode: "DEMO",
              status: "ACTIVE"
            });

            for (const trade of activeDbTrades) {
              // Look for matching position in active MT5 positions by ticket or magic number
              const matched = incomingPositions.find(
                (pos) => String(pos.ticket) === String(trade.mt5TicketId) ||
                         Number(pos.magic) === Number(trade.magicNumber)
              );

              if (!matched) {
                // Pos not found on MT5 -> Close locally as CANCELLED or EXPIRED
                trade.status = "CANCELLED";
                trade.executionState = "SYNC_COMPLETE";
                trade.outcomeTime = new Date();
                
                const recMsg = "Reconciliation: Active position not found on MT5. Closed locally.";
                if (!trade.simulationNotes.includes(recMsg)) {
                  trade.simulationNotes.push(recMsg);
                }
                trade.lastMt5Sync = new Date();
                await trade.save();
                logger.info("mt5_sync.reconciliation.closed_local_mismatch", {
                  recommendationId: trade.recommendationId,
                  magicNumber: trade.magicNumber,
                  account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                  timestamp: new Date()
                });
              }
            }

            // Sync: Filled in MT5 but waiting/sent in DB
            // And look for positions on MT5 that should be closed because they are closed in DB
            for (const pos of incomingPositions) {
              const trade = await AiRecommendationOutcome.findOne({
                $or: [
                  { mt5TicketId: String(pos.ticket) },
                  { magicNumber: Number(pos.magic) }
                ]
              });

              if (trade) {
                if (["PENDING", "ACTIVE"].includes(trade.status) && trade.executionState !== "POSITION_OPEN") {
                  // State mismatch: Trade is filled on MT5 but still waiting/sent in DB
                  trade.status = "ACTIVE";
                  trade.executionState = "POSITION_OPEN";
                  trade.mt5TicketId = String(pos.ticket);
                  trade.actualEntryPrice = Number(pos.openPrice);
                  trade.lastMt5Sync = new Date();
                  
                  const fillMsg = `Reconciliation: Position found active on MT5. Updated to POSITION_OPEN (Ticket: ${pos.ticket}).`;
                  if (!trade.simulationNotes.includes(fillMsg)) {
                    trade.simulationNotes.push(fillMsg);
                  }
                  await trade.save();
                  logger.info("mt5_sync.reconciliation.sync_waiting_to_open", {
                    recommendationId: trade.recommendationId,
                    magicNumber: trade.magicNumber,
                    ticket: pos.ticket,
                    account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                    timestamp: new Date()
                  });
                } else if (["FULL_TP", "SL", "BREAK_EVEN", "EXPIRED", "CANCELLED"].includes(trade.status)) {
                  logger.warn("mt5_sync.reconciliation.zombie_position_on_mt5", {
                    recommendationId: trade.recommendationId,
                    magicNumber: trade.magicNumber,
                    ticket: pos.ticket,
                    dbStatus: trade.status,
                    account: `${clientInfo?.broker}_${clientInfo?.accountNumber}`,
                    timestamp: new Date()
                  });
                  // Send closing command
                  ws.send(JSON.stringify({
                    action: "CLOSE_ORDER",
                    recommendationId: trade.recommendationId,
                    magicNumber: trade.magicNumber,
                    ticket: String(pos.ticket)
                  }));
                }
              }
            }
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
            logger.info("mt5_sync.ea_disconnected", { accountId: key, code, reason: reason.toString() });
            break;
          }
        }
      }
    });

    ws.on("error", (err) => {
      logger.error("mt5_sync.websocket_client_error", { error: err.message });
      if (ws._handshakeState) {
        ws._handshakeState.socketClosed = "YES";
        ws._handshakeState.closeReason = `Socket Error: ${err.message}`;
        printHandshakeLog(ws._handshakeState);
      }
    });
  });

  httpServer.listen(port, () => {
    logger.info("mt5_sync.http_server_listening", { port });
  });

  // Start MongoDB Change Stream & fallback polling
  startChangeStreamListener();

  // Setup periodic reconciliation loop (every 5 minutes)
  reconciliationInterval = setInterval(runReconciliation, 5 * 60 * 1000);

  // Setup heartbeat ping loop (every 10 seconds)
  heartbeatInterval = setInterval(() => {
    const pingPayload = JSON.stringify({ action: "PING" });
    for (const [accountId, client] of connectedClients.entries()) {
      if (client.ws.readyState === 1) {
        try {
          client.ws.send(pingPayload);
        } catch (err) {
          logger.error("mt5_sync.heartbeat_failed", { accountId, error: err.message });
        }
      }
    }
  }, 10000);
}

/**
 * Stops the MT5 Bridge WebSocket Server and associated services
 */
export function stopMt5SyncService() {
  if (changeStream) {
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
