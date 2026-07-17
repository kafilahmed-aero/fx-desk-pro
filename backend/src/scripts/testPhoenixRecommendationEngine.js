import mongoose from "mongoose";
import { config } from "../config/env.js";
import { localPhoenixTradeMemory } from "../services/phoenixMemoryService.js";
import { localPhoenixTradeFeatures } from "../services/phoenixFeatureEngine.js";
import {
  generateRecommendations,
  saveRecommendationsToLedger,
  getRecommendations,
  localPhoenixRecommendations,
  generateDeterministicId,
  detectAndResolveConflicts
} from "../services/phoenixRecommendationEngine.js";
import { PhoenixRecommendation } from "../models/phoenixRecommendationModel.js";

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

// Mock completed trade snapshot generator
function createMockTrade({ tradeId, closeTime, netProfit, outcome, channel, session, grade, strategy, durationMs }) {
  const raw = {
    tradeId,
    symbol: "XAUUSD",
    direction: "BUY",
    signalInfo: {
      channels: [channel],
      consensusPercentage: 85,
      confidence: 88
    },
    decisionEngine: {
      decision: "BUY",
      grade,
      finalScore: 88,
      reasons: ["Test reason"],
      warnings: []
    },
    marketContext: {
      overallScore: 82,
      session: { currentSession: session },
      trend: { score: 85 },
      structure: { score: 80 }
    },
    smartEntry: {
      recommendedStrategy: strategy,
      entryQuality: "GRADE B",
      entryPrice: 2000.0,
      entryRR: 2.5
    },
    execution: {
      lotSize: 0.1,
      actualFill: 2000.0,
      stopLoss: 1990.0,
      takeProfit: 2025.0
    },
    lifecycleTimeline: [
      { event: "Trade Opened", timestamp: new Date(new Date(closeTime).getTime() - durationMs) }
    ],
    result: {
      outcome,
      netProfit,
      rMultiple: 2.5,
      rrAchieved: outcome === "FULL_TP" ? 2.5 : (netProfit > 0 ? 1.0 : -1.0),
      durationMs,
      closeTime: new Date(closeTime)
    },
    environment: {
      session,
      timestamp: new Date(closeTime)
    }
  };

  const features = {
    direction: 1.0,
    lotSize: 0.1,
    entryType: strategy === "LIMIT" ? 2.0 : 1.0,
    tradeDuration: durationMs / 1000.0,
    risk: 10.0,
    reward: 25.0,
    rr: 2.5,
    consensusScore: 0.85,
    agreeingChannels: 1.0,
    disagreeingChannels: 0.0,
    signalFreshness: 0.0,
    finalScore: 0.88,
    grade: grade === "GRADE A" ? 1.0 : 0.75,
    confidence: 0.88,
    warningCount: 0.0,
    reasonCount: 1.0,
    overallScore: 0.82,
    trendScore: 0.85,
    structureScore: 0.8,
    sessionScore: 0.9,
    volatilityScore: 0.0,
    spreadScore: 0.0,
    entryQuality: 0.66,
    strategy: strategy === "LIMIT" ? 2.0 : 1.0,
    chasingFlag: 0.0,
    expectedRR: 2.5,
    breakEvenTriggered: 0.0,
    trailingActivated: 0.0,
    partialTpCount: 0.0,
    timeExit: outcome === "TIME_EXIT" ? 1.0 : 0.0,
    marketExit: outcome === "MARKET_EXIT" ? 1.0 : 0.0,
    winLoss: (outcome === "FULL_TP" || outcome === "PARTIAL_TP") ? 1.0 : -1.0,
    profit: netProfit,
    drawdown: 0.0,
    mfe: 0.0,
    mae: 0.0,
    rMultiple: 2.5
  };

  return { raw, features };
}

