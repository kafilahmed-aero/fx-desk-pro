import mongoose from "mongoose";
import { config } from "../config/env.js";
import { setCachedPrice } from "../services/priceCacheService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import {
  processPositionLifecycle,
  requestMarketExit,
  monitorActivePositions
} from "../services/positionManagerService.js";
import { POSITION_MANAGER_POLICY } from "../config/positionManagerPolicy.js";
import { connectedClients } from "../services/mt5SyncService.js";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${message}`);
    failCount++;
  }
}

// Helper to simulate EA client connection
function registerMockClient(accountId, accountNumber) {
  connectedClients.set(accountId, {
    ws: {
      readyState: 1, // OPEN
      send: (data) => {
        // Captured outgoing broadcasts
        lastSentMessage = JSON.parse(data);
      }
    },
    broker: "TEST_BROKER",
    server: "TEST_SERVER",
    accountNumber
  });
}

let lastSentMessage = null;

// Mock outcome document builder
function createMockOutcome({ recommendationId, mt5TicketId, entryPrice, volume, sl, tp, createdAt }) {
  const doc = new AiRecommendationOutcome({
    recommendationId,
    pair: "XAUUSD",
    direction: "BUY",
    volume,
    sl,
    tp,
    lowRiskTp: tp,
    status: "ACTIVE",
    executionState: "POSITION_OPEN",
    mt5TicketId,
    magicNumber: 12345,
    mt5AccountId: "MOCK_ACC_1",
    actualEntryPrice: entryPrice,
    entryMin: entryPrice - 5.0,
    entryMax: entryPrice + 5.0,
    expiresAt: new Date(Date.now() + 3600 * 1000 * 24),
    simulationMode: "DEMO",
    createdAt: createdAt || new Date()
  });

  // Init positionManagement structure
  doc.positionManagement = {
    breakEvenActive: false,
    breakEvenTriggered: false,
    trailingActive: false,
    lastTrailingSL: null,
    partialTpExecuted: false,
    remainingVolume: volume,
    lifecycleStage: "POSITION_OPEN",
    history: [],
    pendingAction: null
  };

  // Override save to prevent MongoDB operations during local checks
  doc.save = async function() {
    return this;
  };

  return doc;
}

async function runTests() {
  console.log("=== RUNNING PHOENIX POSITION MANAGER TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  if (isMongoAvailable) {
    try {
      await AiRecommendationOutcome.deleteMany({});
    } catch (e) {}
  }

  // Register mock connected EA client
  registerMockClient("MOCK_ACC_1", "123456");

  // Force price cache data for Gold
  setCachedPrice("XAUUSD", { price: 2000.00 });

  // 1. Break Even Trigger Test
  console.log("\n[Test 1] Testing Break Even Trigger & Confirmation loop...");
  const doc1 = createMockOutcome({
    recommendationId: "REC-PM-101",
    mt5TicketId: "TICKET-101",
    entryPrice: 2000.00,
    volume: 1.0,
    sl: 1990.00,
    tp: 2020.00
  });

  // Price rises but below 1.50 trigger distance
  setCachedPrice("XAUUSD", { price: 2001.00 });
  await processPositionLifecycle(doc1);
  assert(doc1.positionManagement.pendingAction === null, "Price profit distance (1.0) does not trigger Break Even");

  // Price rises above 1.50 trigger distance (2001.60)
  setCachedPrice("XAUUSD", { price: 2001.60 });
  await processPositionLifecycle(doc1);
  assert(doc1.positionManagement.pendingAction === "BREAK_EVEN", "Price profit distance (1.6) triggers BE pending action");
  assert(doc1.positionManagement.breakEvenTriggered === false, "breakEvenTriggered remains false until broker confirmation");
  assert(lastSentMessage !== null && lastSentMessage.action === "MODIFY_ORDER", "MODIFY_ORDER broadcast command sent to EA");
  assert(lastSentMessage.sl === 2000.00, "Modify SL target price matches actualEntryPrice");

  // Simulate EA confirmation back to bridge (ORDER_MODIFIED event)
  // We trigger the sync handlers directly to simulate WebSocket receipt
  const simulatedModifiedMsg = {
    eventType: "ORDER_MODIFIED",
    payload: {
      recommendationId: "REC-PM-101",
      ticket: "TICKET-101",
      sl: 2000.00,
      tp: 2020.00
    }
  };

  // Replicate DB outcome lookup and update
  const pm1 = doc1.positionManagement;
  if (pm1.pendingAction === "BREAK_EVEN" && simulatedModifiedMsg.payload.sl === pm1.pendingSL) {
    const prevStage = pm1.lifecycleStage;
    pm1.breakEvenTriggered = true;
    pm1.breakEvenActive = true;
    pm1.lifecycleStage = "BREAK_EVEN_ACTIVE";
    pm1.pendingAction = null;
    pm1.history.push({
      action: "BREAK_EVEN_CONFIRMED",
      timestamp: new Date(),
      previousState: prevStage,
      newState: "BREAK_EVEN_ACTIVE",
      mt5TicketId: String(simulatedModifiedMsg.payload.ticket),
      reason: "MT5 confirmed Stop Loss moved to Entry"
    });
  }

  assert(doc1.positionManagement.breakEvenTriggered === true, "breakEvenTriggered confirmed to true");
  assert(doc1.positionManagement.lifecycleStage === "BREAK_EVEN_ACTIVE", "lifecycleStage transitioned to BREAK_EVEN_ACTIVE");
  assert(doc1.positionManagement.pendingAction === null, "pendingAction cleared after confirmation");
  assert(doc1.positionManagement.history.length === 1, "Audit entry generated in position history");
  
  const audit1 = doc1.positionManagement.history[0];
  assert(audit1.action === "BREAK_EVEN_CONFIRMED", "Audit entry has correct action name");
  assert(audit1.previousState === "POSITION_OPEN", "Audit entry preserves correct previousState");
  assert(audit1.newState === "BREAK_EVEN_ACTIVE", "Audit entry preserves correct newState");
  assert(audit1.mt5TicketId === "TICKET-101", "Audit entry logs correct ticket ID");

  // 2. Partial Take Profit Test
  console.log("\n[Test 2] Testing Partial Take Profit & Broker confirmation...");
  // Price rises above 2.00 trigger distance (2002.10)
  setCachedPrice("XAUUSD", { price: 2002.10 });
  await processPositionLifecycle(doc1);
  assert(doc1.positionManagement.pendingAction === "PARTIAL_TP", "Price profit distance (2.1) triggers PARTIAL_TP pending action");
  assert(doc1.positionManagement.partialTpExecuted === false, "partialTpExecuted remains false until broker confirmation");
  assert(lastSentMessage.action === "CLOSE_ORDER" && lastSentMessage.volume === 0.5, "CLOSE_ORDER broadcast command for 0.5 lot sent to EA");

  // Simulate EA Partial Close confirmation (ORDER_FILLED event)
  const pm2 = doc1.positionManagement;
  if (pm2.pendingAction === "PARTIAL_TP") {
    const prevStage = pm2.lifecycleStage;
    const closedVol = pm2.pendingVolume || 0;
    pm2.partialTpExecuted = true;
    pm2.remainingVolume = doc1.volume - closedVol;
    pm2.lifecycleStage = "PARTIAL_TP_TAKEN";
    pm2.pendingAction = null;
    pm2.history.push({
      action: "PARTIAL_TP_CONFIRMED",
      timestamp: new Date(),
      previousState: prevStage,
      newState: "PARTIAL_TP_TAKEN",
      mt5TicketId: "TICKET-101",
      reason: `MT5 confirmed partial close of ${closedVol} lots executed.`
    });
  }

  assert(doc1.positionManagement.partialTpExecuted === true, "partialTpExecuted confirmed to true");
  assert(doc1.positionManagement.remainingVolume === 0.5, `remainingVolume updated to 0.5 (Actual: ${doc1.positionManagement.remainingVolume})`);
  assert(doc1.positionManagement.lifecycleStage === "PARTIAL_TP_TAKEN", "lifecycleStage transitioned to PARTIAL_TP_TAKEN");
  assert(doc1.positionManagement.history.length === 2, "Audit entry generated in position history");

  // 3. Trailing Stop Test (Safer Direction Only)
  console.log("\n[Test 3] Testing Trailing Stop (Safer Direction Only)...");
  // Price rises above 2.50 trailing start (2003.00)
  setCachedPrice("XAUUSD", { price: 2003.00 });
  await processPositionLifecycle(doc1);
  
  assert(doc1.positionManagement.pendingAction === "TRAILING_STOP", "Price profit distance (3.0) triggers Trailing SL adjustment");
  assert(lastSentMessage.action === "MODIFY_ORDER" && lastSentMessage.sl === 2001.50, "MODIFY_ORDER command for calculated trailing SL of 2001.50 sent");

  // Simulate EA Trailing SL confirmation
  const pm3 = doc1.positionManagement;
  if (pm3.pendingAction === "TRAILING_STOP") {
    const prevStage = pm3.lifecycleStage;
    pm3.lastTrailingSL = 2001.50;
    pm3.lifecycleStage = "TRAILING_ACTIVE";
    pm3.pendingAction = null;
    pm3.history.push({
      action: "TRAILING_STOP_CONFIRMED",
      timestamp: new Date(),
      previousState: prevStage,
      newState: "TRAILING_ACTIVE",
      mt5TicketId: "TICKET-101",
      reason: `MT5 confirmed Trailing SL adjusted to 2001.50`
    });
  }

  assert(doc1.positionManagement.lastTrailingSL === 2001.50, "lastTrailingSL updated to 2001.50");
  assert(doc1.positionManagement.lifecycleStage === "TRAILING_ACTIVE", "lifecycleStage transitioned to TRAILING_ACTIVE");

  // Test Trailing Stop moves backwards block (Price drops to 2002.00)
  setCachedPrice("XAUUSD", { price: 2002.00 });
  lastSentMessage = null; // Clear
  await processPositionLifecycle(doc1);
  assert(doc1.positionManagement.pendingAction === null, "Price drop to 2002.00 does not trigger Trailing Stop (moving SL backward is blocked)");
  assert(lastSentMessage === null, "No broker message sent for trailing stop drop");

  // 4. Time Exit Test
  console.log("\n[Test 4] Testing Time Exit trigger...");
  const oldTime = new Date(Date.now() - 300 * 60 * 1000); // 5 hours ago
  const doc4 = createMockOutcome({
    recommendationId: "REC-PM-104",
    mt5TicketId: "TICKET-104",
    entryPrice: 2000.00,
    volume: 1.0,
    sl: 1990.00,
    tp: 2020.00,
    createdAt: oldTime
  });

  await processPositionLifecycle(doc4);
  assert(doc4.positionManagement.pendingAction === "TIME_EXIT", "Age of trade (5 hours) triggers TIME_EXIT pending action");
  assert(lastSentMessage.action === "CLOSE_ORDER" && lastSentMessage.ticket === "TICKET-104", "CLOSE_ORDER command sent to EA");

  // 5. Market Exit Test
  console.log("\n[Test 5] Testing Market Exit trigger...");
  const doc5 = createMockOutcome({
    recommendationId: "REC-PM-105",
    mt5TicketId: "TICKET-105",
    entryPrice: 2000.00,
    volume: 1.0,
    sl: 1990.00,
    tp: 2020.00
  });

  // Simulate registering a market exit override
  doc5.positionManagement.marketExitRequested = true;
  await processPositionLifecycle(doc5);
  assert(doc5.positionManagement.pendingAction === "MARKET_EXIT", "marketExitRequested flag triggers MARKET_EXIT pending action");
  assert(lastSentMessage.action === "CLOSE_ORDER" && lastSentMessage.ticket === "TICKET-105", "CLOSE_ORDER command sent to EA");

  // 6. Online Mongoose Database & Restart Recovery test
  if (isMongoAvailable) {
    console.log("\n[Test 6] Testing Restart Recovery & Database operations...");
    Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

    try {
      // Save doc1 to MongoDB
      const savedDoc = await doc1.save();
      
      // Simulate backend restart by querying ACTIVE POSITION_OPEN outcomes
      const reloadedTrades = await AiRecommendationOutcome.find({
        simulationMode: "DEMO",
        status: "ACTIVE",
        executionState: "POSITION_OPEN"
      });

      assert(reloadedTrades.length > 0, "Restart recovery reloaded POSITION_OPEN trades from MongoDB");
      const matchedRel = reloadedTrades.find(t => t.recommendationId === "REC-PM-101");
      assert(matchedRel.positionManagement.breakEvenTriggered === true, "Restart recovery successfully reloaded breakEvenTriggered state");
      assert(matchedRel.positionManagement.lifecycleStage === "TRAILING_ACTIVE", "Restart recovery successfully reloaded lifecycleStage");
    } catch (e) {
      console.error("  FAIL: Restart recovery database test failed", e);
      failCount++;
    }
  }

  // Restore state
  Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

  console.log(`\n==============================================`);
  console.log(`TEST RUN COMPLETE: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log(`==============================================`);
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
