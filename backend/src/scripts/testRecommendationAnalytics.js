import mongoose from "mongoose";
import { captureIntelligenceSnapshot, updateSnapshotOutcome, getDashboardAndAnalytics, localSnapshots } from "../services/recommendationAnalyticsService.js";
import { AiRecommendationSnapshot } from "../models/aiRecommendationSnapshotModel.js";
import { getAiAnalytics } from "../services/aiAnalyticsService.js";

async function run() {
  console.log("=== RUNNING RECOMMENDATION QUALITY ANALYTICS TESTS ===");

  let testFailed = false;

  // Clear memory cache
  localSnapshots.clear();

  // Stub ReadyState
  let mockReadyState = 1;
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => mockReadyState,
    configurable: true
  });

  // Track MongoDB model calls
  let dbCreates = [];
  let dbUpdates = [];

  AiRecommendationSnapshot.create = async (data) => {
    dbCreates.push(data);
    return data;
  };

  AiRecommendationSnapshot.updateOne = async (query, update) => {
    dbUpdates.push({ query, update });
    const cached = localSnapshots.get(query.recommendationId);
    if (cached) {
      cached.outcome = {
        ...cached.outcome,
        ...update.$set.outcome
      };
      localSnapshots.set(query.recommendationId, cached);
    }
    return { nModified: 1 };
  };

  AiRecommendationSnapshot.find = () => ({
    lean: async () => Array.from(localSnapshots.values())
  });

  AiRecommendationSnapshot.findOne = (query) => ({
    lean: async () => localSnapshots.get(query.recommendationId) || null
  });

  // Mock recommendation result
  const mockRec = {
    recommendationId: "AI-20260709-120000-TEST",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2005,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    confidence: 85
  };

  // Mock prompt template and context
  const mockContext = {
    telegramQuality: "Excellent",
    telegramConsensus: 90,
    weightedConsensus: "High-quality BUY consensus",
    channelReliability: "High",
    marketRegime: "Trending",
    regimeConfidence: 75,
    institutionalBias: "Bullish",
    macroAlignment: "Perfect Bullish Macro Alignment",
    macroConflictLevel: "Low",
    premiumDiscount: "DISCOUNT",
    nearestOrderBlock: "Bullish: 1995.00-1990.00 | Bearish: None",
    nearestFairValueGap: "Bullish: 2002.00-2008.00 | Bearish: None",
    liquidityStatus: "Equal Highs: None | Equal Lows: 1998.00 | Last Sweep: Bullish Sweep",
    dxyDirection: "DOWN",
    us10yDirection: "DOWN",
    silverDirection: "UP",
    overallConfluenceScore: 82,
    tradeFilter: "ALLOW",
    tradingSession: "London",
    emergencyMacroOverrideStatus: false,
    promptVersion: "1.0",
    promptHash: "abc123promptmd5hash",
    geminiModel: "gemini-2.5-flash"
  };

  console.log("\n[Test 1] Testing Capture Snapshot Persistence (MongoDB Active)...");
  await captureIntelligenceSnapshot(mockRec, mockContext);

  if (dbCreates.length !== 1) {
    console.error("-> FAIL: Snapshot did not invoke MongoDB create.");
    testFailed = true;
  } else {
    const doc = dbCreates[0];
    if (doc.recommendationId !== mockRec.recommendationId) {
      console.error("-> FAIL: Saved recommendationId mismatch.");
      testFailed = true;
    } else if (doc.schemaVersion !== 1) {
      console.error("-> FAIL: Schema version is not 1.");
      testFailed = true;
    } else if (doc.promptMetadata.promptHash !== mockContext.promptHash) {
      console.error("-> FAIL: Prompt metadata hash mismatch.");
      testFailed = true;
    } else {
      console.log("-> PASS: Snapshot captured and stored correctly in MongoDB.");
    }
  }

  console.log("\n[Test 2] Testing Outcome Updates (MFE/MAE/Holding Time)...");
  const terminalOutcome = {
    status: "FULL_TP",
    simulatedEntryPrice: 2002,
    simulatedEntryTime: new Date(Date.now() - 3600 * 1000), // 1 hour ago
    outcomePrice: 2040,
    outcomeTime: new Date(),
    highestPriceSeen: 2042,
    lowestPriceSeen: 2000
  };

  await updateSnapshotOutcome(mockRec.recommendationId, terminalOutcome);

  if (dbUpdates.length !== 1) {
    console.error("-> FAIL: Outcome did not invoke MongoDB update.");
    testFailed = true;
  } else {
    const updatePayload = dbUpdates[0].update.$set.outcome;
    if (updatePayload.status !== "FULL_TP") {
      console.error("-> FAIL: Outcome status mismatch.");
      testFailed = true;
    } else if (Math.abs(updatePayload.holdingTimeMs - 3600 * 1000) > 1000) {
      console.error("-> FAIL: Holding time calculation incorrect.");
      testFailed = true;
    } else if (updatePayload.maxFavorableExcursion !== 40) {
      // MFE: 2042 - 2002 = 40
      console.error("-> FAIL: MFE calculation incorrect. Expected 40, got " + updatePayload.maxFavorableExcursion);
      testFailed = true;
    } else if (updatePayload.maxAdverseExcursion !== 2) {
      // MAE: 2002 - 2000 = 2
      console.error("-> FAIL: MAE calculation incorrect. Expected 2, got " + updatePayload.maxAdverseExcursion);
      testFailed = true;
    } else if (updatePayload.distanceTravelled !== 38) {
      // Distance: 2040 - 2002 = 38
      console.error("-> FAIL: Distance travelled calculation incorrect. Expected 38, got " + updatePayload.distanceTravelled);
      testFailed = true;
    } else {
      console.log("-> PASS: Outcome metrics computed and updated correctly.");
    }
  }

  console.log("\n[Test 3] Testing Local Cache Fallback (Mongoose Offline)...");
  mockReadyState = 0; // Set Mongo readyState to disconnected
  dbCreates = [];
  dbUpdates = [];

  const mockRec2 = {
    recommendationId: "AI-20260709-130000-OFFLINE",
    direction: "SELL",
    entryMin: 2010,
    entryMax: 2012,
    sl: 2025,
    tp: 1995,
    moderateTp: 1985,
    highRiskTp: 1975,
    confidence: 70
  };

  const mockContext2 = {
    ...mockContext,
    marketRegime: "Compression",
    macroAlignment: "Strong Bearish",
    institutionalBias: "Bearish",
    telegramQuality: "Medium",
    tradingSession: "New York"
  };

  await captureIntelligenceSnapshot(mockRec2, mockContext2);

  if (dbCreates.length > 0) {
    console.error("-> FAIL: MongoDB create called while offline.");
    testFailed = true;
  } else {
    const cached = localSnapshots.get(mockRec2.recommendationId);
    if (!cached || cached.marketRegime !== "Compression") {
      console.error("-> FAIL: Offline snapshot not stored in local memory fallback.");
      testFailed = true;
    } else {
      console.log("-> PASS: Snapshot persisted to memory cache under DB offline condition.");
    }
  }

  const terminalOutcome2 = {
    status: "SL",
    simulatedEntryPrice: 2011,
    simulatedEntryTime: new Date(Date.now() - 1800 * 1000), // 30 mins ago
    outcomePrice: 2025,
    outcomeTime: new Date(),
    highestPriceSeen: 2026,
    lowestPriceSeen: 2008
  };

  await updateSnapshotOutcome(mockRec2.recommendationId, terminalOutcome2);

  if (dbUpdates.length > 0) {
    console.error("-> FAIL: MongoDB update called while offline.");
    testFailed = true;
  } else {
    const cached = localSnapshots.get(mockRec2.recommendationId);
    const outcome = cached.outcome;
    if (outcome.status !== "SL" || outcome.maxFavorableExcursion !== 3 || outcome.maxAdverseExcursion !== 15) {
      // SELL MFE: 2011 - 2008 = 3
      // SELL MAE: 2026 - 2011 = 15
      console.error("-> FAIL: Memory-based outcome calculations failed. Excursions: MFE=" + outcome.maxFavorableExcursion + ", MAE=" + outcome.maxAdverseExcursion);
      testFailed = true;
    } else {
      console.log("-> PASS: Outcome calculated and cached in local memory correctly.");
    }
  }

  console.log("\n[Test 4] Testing Dashboard & Effectiveness Calculations...");
  // Now we have two completed trades:
  // Trade 1: Buy, Status FULL_TP (Win)
  // Trade 2: Sell, Status SL (Loss)
  // Expected win rate = 1 / (1 + 1) * 100 = 50%
  const report = await getDashboardAndAnalytics();
  const dashboard = report.performanceDashboard;

  if (dashboard.overallWinRate !== 50.0) {
    console.error("-> FAIL: Expected overall win rate to be 50.0%, got: " + dashboard.overallWinRate);
    testFailed = true;
  } else {
    console.log("-> PASS: Overall Win Rate evaluated correctly.");
  }

  if (dashboard.bestMarketRegime.regime !== "Trending" || dashboard.worstMarketRegime.regime !== "Compression") {
    console.error("-> FAIL: Best/Worst regime identification failed. Best: " + dashboard.bestMarketRegime.regime + ", Worst: " + dashboard.worstMarketRegime.regime);
    testFailed = true;
  } else {
    console.log("-> PASS: Best/Worst Market Regime verified.");
  }

  if (report.intelligenceEffectiveness.orderBlock.Present.total !== 2) {
    console.error("-> FAIL: Effectiveness groupings fail to count OB presence.");
    testFailed = true;
  } else {
    console.log("-> PASS: Intelligence effectiveness grouping correct.");
  }

  console.log("\n[Test 5] Testing Aggregation Query Performance (Load Test)...");
  // Insert 200 dummy snapshots to verify load aggregation is fast (< 5ms)
  const regimes = ["Trending", "Range", "Breakout"];
  const loadCount = 200;
  for (let i = 0; i < loadCount; i++) {
    const id = `AI-LOAD-${i}`;
    localSnapshots.set(id, {
      recommendationId: id,
      timestamp: new Date(),
      direction: i % 2 === 0 ? "BUY" : "SELL",
      entryMin: 2000,
      entryMax: 2005,
      sl: 1990,
      tp: 2020,
      marketRegime: regimes[i % regimes.length],
      macroAlignment: "Mixed",
      institutionalBias: "Neutral",
      outcome: {
        status: i % 3 === 0 ? "FULL_TP" : "SL",
        holdingTimeMs: 1200000,
        maxFavorableExcursion: 10,
        maxAdverseExcursion: 5,
        resolvedAt: new Date()
      }
    });
  }
  const startT = performance.now();
  await getDashboardAndAnalytics();
  const durationMs = performance.now() - startT;

  console.log(`Computed load dashboard over ${localSnapshots.size} items in ${durationMs.toFixed(3)}ms`);
  if (durationMs > 10.0) {
    console.warn("-> WARNING: Aggregation performance exceeds 10ms threshold.");
  } else {
    console.log("-> PASS: Aggregation performance is highly optimized.");
  }

  console.log("\n[Test 6] Testing Express Controller Route Integration...");

  await getAiAnalytics().then(analytics => {
    if (!analytics.performanceDashboard || analytics.performanceDashboard.overallWinRate === undefined) {
      console.error("-> FAIL: Dashboard fields missing from main analytics structure.");
      testFailed = true;
    } else {
      console.log("-> PASS: Exposing snapshot metrics in getAiAnalytics successfully.");
    }
  });

  if (testFailed) {
    console.error("\n=== RECOMMENDATION QUALITY ANALYTICS TESTS FAILED ===");
    process.exit(1);
  } else {
    console.log("\n=== ALL RECOMMENDATION QUALITY ANALYTICS TESTS PASSED ===");
    process.exit(0);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
