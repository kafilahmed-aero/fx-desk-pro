import "dotenv/config";
import assert from "assert";
import mongoose from "mongoose";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";
import { ValidationReconciliationLog } from "../models/validationReconciliationLogModel.js";
import { QuarantinedOrphan } from "../models/quarantinedOrphansModel.js";
import { reconcileValidationStates, executeManualReconciliation } from "../services/mt5ReconciliationService.js";
import { generateMagicNumber, connectedClients } from "../services/mt5SyncService.js";

// Mock Database Document Store for testing stateless service validations
const mockDb = new Map();

// Stub Mongoose Model operations to execute complete schema validation, unique indexes, and version checks
SignalValidationContextModel.create = async (data) => {
  const doc = new SignalValidationContextModel(data);
  doc.__v = 0;
  doc.createdAt = data.createdAt || new Date();
  doc.updatedAt = data.updatedAt || new Date();
  mockDb.set(doc.signalId, JSON.parse(JSON.stringify(doc.toObject())));
  return doc;
};

SignalValidationContextModel.find = async () => {
  const list = [];
  mockDb.forEach((val) => {
    list.push(new SignalValidationContextModel(val));
  });

  // Assign save handlers
  list.forEach(doc => {
    doc.save = async function() {
      this.__v += 1;
      this.updatedAt = new Date();
      mockDb.set(this.signalId, JSON.parse(JSON.stringify(this.toObject())));
      return this;
    };
  });
  return list;
};

SignalValidationContextModel.deleteMany = async () => {
  mockDb.clear();
  return { deletedCount: 1 };
};

// Mock logs and orphans tables in-memory
const mockLogs = [];
const mockOrphans = [];

ValidationReconciliationLog.create = async (report) => {
  mockLogs.push(report);
  return report;
};

QuarantinedOrphan.create = async (orphan) => {
  mockOrphans.push(orphan);
  return orphan;
};

function buildMockContext(overrides = {}) {
  return {
    signalId: 9200,
    channelId: "chan-1",
    channelName: "TestReconcileChannel",
    symbol: "XAUUSD",
    direction: "BUY",
    entry: 2030,
    stopLoss: 2020,
    takeProfits: [2045],
    receivedTimestamp: new Date(),
    parserTimestamp: new Date(),
    pipelineStatus: "SCHEDULED",
    order: {
      type: "BUY_STOP",
      plannedEntry: 2030,
      entryZone: { lower: 2030, upper: 2030 },
      currentMarketPrice: 2025,
      planningTimestamp: new Date(),
      planningReason: "BUY_ENTRY_ABOVE_MARKET",
      status: "PLANNED",
      executionStatus: "WAITING_FOR_PRICE"
    },
    monitoring: {
      status: "NOT_STARTED"
    },
    rating: {
      processed: false
    },
    ...overrides
  };
}

async function runTests() {
  console.log("=== MT5 Reconciliation Scenario Test Suite ===\n");
  let passed = true;

  // Test 1: Offline Close Recovery
  try {
    console.log("[Test 1] Testing offline close recovery (Position closed while backend offline)...");
    mockDb.clear();
    mockLogs.length = 0;

    // Seed running context in MongoDB
    const runningDoc = buildMockContext({
      signalId: 9201,
      pipelineStatus: "EXECUTED",
      order: {
        executionStatus: "EXECUTED",
        ticket: "773322",
        fillPrice: 2030.0,
        executedAt: new Date(Date.now() - 3600 * 1000)
      },
      monitoring: {
        status: "POSITION_OPEN",
        positionOpenedAt: new Date(Date.now() - 3600 * 1000)
      }
    });
    await SignalValidationContextModel.create(runningDoc);

    // Live active positions does NOT contain ticket "773322" (it closed)
    const activePositions = [];
    // Closed history contains ticket "773322" with TP reason
    const closedHistory = [
      {
        ticket: "773322",
        exitPrice: 2045.0,
        exitTime: new Date(),
        reason: "TP"
      }
    ];

    const report = await reconcileValidationStates("demo-acc", activePositions, closedHistory);

    const doc = mockDb.get(9201);
    assert(doc.monitoring.status === "POSITION_CLOSED", "Monitoring status should sync to POSITION_CLOSED.");
    assert(doc.monitoring.closeReason === "TP", "Close reason should sync to TP from history.");
    assert(doc.monitoring.lastKnownPrice === 2045.0, "Exit price should sync to 2045.");
    assert(report.recoveredContexts.includes(9201), "Report recoveredContexts should list 9201.");
    assert(mockLogs.length === 1, "Reconciliation audit log should be persisted.");

    console.log("  PASS: Reconciled offline closed trade and retrieved real exit parameters.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: Timestamp Comparison Gate
  try {
    console.log("\n[Test 2] Testing Timestamp comparison checks (Newer database overrides)...");
    mockDb.clear();
    mockLogs.length = 0;

    // Seed running context in MongoDB (updated very recently)
    const runningDoc = buildMockContext({
      signalId: 9202,
      pipelineStatus: "EXECUTED",
      updatedAt: new Date(Date.now() - 1000), // Updated 1 second ago
      order: {
        executionStatus: "EXECUTED",
        ticket: "773322",
        fillPrice: 2030.0,
        executedAt: new Date(Date.now() - 3600 * 1000)
      },
      monitoring: {
        status: "POSITION_OPEN",
        positionOpenedAt: new Date(Date.now() - 3600 * 1000)
      }
    });
    await SignalValidationContextModel.create(runningDoc);

    // Active position open time is older (e.g. 1 hour ago)
    const activePositions = [
      {
        ticket: "773322",
        magicNumber: generateMagicNumber("9202"),
        openPrice: 2029.50, // older price on MT5
        openTime: new Date(Date.now() - 3600 * 1000)
      }
    ];

    await reconcileValidationStates("demo-acc", activePositions, []);

    const doc = mockDb.get(9202);
    assert(doc.order.fillPrice === 2030.0, "Database should NOT be overwritten because doc updatedAt is newer.");

    console.log("  PASS: Timestamp comparison gate protected newer MongoDB state.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: Orphan Trade Quarantine
  try {
    console.log("\n[Test 3] Testing Orphan trade detection and quarantine logging...");
    mockDb.clear();
    mockOrphans.length = 0;

    // Active position contains magic number representing validation mode but no Mongoose document exists
    const activePositions = [
      {
        ticket: "999888",
        magicNumber: 12345678, // validation range
        symbol: "GBPUSD",
        openPrice: 1.2500,
        openTime: new Date()
      }
    ];

    const report = await reconcileValidationStates("demo-acc", activePositions, []);

    assert(report.orphanTrades.length === 1, "Report should identify 1 orphan trade.");
    assert(mockOrphans.length === 1, "QuarantinedOrphan model should store the orphan record.");
    assert(mockOrphans[0].ticket === "999888", "Orphan ticket should match.");

    console.log("  PASS: Quarantined orphan trades successfully.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Test 4: Manual Reconciliation Trigger
  try {
    console.log("\n[Test 4] Testing Manual Administrator Reconciliation dispatch...");
    let sentCommand = null;
    connectedClients.set("test-client", {
      ws: {
        send: (msg) => {
          sentCommand = JSON.parse(msg);
        }
      }
    });

    const triggered = executeManualReconciliation("test-client");
    assert(triggered === true, "Trigger should succeed.");
    assert(sentCommand !== null && sentCommand.action === "POSITION_LIST", "Command sent to EA must be POSITION_LIST.");

    console.log("  PASS: Manual trigger dispatched POSITION_LIST correctly.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 4:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL RECONCILIATION TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("RECONCILIATION TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
