import mongoose from "mongoose";
import { config } from "../config/env.js";
import { PhoenixTradeFeature } from "../models/phoenixFeatureModel.js";
import {
  generateFeatureVector,
  recordTradeFeatures,
  getTradeFeatures,
  localPhoenixTradeFeatures,
  normalizePercentage,
  normalizeScore,
  normalizeRR,
  normalizeDuration,
  normalizeSpread,
  normalizeProfit
} from "../services/phoenixFeatureEngine.js";

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
      parsedSignal: { pair: "XAUUSD", action: "BUY", timestamp: "2026-07-04T12:00:00Z" },
      originalSignal: "BUY GOLD AT 2000",
      confidence: 90
    },

    decisionEngine: {
      decision: "BUY",
      grade: "GRADE A",
      finalScore: 92,
      decisionBreakdown: { consensus: 35, marketIntelligence: 40 },
      reasons: ["Strong bullish bias", "Perfect London session liquidity sweep", "Chasing setup"],
      warnings: ["High spreads warning"]
    },

    marketContext: {
      overallScore: 88,
      status: "HEALTHY",
      trend: { score: 90, status: "STRONG_BULLISH" },
      structure: { score: 85, status: "FAVORABLE" },
      session: { score: 95 },
      volatility: { score: 80, volatilityLevel: "Normal" },
      spread: { score: 75, metrics: { currentSpread: 1.2 } }
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
      { event: "Trade Opened", timestamp: new Date("2026-07-04T12:05:00Z"), metadata: { price: 1999.0 } },
      { event: "Break Even Activated", timestamp: new Date("2026-07-04T12:15:00Z"), metadata: { sl: 2000.0 } },
      { event: "Partial TP1", timestamp: new Date("2026-07-04T12:25:00Z"), metadata: { closePercent: 30 } }
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
      closeTime: new Date("2026-07-04T12:35:00Z")
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
  console.log("=== RUNNING PHOENIX FEATURE ENGINEERING ENGINE TESTS ===\n");

  let isMongoAvailable = false;
  try {
    console.log("Connecting to MongoDB:", config.mongoUri);
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Clear caches and collections before starting
  localPhoenixTradeFeatures.clear();
  if (isMongoAvailable) {
    try {
      await mongoose.connection.db.collection("phoenixTradeFeature").deleteMany({});
    } catch (e) {}
  }

  const testTradeId1 = "TEST-TRADE-001";
  const testTradeId2 = "TEST-TRADE-002";

  // 1. Test Normalization Boundary Checks
  console.log("\n[Test 1] Testing Normalization Boundary Checks...");
  assert(normalizePercentage(85) === 0.85, "normalizePercentage(85) resolves to 0.85");
  assert(normalizePercentage(150) === 1.5, "normalizePercentage(150) resolves to 1.5");
  assert(normalizePercentage("invalid") === 0.0, "normalizePercentage('invalid') resolves to 0.0");

  assert(normalizeScore(92.5) === 0.925, "normalizeScore(92.5) resolves to 0.925");
  assert(normalizeScore(null) === 0.0, "normalizeScore(null) resolves to 0.0");

  assert(normalizeRR(15.0, 45.0) === 3.0, "normalizeRR(15.0, 45.0) resolves to 3.0");
  assert(normalizeRR(0.0, 10.0) === 0.0, "normalizeRR(0.0, 10.0) resolves to 0.0 (prevent division by zero)");
  assert(normalizeRR(10.0, "abc") === 0.0, "normalizeRR with invalid input resolves to 0.0");

  assert(normalizeDuration(1800000) === 1800.0, "normalizeDuration(1800000) resolves to 1800.0 seconds");
  assert(normalizeDuration(-500) === 0.0, "normalizeDuration(-500) resolves to 0.0");

  assert(normalizeSpread(1.8) === 1.8, "normalizeSpread(1.8) resolves to 1.8");
  assert(normalizeProfit(-150.55) === -150.55, "normalizeProfit(-150.55) resolves to -150.55");

  // 2. Test Feature Vector Determinism & Stable Ordering
  console.log("\n[Test 2] Testing Feature Vector Determinism & Stable Ordering...");
  const mockSnapshot1 = buildMockTradeSnapshot(testTradeId1);
  const result1 = generateFeatureVector(mockSnapshot1);
  const result2 = generateFeatureVector(mockSnapshot1);

  // Assert exact structural determinism
  assert(JSON.stringify(result1.features) === JSON.stringify(result2.features), "Deterministic generation returns identical JSON strings");

  // Assert column key ordering stability
  const keys1 = Object.keys(result1.features);
  const keys2 = Object.keys(result2.features);
  assert(keys1.length === 37, "Feature vector contains exactly 37 engineered columns");
  let keysMatch = true;
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) keysMatch = false;
  }
  assert(keysMatch === true, "Feature vector maintains stable, identical column ordering");

  // Verify feature values are mapped correctly
  assert(result1.features.direction === 1.0, "direction is correct (1.0 for BUY)");
  assert(result1.features.lotSize === 0.1, "lotSize is correct (0.1)");
  assert(result1.features.entryType === 2.0, "entryType is correct (2.0 for LIMIT)");
  assert(result1.features.tradeDuration === 1800.0, "tradeDuration is correct (1800.0 seconds)");
  assert(result1.features.risk === 14.0, "risk is correct (14.0)"); // 1999 - 1985
  assert(result1.features.reward === 46.0, "reward is correct (46.0)"); // 2045 - 1999
  assert(result1.features.rr === 3.2857, `rr is correct (3.2857, Actual: ${result1.features.rr})`);
  assert(result1.features.consensusScore === 0.85, "consensusScore is correct (0.85)");
  assert(result1.features.agreeingChannels === 2, "agreeingChannels is correct (2)");
  assert(result1.features.disagreeingChannels === 0, "disagreeingChannels is correct (0)");
  assert(result1.features.signalFreshness === 300.0, "signalFreshness is correct (300.0 seconds)"); // 12:05 - 12:00 = 5 minutes
  assert(result1.features.finalScore === 0.92, "finalScore is correct (0.92)");
  assert(result1.features.grade === 1.0, "grade resolves to 1.0 (GRADE A)");
  assert(result1.features.confidence === 0.9, "confidence is correct (0.90)");
  assert(result1.features.warningCount === 1, "warningCount is correct (1)");
  assert(result1.features.reasonCount === 3, "reasonCount is correct (3)");
  assert(result1.features.overallScore === 0.88, "overallScore is correct (0.88)");
  assert(result1.features.trendScore === 0.9, "trendScore is correct (0.90)");
  assert(result1.features.structureScore === 0.85, "structureScore is correct (0.85)");
  assert(result1.features.sessionScore === 0.95, "sessionScore is correct (0.95)");
  assert(result1.features.volatilityScore === 0.8, "volatilityScore is correct (0.8)");
  assert(result1.features.spreadScore === 0.75, "spreadScore is correct (0.75)");
  assert(result1.features.entryQuality === 0.85, "entryQuality resolves to 0.85 (GRADE A)");
  assert(result1.features.strategy === 2.0, "strategy resolves to 2.0 (LIMIT)");
  assert(result1.features.chasingFlag === 1.0, "chasingFlag is correctly set to 1.0 (Chasing setup in reasons)");
  assert(result1.features.expectedRR === 3.5, "expectedRR is correct (3.5)");
  assert(result1.features.breakEvenTriggered === 1.0, "breakEvenTriggered is correct (1.0)");
  assert(result1.features.trailingActivated === 0.0, "trailingActivated is correct (0.0)");
  assert(result1.features.partialTpCount === 1, "partialTpCount is correct (1)");
  assert(result1.features.timeExit === 0.0, "timeExit is correct (0.0)");
  assert(result1.features.marketExit === 0.0, "marketExit is correct (0.0)");
  assert(result1.features.winLoss === 1.0, "winLoss is correct (1.0 for PARTIAL_TP)");
  assert(result1.features.profit === 150.0, "profit is correct (150.0)");
  assert(result1.features.drawdown === 5.0, "drawdown is correct (5.0)");
  assert(result1.features.mfe === 25.0, "mfe is correct (25.0)");
  assert(result1.features.mae === 3.0, "mae is correct (3.0)");
  assert(result1.features.rMultiple === 1.5, "rMultiple is correct (1.5)");

  // 3. Test Missing-Field Resilience
  console.log("\n[Test 3] Testing Missing-Field Resilience...");
  const emptyResult = generateFeatureVector({});
  assert(emptyResult.features !== undefined, "generateFeatureVector handles empty snapshot without throwing");
  assert(Object.keys(emptyResult.features).length === 37, "Returns complete 37-column feature structure on empty snapshot");
  assert(emptyResult.features.direction === 0.0, "direction falls back to default 0.0");
  assert(emptyResult.features.lotSize === 0.01, "lotSize falls back to default 0.01");
  assert(emptyResult.features.tradeDuration === 0.0, "tradeDuration falls back to default 0.0");
  assert(emptyResult.features.winLoss === 0.0, "winLoss falls back to default 0.0");
  assert(emptyResult.warnings.length > 0, `Pushes warnings about missing fields (Warnings Count: ${emptyResult.warnings.length})`);

  // 4. Test Offline Cache Validation
  console.log("\n[Test 4] Testing Offline Cache Validation...");
  const originalState = mongoose.connection.readyState;
  
  // Force simulate offline
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });
  
  const savedOffline = await recordTradeFeatures(buildMockTradeSnapshot(testTradeId2));
  assert(savedOffline !== null, "recordTradeFeatures saves trade features in offline mode");
  assert(localPhoenixTradeFeatures.has(testTradeId2), "Feature record cached successfully in local map");
  assert(savedOffline.featureVersion === "1.0", "Feature record includes featureVersion '1.0'");
  assert(savedOffline.rawSnapshot !== undefined, "Feature record preserves rawSnapshot data");
  assert(savedOffline.features.direction === 1.0, "Cached features contain correct values");

  // Restore state
  Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

  // 5. Test Mongoose Online Integration (if DB connected)
  if (isMongoAvailable) {
    console.log("\n[Test 5] Testing Online Mongoose Database Integration...");
    try {
      const savedDoc = await recordTradeFeatures(buildMockTradeSnapshot(testTradeId1));
      assert(savedDoc._id !== undefined, "recordTradeFeatures saved feature document to MongoDB successfully");
      assert(localPhoenixTradeFeatures.has(testTradeId1), "Saved document added to local map cache");

      const queriedList = await getTradeFeatures({ tradeId: testTradeId1 });
      assert(queriedList.length === 1, "getTradeFeatures retrieves saved document from MongoDB database");
      assert(queriedList[0].features.direction === 1.0, "Retrieved document contains matching engineered features");
    } catch (e) {
      console.error("  FAIL: Online validation failed", e);
      failCount++;
    }
  }

  // 6. Test Immutability
  console.log("\n[Test 6] Testing Ledger Immutability...");
  const recorded = localPhoenixTradeFeatures.get(testTradeId2);
  assert(Object.isFrozen(recorded) === true, "Returned cached feature object is deeply frozen");
  try {
    recorded.features.direction = 999;
    assert(false, "Mutation of frozen features does not fail (strict mode check)");
  } catch (e) {
    assert(true, "Mutation of frozen features throws strict TypeError (Object is not extensible)");
  }

  if (isMongoAvailable) {
    try {
      await PhoenixTradeFeature.updateOne({ tradeId: testTradeId1 }, { $set: { "features.direction": -99.0 } });
      assert(false, "Mongoose updateOne allowed modifying append-only feature record");
    } catch (e) {
      assert(e.message.includes("append-only"), "updateOne block hook throws modification prohibition error");
    }

    try {
      await PhoenixTradeFeature.deleteOne({ tradeId: testTradeId1 });
      assert(false, "Mongoose deleteOne allowed deleting append-only feature record");
    } catch (e) {
      assert(e.message.includes("append-only"), "deleteOne block hook throws delete prohibition error");
    }
  }

  // 7. Test Duplicate Prevention
  console.log("\n[Test 7] Testing Duplicate Prevention...");
  try {
    await recordTradeFeatures(buildMockTradeSnapshot(testTradeId2));
    assert(false, "Allowed writing duplicate tradeId in offline cache");
  } catch (e) {
    assert(e.message.includes("Duplicate"), `Throws error on writing duplicate tradeId (Message: ${e.message})`);
  }

  if (isMongoAvailable) {
    try {
      await recordTradeFeatures(buildMockTradeSnapshot(testTradeId1));
      assert(false, "Allowed writing duplicate tradeId in online database");
    } catch (e) {
      assert(e.message.includes("Duplicate"), `Throws error on writing duplicate tradeId to MongoDB (Message: ${e.message})`);
    }
  }

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
