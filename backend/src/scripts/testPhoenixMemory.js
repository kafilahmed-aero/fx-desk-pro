import mongoose from "mongoose";
import { config } from "../config/env.js";
import { PhoenixTradeMemory } from "../models/phoenixTradeMemoryModel.js";
import {
  recordCompletedTrade,
  getTradeHistory,
  updateTradeMemory,
  deleteTradeMemory,
  localPhoenixTradeMemory
} from "../services/phoenixMemoryService.js";

function buildMockTradeSnapshot(tradeId) {
  return {
    tradeId,
    opportunityId: "OPP-12345",
    symbol: "XAUUSD",
    direction: "BUY",
    broker: "Test Broker Corp",
    accountType: "DEMO",
    accountNumber: "DEMO-998877",
    executionId: "EXEC-8899",

    signalInfo: {
      channels: ["VincentGold", "GoldVIP"],
      consensusPercentage: 85,
      agreeingChannels: 2,
      disagreeingChannels: 0,
      parsedSignal: { pair: "XAUUSD", action: "BUY" },
      originalSignal: "BUY GOLD AT 2000",
      confidence: 90
    },

    decisionEngine: {
      decision: "BUY",
      grade: "GRADE A",
      finalScore: 92,
      decisionBreakdown: { consensus: 35, marketIntelligence: 40 },
      reasons: ["Strong bullish bias", "Perfect London session liquidity sweep"],
      warnings: []
    },

    marketContext: {
      overallScore: 88,
      status: "HEALTHY",
      trend: { status: "STRONG_BULLISH" },
      structure: { status: "FAVORABLE" },
      volatility: { volatilityLevel: "Normal" },
      spread: { metrics: { currentSpread: 1.2 } }
    },

    smartEntry: {
      recommendedStrategy: "LIMIT",
      alternativeStrategy: "MARKET",
      entryQuality: "GRADE A",
      entryPrice: 1998.0,
      entryRR: 3.5
    },

    execution: {
      requestedEntry: 2000.0,
      actualFill: 1999.0,
      slippage: -1.0,
      spread: 1.5,
      lotSize: 0.1,
      stopLoss: 1985.0,
      takeProfit: 2045.0,
      orderType: "BUY LIMIT",
      executionLatencyMs: 150,
      brokerRetcode: "10009"
    },

    lifecycleTimeline: [
      { event: "Trade Opened", timestamp: new Date(Date.now() - 30 * 60000), metadata: { price: 1999.0 } },
      { event: "Break Even Activated", timestamp: new Date(Date.now() - 15 * 60000), metadata: { sl: 2000.0 } },
      { event: "Partial TP1", timestamp: new Date(Date.now() - 5 * 60000), metadata: { closePercent: 30 } }
    ],

    result: {
      outcome: "PARTIAL_TP",
      netProfit: 150.0,
      grossProfit: 210.0,
      grossLoss: 60.0,
      rMultiple: 1.5,
      rrAchieved: 1.5,
      drawdown: 5.0,
      mfe: 25.0,
      mae: 3.0,
      durationMs: 1800000,
      exitReason: "Hit partial TP1 target",
      closeTime: new Date()
    },

    featureVector: {
      consensusScore: 85,
      marketScore: 88,
      trendScore: 1, // Bullish
      structureScore: 1, // Favorable
      volatilityScore: 15,
      spreadScore: 1.2,
      decisionScore: 92,
      entryQualityScore: 3, // Grade A
      rrRatio: 3.5,
      sessionScore: 1 // London
    },

    environment: {
      session: "London",
      weekday: "Tuesday",
      timestamp: new Date(),
      marketOpen: true,
      newsStatus: "LOW_IMPACT",
      configSnapshot: { maxRiskPercent: 1.0 }
    }
  };
}

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

