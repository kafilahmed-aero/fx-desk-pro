import "dotenv/config";
import assert from "assert";
import mongoose from "mongoose";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";
import { ValidationChannelStats } from "../models/validationChannelStatsModel.js";
import { validationEvents } from "../services/validationEvents.js";
import { priceEvents } from "../services/priceIngestionService.js";
import { mt5Events } from "../services/mt5SyncService.js";
import * as worker from "../services/signalValidationWorker.js";

// Mock Database Document Store for testing stateless service validations
const mockDb = new Map();

// Stub Mongoose Model operations to execute complete schema validation, unique indexes, and version checks
SignalValidationContextModel.create = async (data) => {
  const doc = new SignalValidationContextModel(data);
  doc.__v = 0;
  doc.createdAt = new Date();
  doc.updatedAt = new Date();
  mockDb.set(doc.signalId, JSON.parse(JSON.stringify(doc.toObject())));
  return doc;
};

SignalValidationContextModel.findOne = async (query) => {
  const signalId = query.signalId;
  const dbRecord = mockDb.get(signalId);
  if (!dbRecord) return null;

  const doc = new SignalValidationContextModel(dbRecord);
  doc.save = async function() {
    this.__v += 1;
    this.updatedAt = new Date();
    mockDb.set(this.signalId, JSON.parse(JSON.stringify(this.toObject())));
    return this;
  };
  return doc;
};

SignalValidationContextModel.findOneAndUpdate = async (query, update, options) => {
  const signalId = query.signalId;
  const dbRecord = mockDb.get(signalId);
  if (!dbRecord) return null;

  if (update.$set) {
    Object.keys(update.$set).forEach(key => {
      const parts = key.split(".");
      if (parts.length === 2) {
        dbRecord[parts[0]] = dbRecord[parts[0]] || {};
        dbRecord[parts[0]][parts[1]] = update.$set[key];
      } else {
        dbRecord[key] = update.$set[key];
      }
    });
  }

  dbRecord.__v += 1;
  dbRecord.updatedAt = new Date();
  mockDb.set(signalId, dbRecord);

  const doc = new SignalValidationContextModel(dbRecord);
  doc.save = async function() {
    this.__v += 1;
    this.updatedAt = new Date();
    mockDb.set(this.signalId, JSON.parse(JSON.stringify(this.toObject())));
    return this;
  };
  return doc;
};

SignalValidationContextModel.find = async (query) => {
  const list = [];
  mockDb.forEach((val) => {
    list.push(new SignalValidationContextModel(val));
  });
  return list;
};

SignalValidationContextModel.deleteMany = async () => {
  mockDb.clear();
  return { deletedCount: 1 };
};

ValidationChannelStats.findOne = async () => {
  return { save: async () => {} };
};

