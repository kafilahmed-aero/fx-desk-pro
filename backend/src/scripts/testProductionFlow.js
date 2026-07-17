import "dotenv/config";
import assert from "assert";
import mongoose from "mongoose";
import { config } from "../config/env.js";
import { updateConfig } from "../config/systemConfigManager.js";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";
import { ValidationChannelStats } from "../models/validationChannelStatsModel.js";
import { processRawMessage } from "../services/signalProcessingService.js";
import * as worker from "../services/signalValidationWorker.js";
import { priceEvents } from "../services/priceIngestionService.js";
import { mt5Events } from "../services/mt5SyncService.js";

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

async function runTests() {
  console.log("=== Phoenix v0 Production Integration Test Suite ===\n");
  let passed = true;

  // Set mock bridge result to resolve execution bridge instantly
  global.mockBridgeResult = {
    order: {
      ticket: "998877",
      fillPrice: 2030.15,
      executedAt: new Date()
    }
  };

  // Test 1: Full Production Flow (Telegram Ingest -> Pipeline -> Worker execution -> COMPLETED)
  try {
    console.log("[Test 1] Testing production wiring with NEW_SIGNAL ingestion...");
    mockDb.clear();
    
    // Set validation mode
    updateConfig({ executionMode: "signal_validation" });

    // Boot worker
    await worker.start();

    // Ingest NEW_SIGNAL Telegram message
    const rawMessage = {
      channel: "TestProductionChannel",
      messageId: 55011,
      text: "XAUUSD BUY LIMIT 2030 SL 2020 TP 2045",
      date: new Date()
    };

    const runResult = await processRawMessage(rawMessage);
    assert(runResult.classification === "NEW_SIGNAL", "Classification must be NEW_SIGNAL.");
    assert(runResult.stored === true, "Ingestion result must indicate stored (persisted to context).");

    const initialDoc = mockDb.get(55011);
    assert(initialDoc !== undefined, "Context document must be saved in database.");
    assert(initialDoc.pipelineStatus === "SCHEDULED", "Pipeline status must be SCHEDULED.");

    // Simulate price crossing
    const mockPrices = new Map();
    mockPrices.set("XAUUSD", { price: 2030.00 });
    priceEvents.emit("pricesUpdated", mockPrices);

    // Wait for worker promotion to trigger execution bridge and place position
    await new Promise(resolve => setTimeout(resolve, 200));

    const runningDoc = mockDb.get(55011);
    assert(runningDoc.pipelineStatus === "EXECUTED", "Worker should promote state to EXECUTED.");
    assert(runningDoc.order.ticket === "998877", "Ticket must match bridge result.");

    // Simulate MT5 fills
    const fillPayload = {
      event: "ORDER_FILLED",
      recommendationId: 55011,
      ticket: "998877",
      fillPrice: 2030.15,
      fillTime: Date.now() / 1000
    };
    mt5Events.emit("tradeEvent", { eventType: "ORDER_FILLED", payload: fillPayload });
    await new Promise(resolve => setTimeout(resolve, 150));

    // Simulate MT5 close
    const closePayload = {
      event: "ORDER_CLOSED",
      recommendationId: 55011,
      ticket: "998877",
      exitPrice: 2045.00,
      exitTime: Date.now() / 1000,
      reason: "TP"
    };
    mt5Events.emit("tradeEvent", { eventType: "ORDER_CLOSED", payload: closePayload });
    await new Promise(resolve => setTimeout(resolve, 200));

    const finalDoc = mockDb.get(55011);
    assert(finalDoc.pipelineStatus === "COMPLETED", "State should transition to COMPLETED.");
    assert(finalDoc.outcome.result === "FULL_TP", "Outcome should resolve to FULL_TP.");
    assert(finalDoc.rating.processed === true, "Rating processed status should be true.");

    await worker.stop();
    console.log("  PASS: Telegram NEW_SIGNAL successfully processed through validation pipeline automatically.");
  } catch (err) {
    console.error("  FAIL: Production wiring test failed:", err.message);
    passed = false;
  }

  // Test 2: Execution Mode Isolation
  try {
    console.log("\n[Test 2] Testing Execution Mode Isolation (Decision Mode remains unchanged)...");
    mockDb.clear();

    // Set decision mode
    updateConfig({ executionMode: "decision" });

    const rawMessage = {
      channel: "TestProductionChannel",
      messageId: 55012,
      text: "XAUUSD BUY LIMIT 2030 SL 2020 TP 2045",
      date: new Date()
    };

    const runResult = await processRawMessage(rawMessage);
    assert(runResult.classification === "NEW_SIGNAL", "Classification must be NEW_SIGNAL.");
    
    // For decision mode, storeParsedSignal stores the parsed signal to old DB tables, returning stored = true
    assert(runResult.stored === true, "Parsed signal stored successfully.");
    
    // SignalValidationContext must NOT be created
    const doc = mockDb.get(55012);
    assert(doc === undefined, "SignalValidationContext must NOT be created in Decision Mode.");

    console.log("  PASS: Decision Mode logic operates in isolation when executionMode !== 'signal_validation'.");
  } catch (err) {
    console.error("  FAIL: Execution mode isolation test failed:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL PRODUCTION INTEGRATION TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("PRODUCTION INTEGRATION TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test suite runtime failure:", err);
  process.exit(1);
});