async function runTests() {
  console.log("=== RUNNING PHOENIX MEMORY ENGINE TESTS ===\n");

  let isMongoAvailable = false;
  try {
    console.log("Connecting to MongoDB:", config.mongoUri);
    // Timeout quickly so the unit test run does not hang
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  MongoDB is unavailable. Running in Mock/Offline Fallback Mode.");
    // Mock readyState to 0
    Object.defineProperty(mongoose.connection, "readyState", {
      get: () => 0,
      configurable: true
    });
  }

  const testTradeId1 = "TEST-TRADE-001";
  const testTradeId2 = "TEST-TRADE-002";

  // Clean up sandbox maps and database records
  localPhoenixTradeMemory.clear();
  if (isMongoAvailable) {
    await mongoose.connection.db.collection("phoenixTradeMemory").deleteMany({
      tradeId: { $in: [testTradeId1, testTradeId2] }
    });
  }

  // Test 1: Record Completed Trade Snapshot
  console.log("\n[Test 1] Testing snapshot creation...");
  const mockSnap = buildMockTradeSnapshot(testTradeId1);
  const recorded = await recordCompletedTrade(mockSnap);
  assert(recorded.tradeId === testTradeId1, "Correctly created and returned trade document");
  assert(recorded.schemaVersion === "1.0", "Includes correct default schemaVersion");
  assert(recorded.engineVersion === "FX Desk Pro v1.0", "Includes correct engineVersion");
  assert(recorded.execution.actualFill === 1999.0, "Includes requested execution metrics");
  assert(recorded.featureVector.consensusScore === 85, "Preserves ML Feature Vector snapshot parameters");
  assert(recorded.lifecycleTimeline.length === 3, "Preserves full lifecycle timeline events list");

  // Test 2: Immutability Save Protection
  console.log("\n[Test 2] Testing ledger save immutability...");
  if (isMongoAvailable) {
    const retrievedDoc = await PhoenixTradeMemory.findOne({ tradeId: testTradeId1 });
    assert(retrievedDoc !== null, "Document exists in DB");
    retrievedDoc.symbol = "EURUSD";
    let saveThrew = false;
    try {
      await retrievedDoc.save();
    } catch (err) {
      saveThrew = true;
      assert(err.message.includes("append-only"), `Pre-save hook successfully blocked update: ${err.message}`);
    }
    assert(saveThrew, "Attempting to save an existing document threw an error");
  } else {
    // In-memory frozen test check
    let mutateThrew = false;
    try {
      recorded.symbol = "EURUSD";
    } catch (err) {
      mutateThrew = true;
      assert(true, `Frozen object mutation successfully blocked: ${err.message}`);
    }
    assert(mutateThrew, "Modifying properties on a returned snapshot object throws TypeError (deep frozen check)");
  }

  // Test 3: Immutability Update Query Protection
  console.log("\n[Test 3] Testing update queries lockout...");
  let updateThrew = false;
  try {
    await updateTradeMemory(testTradeId1, { symbol: "GBPUSD" });
  } catch (err) {
    updateThrew = true;
    assert(err.message.includes("prohibited") || err.message.includes("append-only"), `Query hook blocked update operation: ${err.message}`);
  }
  assert(updateThrew, "Update mutation query threw error as expected");

  // Test 4: Immutability Delete Query Protection
  console.log("\n[Test 4] Testing delete queries lockout...");
  let deleteThrew = false;
  try {
    await deleteTradeMemory(testTradeId1);
  } catch (err) {
    deleteThrew = true;
    assert(err.message.includes("prohibited") || err.message.includes("append-only"), `Query hook blocked delete operation: ${err.message}`);
  }
  assert(deleteThrew, "Delete mutation query threw error as expected");

  // Test 5: Duplicate Prevention
  console.log("\n[Test 5] Testing duplicate tradeId prevention...");
  const dupSnap = buildMockTradeSnapshot(testTradeId1);
  let dupThrew = false;
  try {
    await recordCompletedTrade(dupSnap);
  } catch (err) {
    dupThrew = true;
    assert(err.message.includes("already exists"), `Service successfully blocked duplicate insertion: ${err.message}`);
  }
  assert(dupThrew, "Inserting duplicate tradeId throws error");

  // Test 6: Historical Replay (Read-Only queries)
  console.log("\n[Test 6] Testing historical replay query...");
  const secondSnap = buildMockTradeSnapshot(testTradeId2);
  await recordCompletedTrade(secondSnap);

  const history = await getTradeHistory({ symbol: "XAUUSD" });
  assert(history.length === 2, `Retrieved exactly 2 historical trades (Actual: ${history.length})`);
  assert(history[0].tradeId === testTradeId1, "Correctly replayed first trade ticket");
  assert(history[1].tradeId === testTradeId2, "Correctly replayed second trade ticket");

  // Test 7: Deep Freeze validation
  console.log("\n[Test 7] Testing deep freeze validation...");
  assert(Object.isFrozen(history[0]), "Root query history item is frozen");
  assert(Object.isFrozen(history[0].featureVector), "Feature vector sub-object is frozen");

  // Test 8: Index Verification
  console.log("\n[Test 8] Testing database index verification...");
  if (isMongoAvailable) {
    const indexInfo = await PhoenixTradeMemory.collection.indexes();
    const indexKeys = indexInfo.map(idx => Object.keys(idx.key)[0]);
    const requiredIndexKeys = [
      "tradeId",
      "symbol",
      "environment.session",
      "decisionEngine.decision",
      "decisionEngine.grade",
      "result.outcome",
      "result.closeTime"
    ];
    requiredIndexKeys.forEach(k => {
      assert(indexKeys.includes(k), `Database has active index for key: ${k}`);
    });
  } else {
    // Assert keys are configured in schema indexes structure
    const indexes = PhoenixTradeMemory.schema.indexes();
    const indexedFields = indexes.map(idx => Object.keys(idx[0])[0]);
    const requiredIndexFields = [
      "symbol",
      "environment.session",
      "decisionEngine.decision",
      "decisionEngine.grade",
      "result.outcome",
      "result.closeTime"
    ];
    requiredIndexFields.forEach(f => {
      assert(indexedFields.includes(f), `Schema declares index for key: ${f}`);
    });
    // tradeId has unique: true which creates native index
    assert(PhoenixTradeMemory.schema.paths.tradeId.options.unique === true, "Schema has unique index option for: tradeId");
  }

  // Clean up
  if (isMongoAvailable) {
    console.log("\n[Cleanup] Removing sandbox test records via native driver...");
    await mongoose.connection.db.collection("phoenixTradeMemory").deleteMany({
      tradeId: { $in: [testTradeId1, testTradeId2] }
    });
    await mongoose.connection.close();
  }

  console.log("\n==============================================");
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log("==============================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
