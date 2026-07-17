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
  const validationError = doc.validateSync();
  if (validationError) {
    throw validationError;
  }
  if (mockDb.has(doc.signalId)) {
    const err = new Error("E11000 duplicate key error collection");
    err.code = 11000;
    throw err;
  }
  doc.__v = 0;
  doc.createdAt = new Date();
  doc.updatedAt = new Date();
  mockDb.set(doc.signalId, JSON.parse(JSON.stringify(doc.toObject())));

  // Bind mock save logic
  doc.save = async function() {
    const valErr = this.validateSync();
    if (valErr) throw valErr;

    const dbRecord = mockDb.get(this.signalId);
    if (!dbRecord) {
      throw new Error("No matching document found");
    }
    // Optimistic Concurrency Control Version Checking
    if (dbRecord.__v !== this.__v) {
      const verErr = new Error(`VersionError: No matching document found for id "${this._id}" and version ${this.__v}`);
      verErr.name = "VersionError";
      throw verErr;
    }
    this.__v += 1;
    this.updatedAt = new Date();
    mockDb.set(this.signalId, JSON.parse(JSON.stringify(this.toObject())));
    return this;
  };

  return doc;
};

SignalValidationContextModel.findOne = async (query) => {
  const signalId = query.signalId;
  const dbRecord = mockDb.get(signalId);
  if (!dbRecord) return null;

  const doc = new SignalValidationContextModel(dbRecord);
  doc.save = async function() {
    const valErr = this.validateSync();
    if (valErr) throw valErr;

    const dbRecordInner = mockDb.get(this.signalId);
    if (!dbRecordInner) {
      throw new Error("No matching document found");
    }
    if (dbRecordInner.__v !== this.__v) {
      const verErr = new Error(`VersionError: No matching document found for id "${this._id}" and version ${this.__v}`);
      verErr.name = "VersionError";
      throw verErr;
    }
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

  // Simulate Mongoose findOneAndUpdate with lock validations
  if (query.$or) {
    let match = false;
    const workerId = update.$set["processing.lockedBy"];
    const staleTime = new Date(Date.now() - 300000);

    if (dbRecord.processing.lockedBy === null || 
        dbRecord.processing.lockedBy === workerId || 
        new Date(dbRecord.processing.heartbeat) < staleTime) {
      match = true;
    }
    if (!match) return null;
  }

  // Apply updates
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
    let match = true;
    if (query.pipelineStatus === "SCHEDULED" && query["order.executionStatus"] === "WAITING_FOR_PRICE") {
      if (val.pipelineStatus !== "SCHEDULED" || val.order?.executionStatus !== "WAITING_FOR_PRICE") {
        match = false;
      }
    }
    if (query["processing.lockedBy"] === "worker-test") {
      if (val.processing?.lockedBy !== "worker-test") match = false;
    }
    if (match) {
      list.push(new SignalValidationContextModel(val));
    }
  });

  // Assign save handlers
  list.forEach(doc => {
    doc.save = async function() {
      const current = mockDb.get(this.signalId);
      if (current && current.__v !== this.__v) {
        const verErr = new Error("VersionError");
        verErr.name = "VersionError";
        throw verErr;
      }
      this.__v += 1;
      this.updatedAt = new Date();
      mockDb.set(this.signalId, JSON.parse(JSON.stringify(this.toObject())));
      return this;
    };
  });
  return list;
};

SignalValidationContextModel.deleteMany = async (query) => {
  if (query && query.signalId && query.signalId.$in) {
    query.signalId.$in.forEach(id => mockDb.delete(id));
  } else {
    mockDb.clear();
  }
  return { deletedCount: 1 };
};

// Mock Validation Stats Schema finds
ValidationChannelStats.findOne = async () => {
  return {
    save: async () => {}
  };
};

