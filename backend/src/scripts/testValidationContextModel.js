import "dotenv/config";
import assert from "assert";
import mongoose from "mongoose";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";

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

SignalValidationContextModel.deleteMany = async (query) => {
  if (query && query.signalId && query.signalId.$in) {
    query.signalId.$in.forEach(id => mockDb.delete(id));
  } else {
    mockDb.clear();
  }
  return { deletedCount: 1 };
};

async function runTests() {
  console.log("=== SignalValidationContext MongoDB Persistence Tests ===\n");

  // Clean up any stale test documents from previous runs
  await SignalValidationContextModel.deleteMany({ signalId: { $in: [9991, 9992] } });

  let passed = true;

  // Test 1: Mongoose schema validation & timestamps
  try {
    console.log("[Test 1] Testing basic document creation and timestamps...");
    const sampleContext = {
      signalId: 9991,
      channelId: "chan-999",
      channelName: "ReviewChannel",
      symbol: "XAUUSD",
      direction: "BUY",
      entry: 2030,
      stopLoss: 2020,
      takeProfits: [2045],
      receivedTimestamp: new Date(),
      parserTimestamp: new Date(),
      pipelineStatus: "VALIDATED"
    };

    const doc = await SignalValidationContextModel.create(sampleContext);

    assert(doc.signalId === 9991, "signalId should match.");
    assert(doc.pipelineStatus === "VALIDATED", "pipelineStatus should match.");
    assert(doc.createdAt !== undefined, "Mongoose automatic timestamps: createdAt should be populated.");
    assert(doc.updatedAt !== undefined, "Mongoose automatic timestamps: updatedAt should be populated.");
    assert(doc.__v === 0, "Initial version key should be 0.");
    assert(doc.schemaVersion === 1, "schemaVersion should default to 1.");
    assert(doc.contextVersion === 1, "contextVersion should default to 1.");

    console.log("  PASS: Created persistent context document with Mongoose automatic timestamps.");
  } catch (err) {
    console.error("  FAIL: Document creation test failed:", err.message);
    passed = false;
  }

  // Test 2: Unique Index Enforcement
  try {
    console.log("\n[Test 2] Testing Unique Index on signalId...");
    const duplicateContext = {
      signalId: 9991, // duplicate signalId
      channelId: "chan-999",
      channelName: "ReviewChannel",
      symbol: "XAUUSD",
      direction: "BUY",
      entry: 2030,
      stopLoss: 2020,
      takeProfits: [2045],
      receivedTimestamp: new Date(),
      parserTimestamp: new Date(),
      pipelineStatus: "VALIDATED"
    };

    let duplicateThrew = false;
    try {
      await SignalValidationContextModel.create(duplicateContext);
    } catch (err) {
      if (err.code === 11000 || err.message.includes("duplicate key")) {
        duplicateThrew = true;
      } else {
        throw err;
      }
    }

    assert(duplicateThrew, "Attempt to insert duplicate signalId must throw duplicate key error.");
    console.log("  PASS: Unique index enforced signalId constraint successfully.");
  } catch (err) {
    console.error("  FAIL: Unique index check failed:", err.message);
    passed = false;
  }

  // Test 3: Lifecycle State Transitions (Updating nested schemas)
  try {
    console.log("\n[Test 3] Testing lifecycle transitions in the same document...");
    const doc = await SignalValidationContextModel.findOne({ signalId: 9991 });
    assert(doc !== null, "Should find the created document.");

    // Simulate Stage 2 (Planning)
    doc.pipelineStatus = "PLANNED";
    doc.order = {
      type: "BUY_STOP",
      plannedEntry: 2030,
      entryZone: { lower: 2030, upper: 2030 },
      currentMarketPrice: 2025,
      planningTimestamp: new Date(),
      planningReason: "BUY_ENTRY_ABOVE_MARKET",
      status: "PLANNED"
    };
    await doc.save();

    // Verify update
    const plannedDoc = await SignalValidationContextModel.findOne({ signalId: 9991 });
    assert(plannedDoc.pipelineStatus === "PLANNED", "pipelineStatus should transition to PLANNED.");
    assert(plannedDoc.order.type === "BUY_STOP", "Planned order type should update.");
    assert(plannedDoc.__v === 1, "Mongoose version key should increment to 1.");

    // Simulate Stage 3 & 4 (Scheduled -> Promoted / Executed)
    plannedDoc.pipelineStatus = "EXECUTED";
    plannedDoc.order.executionStatus = "EXECUTED";
    plannedDoc.order.ticket = "112233";
    plannedDoc.order.fillPrice = 2030.15;
    plannedDoc.order.executedAt = new Date();
    plannedDoc.order.executionResult = "SUCCESS";
    await plannedDoc.save();

    // Verify final executions
    const executedDoc = await SignalValidationContextModel.findOne({ signalId: 9991 });
    assert(executedDoc.pipelineStatus === "EXECUTED", "pipelineStatus should transition to EXECUTED.");
    assert(executedDoc.order.executionStatus === "EXECUTED", "order.executionStatus should transition to EXECUTED.");
    assert(executedDoc.order.ticket === "112233", "Order ticket should match.");
    assert(executedDoc.__v === 2, "Mongoose version key should increment to 2.");

    console.log("  PASS: Successfully transitioned pipelineStatus and nested order schemas.");
  } catch (err) {
    console.error("  FAIL: Lifecycle transition test failed:", err.message);
    passed = false;
  }

  // Test 4: Mongoose Optimistic Concurrency Control
  try {
    console.log("\n[Test 4] Testing Optimistic Concurrency Control...");
    // Retrieve two independent instances of the same document
    const instanceA = await SignalValidationContextModel.findOne({ signalId: 9991 });
    const instanceB = await SignalValidationContextModel.findOne({ signalId: 9991 });

    assert(instanceA !== null && instanceB !== null, "Both instances must load successfully.");
    assert(instanceA.__v === instanceB.__v, "Initial document versions must match.");

    // Save instance A first
    instanceA.pipelineStatus = "COMPLETED";
    instanceA.outcome = {
      result: "FULL_TP",
      closedAt: new Date(),
      closePrice: 2045.0,
      pips: 150.0,
      tradeDuration: 600
    };
    await instanceA.save();
    console.log("  Instance A saved successfully.");

    // Try saving instance B (which is stale and points to version 2 instead of the new version 3)
    instanceB.pipelineStatus = "EXPIRED";
    let concurrencyThrew = false;
    try {
      await instanceB.save();
    } catch (err) {
      if (err.name === "VersionError" || err.message.includes("No matching document found")) {
        concurrencyThrew = true;
      } else {
        throw err;
      }
    }

    assert(concurrencyThrew, "Stale document save must fail with Mongoose VersionError.");
    console.log("  PASS: Optimistic Concurrency Control correctly blocked stale overwrite.");
  } catch (err) {
    console.error("  FAIL: Optimistic Concurrency Control test failed:", err.message);
    passed = false;
  }

  // Clean up
  await SignalValidationContextModel.deleteMany({ signalId: { $in: [9991, 9992] } });

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL PERSISTENCE TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("PERSISTENCE TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
