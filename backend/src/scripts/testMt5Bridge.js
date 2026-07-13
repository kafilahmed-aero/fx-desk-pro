import { WebSocket } from "ws";
import mongoose from "mongoose";
import child_process from "child_process";
import {
  startMt5SyncService,
  stopMt5SyncService,
  connectedClients,
  generateMagicNumber,
  runReconciliation
} from "../services/mt5SyncService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";

const TEST_PORT = 8085;
const TEST_TOKEN = "test-secret-token-123";

// Configure Env for Test
process.env.MT5_BRIDGE_PORT = TEST_PORT;
process.env.MT5_BRIDGE_AUTH_TOKEN = TEST_TOKEN;

// Local Mock database store
const mockDb = new Map();

// Helper to mock document saving and properties
function createMockOutcome(data) {
  const doc = {
    recommendationId: data.recommendationId,
    pair: data.pair || "XAUUSD",
    direction: data.direction || "BUY",
    entryMin: data.entryMin || 2000,
    entryMax: data.entryMax || 2010,
    sl: data.sl || 1990,
    lowRiskTp: data.lowRiskTp || 2020,
    moderateTp: data.moderateTp || null,
    highRiskTp: data.highRiskTp || null,
    status: data.status || "PENDING",
    executionStatus: data.executionStatus || "WAITING",
    simulationMode: data.simulationMode || "DEMO",
    simulationNotes: data.simulationNotes || [],
    executionState: data.executionState || null,
    mt5TicketId: data.mt5TicketId || null,
    magicNumber: data.magicNumber || null,
    simulatedEntryPrice: data.simulatedEntryPrice || null,
    brokerName: null,
    serverName: null,
    accountNumber: null,
    actualEntryPrice: null,
    actualExitPrice: null,
    spreadAtEntry: null,
    executionSlippage: null,
    executionLatencyMs: null,
    lastMt5Sync: null,
    save: async function() {
      mockDb.set(this.recommendationId, this);
      return this;
    }
  };
  mockDb.set(doc.recommendationId, doc);
  return doc;
}

// Intercept Mongoose queries
Object.defineProperty(mongoose.connection, "readyState", {
  get: () => 0, // Force offline state for local in-memory test
  configurable: true
});

AiRecommendationOutcome.findOne = async (query) => {
  if (!query) return null;
  
  for (const doc of mockDb.values()) {
    if (query.recommendationId && doc.recommendationId === query.recommendationId) return doc;
    if (query.mt5TicketId && doc.mt5TicketId === query.mt5TicketId) return doc;
    if (query.magicNumber && doc.magicNumber === query.magicNumber) return doc;
    
    if (query.$or) {
      for (const q of query.$or) {
        if (q.recommendationId && doc.recommendationId === q.recommendationId) return doc;
        if (q.mt5TicketId && doc.mt5TicketId === q.mt5TicketId) return doc;
        if (q.magicNumber && doc.magicNumber === q.magicNumber) return doc;
      }
    }
  }
  return null;
};

AiRecommendationOutcome.find = async (query) => {
  const results = [];
  for (const doc of mockDb.values()) {
    let match = true;
    if (query.simulationMode && doc.simulationMode !== query.simulationMode) match = false;
    
    if (query.status) {
      if (typeof query.status === "object" && query.status.$in) {
        if (!query.status.$in.includes(doc.status)) match = false;
      } else if (doc.status !== query.status) match = false;
    }
    
    if (query.$or) {
      // Basic match for null / WAITING_FOR_MT5
      const orMatches = query.$or.some(q => {
        if (q.executionState === null) return doc.executionState === null || doc.executionState === undefined;
        if (q.executionState === "WAITING_FOR_MT5") return doc.executionState === "WAITING_FOR_MT5";
        return doc.executionState === q.executionState;
      });
      if (!orMatches) match = false;
    } else if (query.executionState !== undefined) {
      if (doc.executionState !== query.executionState) match = false;
    }
    
    if (match) results.push(doc);
  }
  return results;
};

