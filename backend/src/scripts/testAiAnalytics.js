import { getAiAnalytics } from "../services/aiAnalyticsService.js";
import { localAiRecommendationOutcomes } from "../services/signalOutcomeStore.js";

async function run() {
  console.log("=== RUNNING AI ANALYTICS UNIT TESTS ===");

  // Clear existing outcomes in memory fallback
  localAiRecommendationOutcomes.clear();

  // Test Case 1: Empty DB/State
  console.log("\n[Test 1] Testing calculation defaults on empty outcomes database...");
  const emptyRes = await getAiAnalytics();
  if (
    emptyRes.totalRecommendations === 0 &&
    emptyRes.activeTrades === 0 &&
    emptyRes.fullTp === 0 &&
    emptyRes.partialTp === 0 &&
    emptyRes.breakEven === 0 &&
    emptyRes.sl === 0 &&
    emptyRes.winRate === null &&
    emptyRes.averageRiskReward === null &&
    emptyRes.winningStreak === 0 &&
    emptyRes.losingStreak === 0 &&
    emptyRes.maxDrawdown === null &&
    emptyRes.averageHoldingTime === null &&
    emptyRes.averageConfidence === null
  ) {
    console.log("-> PASS: Correctly returned default/null metrics for empty database.");
  } else {
    console.error("-> FAIL: Returned incorrect values on empty database:", JSON.stringify(emptyRes, null, 2));
    process.exit(1);
  }

  // Populate mock recommendation outcomes
  // We mock a timeline:
  // Trade 1 (oldest): BUY, entry 2000, sl 1990, tp1 2010, tp2 2020, tp3 2030. Generated 3 hrs ago, hit SL 2 hrs ago.
  // Trade 2: BUY, entry 2000, sl 1990, tp1 2010, tp2 2020, tp3 2030. Generated 2 hrs ago, hit TP1, TP2, TP3 1 hr ago. (FULL_TP)
  // Trade 3: SELL, entry 2000, sl 2010, tp1 1990. Generated 1.5 hrs ago. Hit TP1, sl moved to BE, hit BE 1 hr ago. (PARTIAL_TP with exitType="BREAK_EVEN")
  // Trade 4: BUY, entry 2000, sl 1990, tp1 2010. Generated 30 min ago. (ACTIVE)
  // Trade 5 (newest): BUY, entry 2000, sl 1990, tp1 2010. Generated 5 min ago. (PENDING)

  const now = new Date();
  
  const outcome1 = {
    recommendationId: "AI-1001",
    recommendationVersion: 1,
    generatedTime: new Date(now.getTime() - 3 * 3600 * 1000), // 3 hours ago
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2002,
    sl: 1990,
    lowRiskTp: 2010,
    moderateTp: 2020,
    highRiskTp: 2030,
    tradeQuality: "Good",
    confidence: 80,
    riskReward: { lowRisk: 1.0, moderate: 2.0, high: 3.0 },
    status: "SL",
    createdAt: new Date(now.getTime() - 3 * 3600 * 1000),
    updatedAt: new Date(now.getTime() - 2 * 3600 * 1000) // completed 2 hours ago
  };

  const outcome2 = {
    recommendationId: "AI-1002",
    recommendationVersion: 1,
    generatedTime: new Date(now.getTime() - 2 * 3600 * 1000), // 2 hours ago
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2002,
    sl: 1990,
    lowRiskTp: 2010,
    moderateTp: 2020,
    highRiskTp: 2030,
    tradeQuality: "Excellent",
    confidence: 90,
    riskReward: { lowRisk: 1.0, moderate: 2.0, high: 3.0 },
    status: "FULL_TP",
    hitTargets: [1, 2, 3],
    createdAt: new Date(now.getTime() - 2 * 3600 * 1000),
    updatedAt: new Date(now.getTime() - 1 * 3600 * 1000) // completed 1 hour ago
  };

  const outcome3 = {
    recommendationId: "AI-1003",
    recommendationVersion: 1,
    generatedTime: new Date(now.getTime() - 1.5 * 3600 * 1000), // 1.5 hours ago
    pair: "XAUUSD",
    direction: "SELL",
    entryMin: 2000,
    entryMax: 2002,
    sl: 2010,
    lowRiskTp: 1990,
    moderateTp: 1980,
    highRiskTp: 1970,
    tradeQuality: "Average",
    confidence: 70,
    riskReward: { lowRisk: 1.0, moderate: 2.0, high: 3.0 },
    status: "PARTIAL_TP",
    hitTargets: [1],
    exitType: "BREAK_EVEN",
    closedAtBreakEven: true,
    createdAt: new Date(now.getTime() - 1.5 * 3600 * 1000),
    updatedAt: new Date(now.getTime() - 1 * 3600 * 1000) // hit BE 1 hour ago
  };

  const outcome4 = {
    recommendationId: "AI-1004",
    recommendationVersion: 1,
    generatedTime: new Date(now.getTime() - 30 * 60000), // 30 mins ago
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2002,
    sl: 1990,
    lowRiskTp: 2010,
    tradeQuality: "Good",
    confidence: 85,
    riskReward: { lowRisk: 1.0, moderate: null, high: null },
    status: "ACTIVE",
    createdAt: new Date(now.getTime() - 30 * 60000)
  };

  const outcome5 = {
    recommendationId: "AI-1005",
    recommendationVersion: 1,
    generatedTime: new Date(now.getTime() - 5 * 60000), // 5 mins ago
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2002,
    sl: 1990,
    lowRiskTp: 2010,
    tradeQuality: "Poor",
    confidence: 60,
    riskReward: { lowRisk: 1.0, moderate: null, high: null },
    status: "PENDING",
    createdAt: new Date(now.getTime() - 5 * 60000)
  };

  localAiRecommendationOutcomes.set(outcome1.recommendationId, outcome1);
  localAiRecommendationOutcomes.set(outcome2.recommendationId, outcome2);
  localAiRecommendationOutcomes.set(outcome3.recommendationId, outcome3);
  localAiRecommendationOutcomes.set(outcome4.recommendationId, outcome4);
  localAiRecommendationOutcomes.set(outcome5.recommendationId, outcome5);

  console.log("\n[Test 2] Running calculation checks on mock outcomes database...");
  const res = await getAiAnalytics();
  
  // Assertions:
  // 1. totalRecommendations = 5
  // 2. activeTrades = 2 (outcome4 and outcome5; wait, outcome3 has status "PARTIAL_TP" but exitType="BREAK_EVEN" which counts as resolved!)
  // 3. fullTp = 1
  // 4. partialTp = 1 (outcome3)
  // 5. breakEven = 1 (outcome3)
  // 6. sl = 1
  // 7. winRate = wins / (wins + sl) = (1 + 1) / (1 + 1 + 1) = 2 / 3 * 100 = 66.7%
  // 8. avgRiskReward = 1.0
  // 9. winningStreak = 2 (Trade 3 is wins [PARTIAL_TP], Trade 2 is win [FULL_TP], Trade 1 is loss [SL]. Scanning backwards: T3 is win, T2 is win, T1 is loss -> streak is 2)
  // 10. losingStreak = 0 (most recent is win, so losing streak is 0)
  // 11. currentlyOpen = 1 (outcome4 is ACTIVE; outcome5 is PENDING which is not currently open)
  // 12. recsToday = 5
  // 13. closedToday = 3 (outcome1, outcome2, outcome3 updatedAt are today)
  // 14. tradeQualityDistribution: count & percentages:
  //     Excellent: 1 (20.0%), Good: 2 (40.0%), Average: 1 (20.0%), Poor: 1 (20.0%)

  console.log("Calculated metrics:", JSON.stringify(res, null, 2));

  let failed = false;

  if (res.totalRecommendations !== 5) {
    console.error("-> FAIL: totalRecommendations is incorrect:", res.totalRecommendations);
    failed = true;
  }
  if (res.activeTrades !== 2) {
    console.error("-> FAIL: activeTrades is incorrect:", res.activeTrades);
    failed = true;
  }
  if (res.fullTp !== 1) {
    console.error("-> FAIL: fullTp is incorrect:", res.fullTp);
    failed = true;
  }
  if (res.breakEven !== 1) {
    console.error("-> FAIL: breakEven is incorrect:", res.breakEven);
    failed = true;
  }
  if (res.sl !== 1) {
    console.error("-> FAIL: sl is incorrect:", res.sl);
    failed = true;
  }
  if (res.winRate !== 66.7) {
    console.error("-> FAIL: winRate is incorrect:", res.winRate);
    failed = true;
  }
  if (res.winningStreak !== 2) {
    console.error("-> FAIL: winningStreak is incorrect:", res.winningStreak);
    failed = true;
  }
  if (res.losingStreak !== 0) {
    console.error("-> FAIL: losingStreak is incorrect:", res.losingStreak);
    failed = true;
  }
  if (res.currentlyOpen !== 1) {
    console.error("-> FAIL: currentlyOpen is incorrect:", res.currentlyOpen);
    failed = true;
  }
  if (res.recsToday !== 5) {
    console.error("-> FAIL: recsToday is incorrect:", res.recsToday);
    failed = true;
  }
  if (res.closedToday !== 3) {
    console.error("-> FAIL: closedToday is incorrect:", res.closedToday);
    failed = true;
  }
  if (res.tradeQualityDistribution.Good.count !== 2 || res.tradeQualityDistribution.Good.percentage !== 40.0) {
    console.error("-> FAIL: tradeQualityDistribution is incorrect:", JSON.stringify(res.tradeQualityDistribution.Good));
    failed = true;
  }
  if (res.automationReady !== "NO") {
    console.error("-> FAIL: automationReady is incorrect:", res.automationReady);
    failed = true;
  }

  if (failed) {
    console.error("=== AI ANALYTICS TESTS FAILED ===");
    process.exit(1);
  } else {
    console.log("-> PASS: All AI Analytics calculations are correct!");
    console.log("=== AI ANALYTICS TESTS PASSED ===");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
