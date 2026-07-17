import mongoose from "mongoose";
import { config } from "../config/env.js";
import {
  executeRecoveryWorkflow,
  saveRecoveryAudit,
  getRecoveryAudits,
  localPhoenixRecoveryAudits,
  resetRecoveryAttempts
} from "../services/recoveryManagerService.js";
import { RECOVERY_MANAGER_POLICY } from "../config/recoveryManagerPolicy.js";
import { PhoenixRecoveryAudit } from "../models/phoenixRecoveryAuditModel.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
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

// Captured WS messages
let lastSentMessage = null;

function registerMockClient(accountId, accountNumber) {
  connectedClients.set(accountId, {
    ws: {
      readyState: 1,
      send: (data) => {
        lastSentMessage = JSON.parse(data);
      }
    },
    broker: "TEST_BROKER",
    server: "TEST_SERVER",
    accountNumber
  });
}

function createMockOutcome({ recommendationId, mt5TicketId, state, status, magicNumber }) {
  const doc = new AiRecommendationOutcome({
    recommendationId,
    pair: "XAUUSD",
    direction: "BUY",
    volume: 0.1,
    sl: 1990.00,
    tp: 2020.00,
    lowRiskTp: 2020.00,
    status: status || "ACTIVE",
    executionState: state || "POSITION_OPEN",
    mt5TicketId,
    magicNumber: magicNumber || 12345,
    mt5AccountId: "MOCK_ACC_1",
    actualEntryPrice: 2000.00,
    entryMin: 1995.0,
    entryMax: 2005.0,
    expiresAt: new Date(Date.now() + 3600 * 1000 * 24),
    simulationMode: "DEMO",
    createdAt: new Date()
  });

  doc.save = async function() {
    return this;
  };

  return doc;
}