async function runTests() {
  console.log("=== RUNNING PHOENIX RECOMMENDATION ENGINE TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Clear caches and collections before starting
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();
  localPhoenixRecommendations.clear();

  if (isMongoAvailable) {
    try {
      await mongoose.connection.db.collection("phoenixRecommendation").deleteMany({});
    } catch (e) {}
  }

  // Force simulate offline for primary ledger transition checks
  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  const todayStr = new Date().toISOString();

  // 1. Test Insufficient-Data Suppression
  console.log("\n[Test 1] Testing Insufficient-Data Suppression...");
  const emptyRecs = await generateRecommendations({ timeframe: "allTime" });
  assert(emptyRecs.length === 1, "Generates exactly one recommendation on empty dataset");
  assert(emptyRecs[0].category === "System Health", "Empty dataset recommendation falls under System Health category");
  assert(emptyRecs[0].title === "Collect More Historical Trade Data", "Recommends collecting more historical trade data");
  assert(emptyRecs[0].confidence === "LOW", "Empty dataset recommendation has LOW confidence");

  // 2. Seed Mock data (5 trades)
  console.log("\n[Test 2] Seeding mock data for rule evaluations...");
  const tradesToSeed = [
    { tradeId: "T-101", closeTime: todayStr, netProfit: 100.0, outcome: "FULL_TP", channel: "VincentGold", session: "London", grade: "GRADE A", strategy: "LIMIT", durationMs: 600000 },
    { tradeId: "T-102", closeTime: todayStr, netProfit: 150.0, outcome: "FULL_TP", channel: "VincentGold", session: "London", grade: "GRADE A", strategy: "LIMIT", durationMs: 900000 },
    { tradeId: "T-103", closeTime: todayStr, netProfit: 200.0, outcome: "FULL_TP", channel: "VincentGold", session: "London", grade: "GRADE A", strategy: "LIMIT", durationMs: 1200000 },
    // channel: GoldVIP, session: New York, grade: GRADE C (Losses)
    { tradeId: "T-104", closeTime: todayStr, netProfit: -80.0, outcome: "SL", channel: "GoldVIP", session: "New York", grade: "GRADE C", strategy: "MARKET", durationMs: 1800000 },
    { tradeId: "T-105", closeTime: todayStr, netProfit: -100.0, outcome: "SL", channel: "GoldVIP", session: "New York", grade: "GRADE C", strategy: "MARKET", durationMs: 3600000 }
  ];

  tradesToSeed.forEach(seed => {
    const { raw, features } = createMockTrade(seed);
    localPhoenixTradeMemory.set(seed.tradeId, raw);
    localPhoenixTradeFeatures.set(seed.tradeId, { tradeId: seed.tradeId, symbol: "XAUUSD", features });
  });

  const fullRecs = await generateRecommendations({ timeframe: "allTime" });
  assert(fullRecs.length > 1, `Generates multiple active recommendations when data is sufficient (Recs count: ${fullRecs.length})`);

  // 3. Evidence and Identity Completeness
  console.log("\n[Test 3] Testing Evidence and Identity Completeness...");
  const sampleRec = fullRecs[0];
  assert(sampleRec.recommendationId !== undefined, "Recommendation includes unique recommendationId");
  assert(sampleRec.recommendationVersion === "1.0", "Recommendation includes version '1.0'");
  assert(sampleRec.generatedAt !== undefined, "Recommendation includes generatedAt timestamp");
  assert(sampleRec.analyticsVersion === "1.0", "Recommendation includes analyticsVersion '1.0'");
  assert(sampleRec.status === "ACTIVE", "New recommendation starts in ACTIVE status");
  assert(sampleRec.priority !== undefined, "Recommendation includes priority rating (HIGH/MEDIUM/LOW)");
  assert(sampleRec.confidence !== undefined, "Recommendation includes confidence rating");
  assert(sampleRec.impact !== undefined, "Recommendation includes impact estimate");
  assert(sampleRec.evidenceSummary !== undefined, "Recommendation includes evidence summary string");
  assert(sampleRec.explanation !== undefined, "Recommendation includes explanation text");
  assert(sampleRec.supportingStatistics !== undefined, "Recommendation includes supportingStatistics object");

  // 4. Test Deterministic ID generation
  console.log("\n[Test 4] Testing Deterministic ID Generation...");
  const id1 = generateDeterministicId("Test Title", "Channels", "allTime");
  const id2 = generateDeterministicId("Test Title", "Channels", "allTime");
  const id3 = generateDeterministicId("Different Title", "Channels", "allTime");
  assert(id1 === id2, "generateDeterministicId produces identical output for identical arguments");
  assert(id1 !== id3, "generateDeterministicId produces different output for different arguments");

  // 5. Test Conflict Detection and Resolution
  console.log("\n[Test 5] Testing Recommendation Conflict Resolution...");
  const mockConflictRecs = [
    {
      recommendationId: "REC-MOCK-1",
      category: "Channels",
      title: "Increase Confidence Weighting for Channel VincentGold",
      priority: "HIGH",
      confidence: "HIGH",
      impact: "HIGH",
      evidenceSummary: "Win rate is 100%",
      explanation: "Good channel",
      supportingStatistics: {},
      timeframe: "allTime"
    },
    {
      recommendationId: "REC-MOCK-2",
      category: "Channels",
      title: "Decrease Confidence Weighting for Channel VincentGold",
      priority: "HIGH",
      confidence: "HIGH",
      impact: "HIGH",
      evidenceSummary: "Win rate drops",
      explanation: "Bad channel",
      supportingStatistics: {},
      timeframe: "allTime"
    }
  ];

  const resolved = detectAndResolveConflicts(mockConflictRecs);
  assert(resolved.length === 1, "Conflicting recommendations are merged into exactly one resolved recommendation");
  assert(resolved[0].category === "System Health", "Resolved conflict recommendation is categorized under System Health");
  assert(resolved[0].title.includes("Conflict Resolved"), "Title flags conflict resolution");
  assert(resolved[0].explanation.includes("conflict resolved"), "Explanation describes the conflict resolution details");

  // 6. Test Status Transitions
  console.log("\n[Test 6] Testing Historical Status Transitions...");
  // Clear map cache
  localPhoenixRecommendations.clear();
  
  // Record first set of recommendations
  const set1 = await generateRecommendations({ timeframe: "allTime" });
  await saveRecommendationsToLedger(set1);
  
  const saved1 = Array.from(localPhoenixRecommendations.values());
  assert(saved1.every(r => r.status === "ACTIVE"), "Initial saved recommendations all start as ACTIVE");
  
  // Record second identical set
  await saveRecommendationsToLedger(set1);
  const saved2 = Array.from(localPhoenixRecommendations.values());
  
  // Should still be active because they have the exact same recommendationId (so they are ignored/deduped)
  // Let's create an updated mock recommendation with different ID but same Title/Category to trigger superseded state
  const newMockRec = {
    ...set1[0],
    recommendationId: "REC-NEW-ID-XYZ",
    evidenceSummary: "Win rate increases to 95%"
  };

  await saveRecommendationsToLedger([newMockRec]);
  
  // Query previous recommendation to verify status transition
  const prevRec = localPhoenixRecommendations.get(set1[0].recommendationId);
  assert(prevRec.status === "SUPERSEDED", "Older recommendation with matching Category/Title was transitioned to SUPERSEDED status");

  // 7. Test Mongoose Online database check (if Mongo connected)
  if (isMongoAvailable) {
    console.log("\n[Test 7] Testing Mongoose Database Integration...");
    
    // Restore state to Mongo
    Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });
    
    try {
      await saveRecommendationsToLedger(set1);
      
      const queried = await getRecommendations({ status: "ACTIVE" });
      assert(queried.length > 0, "getRecommendations retrieves active records from MongoDB database");
      
      // Try to mutate other fields on saved document (should fail)
      try {
        await PhoenixRecommendation.updateOne({ recommendationId: set1[0].recommendationId }, { $set: { title: "Mutated Title" } });
        assert(false, "Mongoose updateOne allowed modifying append-only recommendation title");
      } catch (e) {
        assert(e.message.includes("Only status transitions"), `updateOne block prevents title modifications (Message: ${e.message})`);
      }

      // Try status transition only (should pass)
      await PhoenixRecommendation.updateOne({ recommendationId: set1[0].recommendationId }, { $set: { status: "ARCHIVED" } });
      const updatedDoc = await PhoenixRecommendation.findOne({ recommendationId: set1[0].recommendationId });
      assert(updatedDoc.status === "ARCHIVED", "Mongoose updateOne allowed status transition successfully");
      
      // Try to delete document (should fail)
      try {
        await PhoenixRecommendation.deleteOne({ recommendationId: set1[0].recommendationId });
        assert(false, "Mongoose deleteOne allowed deleting append-only recommendation");
      } catch (e) {
        assert(e.message.includes("prohibited"), `deleteOne block prevents record deletion (Message: ${e.message})`);
      }
    } catch (e) {
      console.error("  FAIL: Online validation failed", e);
      failCount++;
    }
  }

  // Restore state to original
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
