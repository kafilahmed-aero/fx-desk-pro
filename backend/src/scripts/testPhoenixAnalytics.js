import mongoose from "mongoose";
import { config } from "../config/env.js";
import { localPhoenixTradeMemory } from "../services/phoenixMemoryService.js";
import { localPhoenixTradeFeatures } from "../services/phoenixFeatureEngine.js";
import {
  generateAnalyticsReport,
  calcMedian,
  calcStandardDeviation,
  calcPercentiles,
  calcConfidenceLevel,
  calcTrend,
  filterByTimeframe
} from "../services/phoenixAnalyticsEngine.js";

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
function createMockTrade({ tradeId, closeTime, netProfit, outcome, channel, session, grade, strategy, durationMs, drawdown = 0.0 }) {
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
      drawdown,
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
    drawdown,
    mfe: 0.0,
    mae: 0.0,
    rMultiple: 2.5
  };

  return { raw, features };
}

async function runTests() {
  console.log("=== RUNNING PHOENIX ANALYTICS ENGINE TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Clear in-memory maps
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();

  // 1. Test Statistical Calculator Functions
  console.log("\n[Test 1] Testing Statistical Utilities...");
  const oddArray = [10, 20, 30, 40, 50];
  const evenArray = [10, 20, 30, 40];
  assert(calcMedian(oddArray) === 30, "calcMedian calculates median for odd length array");
  assert(calcMedian(evenArray) === 25, "calcMedian calculates median for even length array");
  assert(calcMedian([]) === 0.0, "calcMedian returns 0.0 for empty array");

  const sdArray = [10, 12, 23, 23, 16, 23, 21, 16];
  assert(calcStandardDeviation(sdArray) === 5.2372, `calcStandardDeviation calculates SD correctly (5.2372, Actual: ${calcStandardDeviation(sdArray)})`);
  assert(calcStandardDeviation([5]) === 0.0, "calcStandardDeviation returns 0.0 for single value");

  const percArray = [15, 20, 35, 40, 50];
  const percentiles = calcPercentiles(percArray);
  assert(percentiles.p25 === 20.0, `calcPercentiles computes correct P25 (20, Actual: ${percentiles.p25})`);
  assert(percentiles.p50 === 35.0, `calcPercentiles computes correct P50 (35, Actual: ${percentiles.p50})`);
  assert(percentiles.p75 === 40.0, `calcPercentiles computes correct P75 (40, Actual: ${percentiles.p75})`);

  // 2. Test Confidence Classifiers
  console.log("\n[Test 2] Testing Confidence Classifiers...");
  assert(calcConfidenceLevel(2) === "LOW", "Sample size 2 resolves to LOW confidence");
  assert(calcConfidenceLevel(10) === "MEDIUM", "Sample size 10 resolves to MEDIUM confidence");
  assert(calcConfidenceLevel(25) === "HIGH", "Sample size 25 resolves to HIGH confidence");
  assert(calcConfidenceLevel(100) === "VERY HIGH", "Sample size 100 resolves to VERY HIGH confidence");

  // 3. Test Time-Based Filters
  console.log("\n[Test 3] Testing Time-Based Filtering...");
  const todayStr = new Date().toISOString();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString();
  const sixDaysAgoDate = new Date();
  sixDaysAgoDate.setDate(sixDaysAgoDate.getDate() - 6);
  const sixDaysAgoStr = sixDaysAgoDate.toISOString();
  const fortyDaysAgoDate = new Date();
  fortyDaysAgoDate.setDate(fortyDaysAgoDate.getDate() - 45);
  const fortyDaysAgoStr = fortyDaysAgoDate.toISOString();

  const mockTimeTrades = [
    { result: { closeTime: new Date(todayStr) } },
    { result: { closeTime: new Date(yesterdayStr) } },
    { result: { closeTime: new Date(sixDaysAgoStr) } },
    { result: { closeTime: new Date(fortyDaysAgoStr) } }
  ];

  assert(filterByTimeframe(mockTimeTrades, "today").length === 1, "Filters today timeframe correctly");
  assert(filterByTimeframe(mockTimeTrades, "yesterday").length === 1, "Filters yesterday timeframe correctly");
  assert(filterByTimeframe(mockTimeTrades, "last7Days").length === 3, "Filters last 7 days timeframe correctly");
  assert(filterByTimeframe(mockTimeTrades, "last30Days").length === 3, "Filters last 30 days timeframe correctly");
  assert(filterByTimeframe(mockTimeTrades, "allTime").length === 4, "Filters allTime timeframe correctly");

  // 4. Populate Local Cache for Offline Aggregations testing
  console.log("\n[Test 4] Simulating Offline Data Population...");
  
  // Set readyState = 0 to enforce offline map mode
  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  const tradesToSeed = [
    // channel: GoldVIP, session: London, grade: GRADE A, strategy: LIMIT
    { tradeId: "T-101", closeTime: todayStr, netProfit: 100.0, outcome: "FULL_TP", channel: "GoldVIP", session: "London", grade: "GRADE A", strategy: "LIMIT", durationMs: 600000, drawdown: 2.0 },
    { tradeId: "T-102", closeTime: todayStr, netProfit: 150.0, outcome: "FULL_TP", channel: "GoldVIP", session: "London", grade: "GRADE A", strategy: "LIMIT", durationMs: 900000, drawdown: 1.0 },
    // channel: GoldVIP, session: New York, grade: GRADE B, strategy: MARKET (Loss)
    { tradeId: "T-103", closeTime: yesterdayStr, netProfit: -80.0, outcome: "SL", channel: "GoldVIP", session: "New York", grade: "GRADE B", strategy: "MARKET", durationMs: 1200000, drawdown: 10.0 },
    // channel: AlphaFX, session: London, grade: GRADE B, strategy: LIMIT
    { tradeId: "T-104", closeTime: sixDaysAgoStr, netProfit: 200.0, outcome: "FULL_TP", channel: "AlphaFX", session: "London", grade: "GRADE B", strategy: "LIMIT", durationMs: 1800000, drawdown: 0.5 },
    { tradeId: "T-105", closeTime: sixDaysAgoStr, netProfit: 50.0, outcome: "PARTIAL_TP", channel: "AlphaFX", session: "London/NY Overlap", grade: "GRADE B", strategy: "LIMIT", durationMs: 3600000, drawdown: 1.2 }
  ];

  tradesToSeed.forEach(seed => {
    const { raw, features } = createMockTrade(seed);
    localPhoenixTradeMemory.set(seed.tradeId, raw);
    localPhoenixTradeFeatures.set(seed.tradeId, { tradeId: seed.tradeId, symbol: "XAUUSD", features });
  });

  assert(localPhoenixTradeMemory.size === 5, "Successfully seeded 5 trades into memory ledger cache");
  assert(localPhoenixTradeFeatures.size === 5, "Successfully seeded 5 feature records into feature cache");

  // 5. Test Aggregate Computations (Offline)
  console.log("\n[Test 5] Verifying Aggregate Computations...");
  const report = await generateAnalyticsReport({ timeframe: "allTime" });

  assert(report.overall.totalTrades === 5, "totalTrades is aggregated correctly (5)");
  assert(report.overall.winRate === 0.8, "winRate is aggregated correctly (0.80 / 80%)");
  assert(report.overall.lossRate === 0.2, "lossRate is aggregated correctly (0.20 / 20%)");
  assert(report.overall.netProfit === 420.0, `netProfit is aggregated correctly (420.0, Actual: ${report.overall.netProfit})`);
  assert(report.overall.expectancy === 84.0, `expectancy is computed correctly (84.0, Actual: ${report.overall.expectancy})`);
  assert(report.overall.profitFactor === 6.25, `profitFactor is computed correctly (6.25, Actual: ${report.overall.profitFactor})`);
  assert(report.overall.maxDrawdown === 10.0, "maxDrawdown is correct (10.0)");

  // 6. Test Channel Rankings
  console.log("\n[Test 6] Verifying Channel Performance Rankings...");
  assert(report.channels.GoldVIP !== undefined, "Channel GoldVIP analyzed");
  assert(report.channels.GoldVIP.tradeCount === 3, "GoldVIP tradeCount is correct (3)");
  assert(report.channels.AlphaFX.tradeCount === 2, "AlphaFX tradeCount is correct (2)");
  assert(report.channels.GoldVIP.winRate === 0.6667, `GoldVIP winRate is correct (0.6667, Actual: ${report.channels.GoldVIP.winRate})`);
  assert(report.channels.AlphaFX.winRate === 1.0, "AlphaFX winRate is correct (1.0)");
  assert(report.channels.GoldVIP.reliabilityScore > 0, `GoldVIP reliability score computed: ${report.channels.GoldVIP.reliabilityScore}`);

  // 7. Test Session Performance
  console.log("\n[Test 7] Verifying Session Performance...");
  assert(report.sessions.London.tradeCount === 3, "London Session tradeCount is correct (3)");
  assert(report.sessions.London.winRate === 1.0, "London Session winRate is correct (1.0)");
  assert(report.sessions.London.profit === 450.0, "London Session net profit is correct (450.0)");

  // 8. Test Smart Entry Strategy
  console.log("\n[Test 8] Verifying Smart Entry Performance...");
  assert(report.smartEntry.LIMIT.tradeCount === 4, "LIMIT Strategy tradeCount is correct (4)");
  assert(report.smartEntry.LIMIT.winRate === 1.0, "LIMIT Strategy winRate is correct (1.0)");
  assert(report.smartEntry.LIMIT.profit === 500.0, "LIMIT Strategy net profit is correct (500.0)");

  // 9. Test Trend Detection
  console.log("\n[Test 9] Verifying Performance Trend Detection...");
  // Split trades manually to test calcTrend
  const firstHalf = [ { result: { outcome: "SL", netProfit: -100 } } ];
  const secondHalf = [ { result: { outcome: "FULL_TP", netProfit: 200 } } ];
  assert(calcTrend(firstHalf, secondHalf) === "Improving", "Trend resolves to Improving on positive difference");
  assert(calcTrend(secondHalf, firstHalf) === "Declining", "Trend resolves to Declining on negative difference");
  assert(calcTrend(firstHalf, firstHalf) === "Stable", "Trend resolves to Stable on identical results");

  // 10. Test Explainability & Dashboard metrics
  console.log("\n[Test 10] Verifying Explainability & Dashboard metrics...");
  assert(report.dashboard.topPerformingChannel === "AlphaFX", `topPerformingChannel is correctly identified (AlphaFX, Actual: ${report.dashboard.topPerformingChannel})`);
  assert(report.dashboard.worstChannel === "GoldVIP", "worstChannel is correctly identified (GoldVIP)");
  assert(report.dashboard.bestSession === "London", "bestSession is correctly identified (London)");
  assert(report.dashboard.explanations.topPerformingChannel !== undefined, "Explainability text generated successfully");
  console.log("  Sample Explanation:", report.dashboard.explanations.topPerformingChannel);

  // 11. Test Empty Dataset Handling
  console.log("\n[Test 11] Testing Empty Dataset Resiliency...");
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();
  
  const emptyReport = await generateAnalyticsReport({});
  assert(emptyReport.overall.totalTrades === 0, "Empty dataset returns totalTrades 0");
  assert(emptyReport.overall.winRate === 0.0, "Empty dataset returns winRate 0.0");
  assert(emptyReport.dashboard.topPerformingChannel === "N/A", "Empty dataset returns topPerformingChannel 'N/A'");
  assert(emptyReport.dashboard.explanations.topPerformingChannel.includes("Insufficient sample"), "Empty dataset returns appropriate explanation fallback");

  // 12. Test Large Dataset Scaling (500 Completed Trades)
  console.log("\n[Test 12] Testing Large Dataset Scaling (500 mock trades)...");
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();

  const largeSize = 500;
  const startTime = Date.now();
  
  for (let i = 0; i < largeSize; i++) {
    const profit = Math.random() > 0.3 ? 100.0 : -80.0;
    const outcome = profit > 0 ? "FULL_TP" : "SL";
    const seed = {
      tradeId: `T-LARGE-${i}`,
      closeTime: todayStr,
      netProfit: profit,
      outcome,
      channel: `Channel-${i % 5}`,
      session: i % 2 === 0 ? "London" : "New York",
      grade: i % 3 === 0 ? "GRADE A" : "GRADE B",
      strategy: "LIMIT",
      durationMs: 600000,
      drawdown: 2.0
    };
    const { raw, features } = createMockTrade(seed);
    localPhoenixTradeMemory.set(seed.tradeId, raw);
    localPhoenixTradeFeatures.set(seed.tradeId, { tradeId: seed.tradeId, symbol: "XAUUSD", features });
  }

  const largeReport = await generateAnalyticsReport({});
  const endTime = Date.now();
  
  assert(largeReport.overall.totalTrades === largeSize, `Aggregates all ${largeSize} trades successfully`);
  console.log(`  Report generation time: ${endTime - startTime}ms`);
  assert(endTime - startTime < 1500, "Generates large dataset reports in less than 1500ms");

  // Restore mongoose connection state
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