async function runTests() {
  console.log("=== RUNNING PHOENIX RECOVERY MANAGER TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Reset states
  localPhoenixRecoveryAudits.clear();
  connectedClients.clear();
  resetRecoveryAttempts();

  if (isMongoAvailable) {
    try {
      await mongoose.connection.db.collection("phoenixRecoveryAudit").deleteMany({});
    } catch (e) {}
  }

  // Force offline state for local cache checks
  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  // 1. Connection unavailable checks & retries
  console.log("\n[Test 1] Testing Connection Unavailable & Retries...");
  const res1 = await executeRecoveryWorkflow(null, { forceConnected: false });
  assert(res1.status === "RETRYING", "Workflow status is RETRYING when MT5 is disconnected");

  // Force trigger retries until threshold limit reached
  await executeRecoveryWorkflow(null, { forceConnected: false });
  await executeRecoveryWorkflow(null, { forceConnected: false });
  await executeRecoveryWorkflow(null, { forceConnected: false });
  const res1Limit = await executeRecoveryWorkflow(null, { forceConnected: false });
  assert(res1Limit.status === "FAILED", "Workflow FAILED after maximum attempts reached");

  // 2. Open Position Parameter Synchronization check
  console.log("\n[Test 2] Testing Open Position Parameter Sync...");
  registerMockClient("MOCK_ACC_1", "123456");
  resetRecoveryAttempts();

  const doc1 = createMockOutcome({
    recommendationId: "REC-REC-001",
    mt5TicketId: null, // missing ticket initially
    state: "ORDER_SENT",
    magicNumber: 12345
  });

  const mockPositions = [
    { ticket: "999888", magic: 12345, volume: 0.1, sl: 2000.50 }
  ];

  const res2 = await executeRecoveryWorkflow(mockPositions, {
    forceConnected: true,
    mockActiveTrades: [doc1]
  });

  assert(res2.status === "COMPLETED", "Workflow COMPLETED successfully with open client connection");
  assert(doc1.executionState === "POSITION_OPEN", "executionState updated to POSITION_OPEN");
  assert(doc1.mt5TicketId === "999888", "mt5TicketId resolved from broker position list");
  assert(doc1.simulatedSL === 2000.50, "Stop Loss synchronized from live MT5 position parameter");

  // 3. Closed Position Offline Synchronization check
  console.log("\n[Test 3] Testing Position Closed Offline Reconciliation...");
  const doc3 = createMockOutcome({
    recommendationId: "REC-REC-003",
    mt5TicketId: "777666",
    state: "POSITION_OPEN",
    status: "ACTIVE",
    magicNumber: 54321
  });

  const res3 = await executeRecoveryWorkflow([], { // empty live list -> doc3 was closed offline
    forceConnected: true,
    mockActiveTrades: [doc3]
  });

  assert(doc3.status === "CANCELLED", "Trade status closed and marked CANCELLED locally");
  assert(doc3.executionState === "SYNC_COMPLETE", "executionState synced to SYNC_COMPLETE");
  assert(doc3.simulationNotes.some(n => n.includes("not found on MT5")), "Reconciliation notes added to outcome logs");

  // 4. Missing Record/Zombie Position Exit check
  console.log("\n[Test 4] Testing Zombie Positions Cleanup...");
  lastSentMessage = null;
  const mockZombiePositions = [
    { ticket: "555444", magic: 99999 } // no matching DB trade
  ];

  await executeRecoveryWorkflow(mockZombiePositions, {
    forceConnected: true,
    mockActiveTrades: [],
    forceAccountId: "MOCK_ACC_1"
  });

  assert(lastSentMessage !== null && lastSentMessage.action === "CLOSE_ORDER", "CLOSE_ORDER sent to EA to clean up zombie position");
  assert(lastSentMessage.ticket === "555444", "Close ticket target is correct");

  // 5. Recovery Audit Logging check
  console.log("\n[Test 5] Testing Recovery Audit Logging...");
  const audits = Array.from(localPhoenixRecoveryAudits.values());
  assert(audits.some(a => a.event === "RECOVERY_STARTED"), "Logged RECOVERY_STARTED event");
  assert(audits.some(a => a.event === "RECOVERED_POSITION"), "Logged RECOVERED_POSITION event");
  assert(audits.some(a => a.event === "RECOVERED_CLOSED_TRADE"), "Logged RECOVERED_CLOSED_TRADE event");
  assert(audits.some(a => a.event === "INCONSISTENCY_DETECTED"), "Logged INCONSISTENCY_DETECTED event");
  assert(audits.some(a => a.event === "RECOVERY_COMPLETED"), "Logged RECOVERY_COMPLETED event");

  const completedAudit = audits.find(a => a.event === "RECOVERY_COMPLETED");
  assert(completedAudit.details.recoveredCount !== undefined, "Audit records recovery details meta fields");

  // 6. Online Database audits & immutability test
  if (isMongoAvailable) {
    console.log("\n[Test 6] Testing Online Mongoose Database integration...");
    Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

    try {
      const mockAudit = {
        recoveryId: "REC-AUDIT-DB-TEST",
        event: "RECOVERY_COMPLETED",
        details: { recoveredCount: 1, closedCount: 0, discrepanciesCount: 0 },
        policyVersion: "1.0"
      };

      await saveRecoveryAudit(mockAudit);
      const queried = await getRecoveryAudits({ event: "RECOVERY_COMPLETED" });
      assert(queried.length > 0, "Query recovery audits retrieves logs from MongoDB");

      // Test immutability
      try {
        await PhoenixRecoveryAudit.updateOne({ recoveryId: "REC-AUDIT-DB-TEST" }, { $set: { event: "RECOVERY_FAILED" } });
        assert(false, "Mongoose allowed updating append-only recovery audits");
      } catch (e) {
        assert(e.message.includes("prohibited"), `updateOne blocked modifications (Message: ${e.message})`);
      }

      try {
        await PhoenixRecoveryAudit.deleteOne({ recoveryId: "REC-AUDIT-DB-TEST" });
        assert(false, "Mongoose allowed deleting append-only recovery record");
      } catch (e) {
        assert(e.message.includes("prohibited"), `deleteOne blocked deletions (Message: ${e.message})`);
      }
    } catch (e) {
      console.error("  FAIL: Database test failed", e);
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