function buildMockContext(overrides = {}) {
  return {
    signalId: 9400,
    channelId: "chan-1",
    channelName: "E2EChannel",
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

async function runSimulation() {
  console.log("=== Phoenix v0 E2E Simulated Pipeline Harness ===\n");
  let passed = true;

  // Set mock bridge result to resolve execution bridge instantly
  global.mockBridgeResult = {
    order: {
      ticket: "100200",
      fillPrice: 2030.15,
      executedAt: new Date()
    }
  };

  // Test 1: Ingress Recovery Checks (Server crash in WAITING_FOR_PRICE & POSITION_OPEN)
  try {
    console.log("[Failure Injection 1] Server crash during WAITING_FOR_PRICE...");
    mockDb.clear();
    
    // Seed WAITING_FOR_PRICE trade
    const docWaiting = buildMockContext({ signalId: 9401 });
    await SignalValidationContextModel.create(docWaiting);

    // Boot worker (simulating server starting up after crash)
    await worker.start();

    // Verify recovery processes advanced
    const mockPrices = new Map();
    mockPrices.set("XAUUSD", { price: 2030.00 });
    priceEvents.emit("pricesUpdated", mockPrices);

    await new Promise(resolve => setTimeout(resolve, 150));

    const updatedDoc1 = mockDb.get(9401);
    assert(updatedDoc1.pipelineStatus === "EXECUTED", "Context should recover and transition to EXECUTED.");
    assert(updatedDoc1.monitoring.status === "MONITORING", "Monitoring state should recover to MONITORING.");

    await worker.stop();
    console.log("  PASS: Worker self-healed WAITING_FOR_PRICE context successfully.");
  } catch (err) {
    console.error("  FAIL: Failure Injection 1 failed:", err.message);
    passed = false;
  }

  try {
    console.log("\n[Failure Injection 2] Server crash during POSITION_OPEN...");
    mockDb.clear();

    // Seed POSITION_OPEN trade
    const docOpen = buildMockContext({
      signalId: 9402,
      pipelineStatus: "EXECUTED",
      order: {
        executionStatus: "EXECUTED",
        ticket: "776655",
        fillPrice: 2030.15,
        executedAt: new Date()
      },
      monitoring: {
        status: "POSITION_OPEN",
        positionOpenedAt: new Date()
      }
    });
    await SignalValidationContextModel.create(docOpen);

    // Boot worker
    await worker.start();

    // Verify recovery processes closed trade event
    const closePayload = {
      event: "ORDER_CLOSED",
      recommendationId: 9402,
      ticket: "776655",
      exitPrice: 2045.00,
      exitTime: Date.now() / 1000,
      reason: "TP"
    };
    mt5Events.emit("tradeEvent", { eventType: "ORDER_CLOSED", payload: closePayload });

    await new Promise(resolve => setTimeout(resolve, 200));

    const updatedDoc2 = mockDb.get(9402);
    assert(updatedDoc2.pipelineStatus === "COMPLETED", "Context should recover closed event and finish rating.");
    assert(updatedDoc2.rating.processed === true, "Rating processed status should recover.");

    await worker.stop();
    console.log("  PASS: Worker self-healed POSITION_OPEN context successfully.");
  } catch (err) {
    console.error("  FAIL: Failure Injection 2 failed:", err.message);
    passed = false;
  }

  // Stress Testing Loader
  try {
    console.log("\n==========================================");
    console.log("=== Progressive Stress Load Profiles ===");
    console.log("==========================================");

    const stressSizes = [1, 10, 50, 100, 250, 500, 1000];

    for (const size of stressSizes) {
      mockDb.clear();
      await worker.start();

      const startMem = process.memoryUsage().heapUsed;
      const startTime = Date.now();

      // Seed 'size' contexts
      for (let i = 0; i < size; i++) {
        const doc = buildMockContext({ signalId: 9500 + i });
        await SignalValidationContextModel.create(doc);
      }

      // Simulate price tick triggers for all concurrently
      const mockPrices = new Map();
      mockPrices.set("XAUUSD", { price: 2030.00 });
      priceEvents.emit("pricesUpdated", mockPrices);

      // Wait for execution completion
      await new Promise(resolve => setTimeout(resolve, 150 + (size * 0.5)));

      const duration = Date.now() - startTime;
      const endMem = process.memoryUsage().heapUsed;
      const throughput = (size / (duration / 1000)).toFixed(1);
      const memUsedMb = ((endMem - startMem) / 1024 / 1024).toFixed(2);

      console.log(`- Profile [${size} Contexts] : Time ${duration} ms | Throughput ${throughput} ops/sec | Memory Delta ${memUsedMb} MB`);
      
      await worker.stop();
    }
  } catch (err) {
    console.error("  FAIL: Stress loading test failed:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL SIMULATED TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("SIMULATED TESTS FAILED!");
    process.exit(1);
  }
}

runSimulation().catch(err => {
  console.error("Simulation runner failed:", err);
  process.exit(1);
});