function buildMockContext(overrides = {}) {
  return {
    signalId: 9100,
    channelId: "chan-1",
    channelName: "TestWorkerChannel",
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
  console.log("=== Live Validation Worker Scenario Test Suite ===\n");
  let passed = true;

  // Test 1: Worker Startup Recovery and price-based updates
  try {
    console.log("[Test 1] Testing Worker startup and price-triggered promotions...");
    mockDb.clear();

    const pendingSignal = buildMockContext({ signalId: 9101 });
    await SignalValidationContextModel.create(pendingSignal);

    global.mockBridgeResult = {
      order: {
        ticket: "882200",
        fillPrice: 2030.15,
        executedAt: new Date()
      }
    };

    // Boot worker
    await worker.start();

    // Health checks
    const hlth = worker.health();
    assert(hlth.isRunning === true, "Worker should be running.");

    // Simulate price feed update: Price hits 2030 (XAUUSD entry trigger)
    const mockPrices = new Map();
    mockPrices.set("XAUUSD", { price: 2030.0 });

    priceEvents.emit("pricesUpdated", mockPrices);

    // Wait short delay for worker processing queue to empty
    await new Promise(resolve => setTimeout(resolve, 150));

    const updatedDoc = mockDb.get(9101);
    assert(updatedDoc.pipelineStatus === "EXECUTED", "Worker should advance context to EXECUTED upon trigger.");
    assert(updatedDoc.order.executionStatus === "EXECUTED", "order.executionStatus should transition to EXECUTED.");
    assert(updatedDoc.order.ticket !== null, "Execution Bridge should place trade ticket.");
    assert(updatedDoc.monitoring.status === "MONITORING", "monitoring.status should transition to MONITORING.");

    console.log("  PASS: Startup recovery and price promotions advanced pipeline correctly.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: Event Deduplication checking
  try {
    console.log("\n[Test 2] Testing MT5 Event Deduplication...");
    const stats = worker.status();
    const startDeduplications = stats.deduplicatedEventsCount;

    const payload = {
      event: "ORDER_FILLED",
      recommendationId: 9101,
      ticket: "112233",
      fillPrice: 2030.15,
      fillTime: 17894000,
      eventId: "evt-dedup-1"
    };

    // Emit event twice
    mt5Events.emit("tradeEvent", { eventType: "ORDER_FILLED", payload });
    mt5Events.emit("tradeEvent", { eventType: "ORDER_FILLED", payload });

    await new Promise(resolve => setTimeout(resolve, 150));

    const finalStats = worker.status();
    assert(finalStats.deduplicatedEventsCount > startDeduplications, "Event should be registered in deduplication cache.");

    console.log("  PASS: Duplicate events successfully filtered.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: Close Position lifecycle routing (Outcome & Channel Rating Engines)
  try {
    console.log("\n[Test 3] Testing trade closed event advances to outcome and rating processing...");
    // Retrieve context to close
    const doc = mockDb.get(9101);
    assert(doc.pipelineStatus === "EXECUTED", "Context must be in EXECUTED state.");

    // Close position payload
    const closePayload = {
      event: "ORDER_CLOSED",
      recommendationId: 9101,
      ticket: "112233",
      exitPrice: 2045.00,
      exitTime: 17895000,
      reason: "TP"
    };

    mt5Events.emit("tradeEvent", { eventType: "ORDER_CLOSED", payload: closePayload });

    // Wait short delay for worker processing queue to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    const finalDoc = mockDb.get(9101);
    assert(finalDoc.pipelineStatus === "COMPLETED", "Status should transition to COMPLETED.");
    assert(finalDoc.monitoring.status === "POSITION_CLOSED", "Monitoring status should be POSITION_CLOSED.");
    assert(finalDoc.outcome.result === "FULL_TP", "Outcome result should be FULL_TP target.");
    assert(finalDoc.rating.processed === true, "Rating processed status should be true.");

    console.log("  PASS: Close trade events routed through trade monitor, outcome engine, and rating engine successfully.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Tear down worker
  await worker.stop();

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL validation WORKER TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("validation WORKER TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