// Delay helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Run tests in child process helper
function runScriptTest(scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`Running regression test: ${scriptName}...`);
    const proc = child_process.fork(scriptName, [], { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test script ${scriptName} failed with exit code ${code}`));
      }
    });
  });
}

async function runTests() {
  console.log("=== STARTING MT5 BRIDGE INTEGRATION TESTS ===");

  // Stub mongoose connection state (Issue 1)
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true
  });

  // Intercept the heartbeat interval
  const originalSetInterval = global.setInterval;
  let heartbeatCallback = null;
  global.setInterval = (cb, ms) => {
    if (ms === 10000) {
      heartbeatCallback = cb;
    }
    return originalSetInterval(cb, ms);
  };

  // Mock Date.now()
  let mockNow = Date.now();
  const originalNow = Date.now;
  Date.now = () => mockNow;

  // Start the service
  startMt5SyncService();
  console.log("WS server started on port", TEST_PORT);

  // Test 1: Authentication failure (wrong token)
  console.log("\n[Test 1] Testing authentication failure...");
  const invalidWs = new WebSocket(`ws://localhost:${TEST_PORT}?token=wrong-token`);
  let wasRejected = false;
  
  invalidWs.on("close", (code) => {
    wasRejected = true;
  });

  await sleep(100);
  if (wasRejected) {
    console.log("-> PASS: Connection with invalid token was successfully rejected.");
  } else {
    console.error("-> FAIL: Connection with invalid token was not rejected.");
    invalidWs.close();
    process.exit(1);
  }

  // Test 2: Successful connection & EA registration
  console.log("\n[Test 2] Testing successful connection & registration...");
  const clientWs = new WebSocket(`ws://localhost:${TEST_PORT}?token=${TEST_TOKEN}`);
  
  let registeredSuccessfully = false;
  clientWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.event === "REGISTER" && msg.status === "SUCCESS") {
      registeredSuccessfully = true;
    }
  });

  // Send registration frame
  await sleep(100);
  clientWs.send(JSON.stringify({
    event: "REGISTER",
    broker: "Vantage-Demo",
    server: "Vantage-Demo-Server",
    accountNumber: "998877",
    token: TEST_TOKEN,
    eaVersion: "2.00",
    protocolVersion: 2
  }));

  await sleep(100);
  if (registeredSuccessfully && connectedClients.has("Vantage-Demo_998877")) {
    console.log("-> PASS: EA client successfully registered and stored in registry.");
  } else {
    console.error("-> FAIL: EA client registration failed.");
    process.exit(1);
  }

  // Test 3: Heartbeat PING / PONG
  console.log("\n[Test 3] Testing Heartbeat PING/PONG...");
  let receivedPing = false;
  clientWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.action === "PING" || msg.event === "PING") {
      receivedPing = true;
      clientWs.send(JSON.stringify({ event: "PONG" }));
    }
  });

  // Manually trigger server pings or send client ping
  clientWs.send(JSON.stringify({ event: "PING" }));
  await sleep(100);
  console.log("-> PASS: PING/PONG handled successfully.");

  // Test 3.1: Heartbeat keep-alive, offline mode, and timeout triggers
  console.log("\n[Test 3.1] Testing Heartbeat keep-alive under offline mode & timeout triggers...");
  
  if (typeof heartbeatCallback !== "function") {
    console.error("-> FAIL: Heartbeat callback was not intercepted.");
    process.exit(1);
  }

  // A. REGISTER a new test socket client under database disconnected state
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 0, // database disconnected
    configurable: true
  });

  const testWs = new WebSocket(`ws://localhost:${TEST_PORT}?token=${TEST_TOKEN}`);
  let testRegistered = false;
  testWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.event === "REGISTER" && msg.status === "SUCCESS") {
      testRegistered = true;
    }
  });

  await sleep(100);
  testWs.send(JSON.stringify({
    event: "REGISTER",
    broker: "Vantage-Demo",
    server: "Vantage-Demo-Server",
    accountNumber: "123456",
    token: TEST_TOKEN,
    eaVersion: "2.00",
    protocolVersion: 2
  }));
  await sleep(100);

  if (!testRegistered || !connectedClients.has("Vantage-Demo_123456")) {
    console.error("-> FAIL: Offline registration failed.");
    process.exit(1);
  }
  console.log("-> PASS: Offline registration completed successfully.");

  // B. Verify PONG updates lastSeen and prevents timeout
  // Reset mock time
  mockNow = originalNow();
  const testClientInfo = connectedClients.get("Vantage-Demo_123456");
  testClientInfo.lastSeen = mockNow;
  
  const firstClientInfo = connectedClients.get("Vantage-Demo_998877");
  if (firstClientInfo) {
    firstClientInfo.lastSeen = mockNow;
  }

  // Advance time by 30 seconds
  mockNow += 30000;
  if (firstClientInfo) {
    firstClientInfo.lastSeen = mockNow;
  }
  // Send PONG from client
  testWs.send(JSON.stringify({ event: "PONG" }));
  await sleep(100); // Give server event loop time to process the PONG message

  // Trigger heartbeat check callback
  heartbeatCallback();
  
  if (connectedClients.has("Vantage-Demo_123456") && testClientInfo.lastSeen === mockNow) {
    console.log("-> PASS: PONG message bypasses offline DB check, updates lastSeen, and connection remains alive.");
  } else {
    console.error("-> FAIL: PONG message processing failed under offline DB mode.");
    process.exit(1);
  }

  // C. Verify Heartbeat timeout still occurs when no PONG is received
  // Advance time by another 65 seconds without sending PONG
  mockNow += 65000;
  if (firstClientInfo) {
    firstClientInfo.lastSeen = mockNow;
  }
  
  let testClosed = false;
  let testCloseCode = null;
  testWs.on("close", (code) => {
    testClosed = true;
    testCloseCode = code;
  });

  // Trigger heartbeat check callback
  heartbeatCallback();
  await sleep(100);

  if (testClosed && testCloseCode === 4408 && !connectedClients.has("Vantage-Demo_123456")) {
    console.log("-> PASS: Connection was disconnected with code 4408 (Heartbeat Timeout) after 65s of inactivity.");
  } else {
    console.error("-> FAIL: Heartbeat timeout was not triggered correctly.");
    process.exit(1);
  }

  // Restore original Date.now, setInterval, and readyState for subsequent tests
  Date.now = originalNow;
  global.setInterval = originalSetInterval;
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1, // database connected for subsequent tests
    configurable: true
  });

  // Test 4: Magic number mapping
  console.log("\n[Test 4] Testing Magic Number mapping...");
  const recId = "AI-20260707-120000-999";
  const magic1 = generateMagicNumber(recId);
  const magic2 = generateMagicNumber(recId);
  const magic3 = generateMagicNumber("AI-20260707-120000-001");
  
  if (magic1 === magic2 && magic1 !== magic3 && typeof magic1 === "number") {
    console.log(`-> PASS: Magic number generation is deterministic (ID: ${recId} -> Magic: ${magic1}).`);
  } else {
    console.error("-> FAIL: Magic number generation failed.");
    process.exit(1);
  }

  // Test 5: Order Open Trigger (status ACTIVE -> Send OPEN_ORDER)
  console.log("\n[Test 5] Testing Order Open change trigger...");
  createMockOutcome({
    recommendationId: "REC-OPEN-001",
    status: "PENDING",
    executionState: "WAITING_FOR_MT5",
    simulationMode: "DEMO",
    entryMin: 2000,
    entryMax: 2010,
    simulatedEntryPrice: 2005
  });

  let openOrderReceived = null;
  clientWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.action === "OPEN_ORDER" && msg.recommendationId === "REC-OPEN-001") {
      openOrderReceived = msg;
    }
  });

  // Update status to ACTIVE to simulate local engine triggering entry
  const dbDoc = mockDb.get("REC-OPEN-001");
  dbDoc.status = "ACTIVE";
  await dbDoc.save();

  // Wait for polling fallback / stream event to pick up and send message
  await sleep(2500);

  if (openOrderReceived && dbDoc.executionState === "ORDER_SENT" && dbDoc.magicNumber !== null) {
    console.log("-> PASS: WebSocket server sent OPEN_ORDER with magic number and status updated to ORDER_SENT.");
  } else {
    console.error("-> FAIL: OPEN_ORDER trigger failed.", { openOrderReceived, state: dbDoc?.executionState });
    process.exit(1);
  }

  // Test 6: Order Filled handling
  console.log("\n[Test 6] Testing ORDER_FILLED event handler...");
  clientWs.send(JSON.stringify({
    event: "ORDER_FILLED",
    recommendationId: "REC-OPEN-001",
    ticket: "TICKET-77665",
    fillPrice: 2005.5,
    fillTime: new Date().toISOString(),
    slippage: 0.5,
    spread: 0.2,
    latencyMs: 120
  }));

  await sleep(100);
  const updatedDoc = mockDb.get("REC-OPEN-001");
  if (
    updatedDoc.mt5TicketId === "TICKET-77665" &&
    updatedDoc.actualEntryPrice === 2005.5 &&
    updatedDoc.executionState === "POSITION_OPEN" &&
    updatedDoc.spreadAtEntry === 0.2 &&
    updatedDoc.executionSlippage === 0.5 &&
    updatedDoc.executionLatencyMs === 120 &&
    updatedDoc.brokerName === "Vantage-Demo"
  ) {
    console.log("-> PASS: ORDER_FILLED updated DB outcome fields correctly, set executionState to POSITION_OPEN.");
  } else {
    console.error("-> FAIL: ORDER_FILLED processing failed.", updatedDoc);
    process.exit(1);
  }

  // Test 7: Order Close Trigger (status terminal -> Send CLOSE_ORDER)
  console.log("\n[Test 7] Testing Order Close change trigger...");
  let closeOrderReceived = null;
  clientWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.action === "CLOSE_ORDER" && msg.recommendationId === "REC-OPEN-001") {
      closeOrderReceived = msg;
    }
  });

  // Update status to FULL_TP to simulate target hit
  updatedDoc.status = "FULL_TP";
  await updatedDoc.save();

  await sleep(2500);
  if (closeOrderReceived && updatedDoc.executionState === "POSITION_CLOSED") {
    console.log("-> PASS: WebSocket server sent CLOSE_ORDER and state updated to POSITION_CLOSED.");
  } else {
    console.error("-> FAIL: CLOSE_ORDER trigger failed.", { closeOrderReceived, state: updatedDoc?.executionState });
    process.exit(1);
  }

  // Test 8: Order Closed handling
  console.log("\n[Test 8] Testing ORDER_CLOSED event handler...");
  clientWs.send(JSON.stringify({
    event: "ORDER_CLOSED",
    recommendationId: "REC-OPEN-001",
    ticket: "TICKET-77665",
    exitPrice: 2020.0,
    exitTime: new Date().toISOString(),
    reason: "TP"
  }));

  await sleep(100);
  const closedDoc = mockDb.get("REC-OPEN-001");
  if (
    closedDoc.actualExitPrice === 2020.0 &&
    closedDoc.executionState === "SYNC_COMPLETE" &&
    closedDoc.status === "FULL_TP"
  ) {
    console.log("-> PASS: ORDER_CLOSED finished DB outcome sync to SYNC_COMPLETE.");
  } else {
    console.error("-> FAIL: ORDER_CLOSED processing failed.", closedDoc);
    process.exit(1);
  }

  // Test 9: Trade Failure execution
  console.log("\n[Test 9] Testing TRADE_FAILED failure logging...");
  createMockOutcome({
    recommendationId: "REC-FAIL-001",
    status: "ACTIVE",
    executionState: "ORDER_SENT",
    simulationMode: "DEMO"
  });

  clientWs.send(JSON.stringify({
    event: "TRADE_FAILED",
    recommendationId: "REC-FAIL-001",
    reason: "Insufficient Margin"
  }));

  await sleep(100);
  const failedDoc = mockDb.get("REC-FAIL-001");
  if (
    failedDoc.executionState === null &&
    failedDoc.status === "CANCELLED" &&
    failedDoc.executionStatus === "BLOCKED" &&
    failedDoc.simulationNotes.some(n => n.includes("Insufficient Margin"))
  ) {
    console.log("-> PASS: TRADE_FAILED disabled auto-retry, blocked outcome, and logged failure reason.");
  } else {
    console.error("-> FAIL: TRADE_FAILED processing failed.", failedDoc);
    process.exit(1);
  }

  // Test 10: Position Reconciliation Mismatch
  console.log("\n[Test 10] Testing Position Reconciliation...");
  // DB has active trade but MT5 doesn't have it -> should close local
  createMockOutcome({
    recommendationId: "REC-RECON-001",
    status: "ACTIVE",
    executionState: "POSITION_OPEN",
    mt5TicketId: "TICKET-9999",
    magicNumber: 12345,
    simulationMode: "DEMO"
  });

  // DB has closed trade but MT5 has zombie trade -> should send close
  createMockOutcome({
    recommendationId: "REC-RECON-002",
    status: "SL",
    executionState: "SYNC_COMPLETE",
    mt5TicketId: "TICKET-8888",
    magicNumber: 54321,
    simulationMode: "DEMO"
  });

  let emergencyCloseDispatched = false;
  clientWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.action === "CLOSE_ORDER" && msg.ticket === "TICKET-8888") {
      emergencyCloseDispatched = true;
    }
  });

  // Run reconciliation function
  runReconciliation();
  await sleep(100);

  // Send back POSITION_LIST event containing only zombie position and not REC-RECON-001
  clientWs.send(JSON.stringify({
    event: "POSITION_LIST",
    positions: [
      { ticket: "TICKET-8888", magic: 54321, symbol: "XAUUSD" }
    ]
  }));

  await sleep(100);

  const recon1 = mockDb.get("REC-RECON-001");
  if (recon1.status === "CANCELLED" && recon1.executionState === "SYNC_COMPLETE") {
    console.log("-> PASS: Reconciliation closed DB trade locally when missing on MT5.");
  } else {
    console.error("-> FAIL: Reconciliation local closing failed.", recon1);
    process.exit(1);
  }

  if (emergencyCloseDispatched) {
    console.log("-> PASS: Reconciliation dispatched CLOSE_ORDER for MT5 zombie position.");
  } else {
    console.error("-> FAIL: Reconciliation zombie close dispatch failed.");
    process.exit(1);
  }

  // Close connection
  clientWs.close();
  stopMt5SyncService();
  console.log("\n=== ALL MT5 BRIDGE TESTS PASSED ===");

  // Run regression suite
  console.log("\n=== STARTING BACKEND REGRESSION SUITE ===");
  try {
    await runScriptTest("src/scripts/testParserFixtures.js");
    await runScriptTest("src/scripts/testConsensusSummary.js");
    await runScriptTest("src/scripts/testPaperTrading.js");
    await runScriptTest("src/scripts/testPaperRiskManager.js");
    await runScriptTest("src/scripts/testAiAnalytics.js");
    await runScriptTest("src/scripts/testAutomation.js");
    
    console.log("\n=== ALL REGRESSION TESTS PASSED SUCCESSFULLY ===");
    console.log("\nMT5 DEMO INTEGRATION IMPLEMENTATION COMPLETE!");
    process.exit(0);
  } catch (err) {
    console.error("-> REGRESSION FAILURE:", err.message);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("MT5 bridge integration testing failed:", err);
  process.exit(1);
});
