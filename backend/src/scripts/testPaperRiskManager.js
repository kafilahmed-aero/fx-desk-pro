import mongoose from "mongoose";
import { saveNewAiRecommendationOutcome, localAiRecommendationOutcomes } from "../services/signalOutcomeStore.js";
import { updateOutcomePrice } from "../services/signalOutcomeEngine.js";
import { getAiAnalytics } from "../services/aiAnalyticsService.js";
import { adaptAiToSignalOutcome } from "../services/signalOutcomeStore.js";
import { config } from "../config/env.js";
import { updateConfig } from "../config/systemConfigManager.js";

async function run() {
  console.log("=== RUNNING PAPER TRADING RISK MANAGER UNIT TESTS ===");

  // Mock readyState to 0 (offline/memory map fallback)
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 0,
    configurable: true
  });

  // Config custom limits for robust deterministic testing:
  updateConfig({
    paperRisk: {
      maxOpenTrades: 2,
      maxDailyTrades: 4,
      maxConsecutiveLosses: 2,
      dailyLossLimitR: 3,
      dailyProfitTargetR: 6,
      slCooldownMinutes: 10
    }
  });

  const baseT = new Date("2026-07-07T00:00:00Z");

  // ----------------------------------------------------
  // Test 1: Initial state & Planned Risk
  // ----------------------------------------------------
  console.log("\n[Test 1] Testing initial state, executionStatus, and plannedRiskR persistence...");
  localAiRecommendationOutcomes.clear();
  
  await saveNewAiRecommendationOutcome({
    recommendationId: "REC-A",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    tradeQuality: "Good",
    confidence: 80,
    confluenceScore: 70,
    tradeFilter: "ALLOW",
    overallConfluence: 70,
    estimatedHoldingTime: "30-60 min",
    tradeStyle: "Intraday",
    triggerSource: "MANUAL",
    generationTimeMs: 100
  });

  const recA = localAiRecommendationOutcomes.get("REC-A");
  if (
    recA &&
    recA.executionStatus === "WAITING" &&
    recA.plannedRiskR === 1 &&
    recA.blockedAt === null &&
    recA.blockReason === null
  ) {
    console.log("-> PASS: Correctly initialized recommendation waiting state.");
  } else {
    console.error("-> FAIL: WAITING initialization incorrect:", recA);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 2: Execution Status on Entry
  // ----------------------------------------------------
  console.log("\n[Test 2] Testing executionStatus transition to EXECUTED on entry trigger...");
  const adaptedA = adaptAiToSignalOutcome(recA);
  const updatedA = await updateOutcomePrice(adaptedA, 2005, baseT);
  const rawA = updatedA.rawAiOutcome;

  if (
    rawA.executionStatus === "EXECUTED" &&
    rawA.status === "ACTIVE" &&
    rawA.simulationNotes.includes("Trade allowed") &&
    rawA.simulationNotes.includes("Entry triggered")
  ) {
    console.log("-> PASS: Correctly transitioned executionStatus to EXECUTED.");
  } else {
    console.error("-> FAIL: EXECUTED transition incorrect:", rawA);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 3: Expiration before execution
  // ----------------------------------------------------
  console.log("\n[Test 3] Testing executionStatus transition to EXPIRED on recommendation expiration...");
  localAiRecommendationOutcomes.clear();
  await saveNewAiRecommendationOutcome({
    recommendationId: "REC-B",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    tradeQuality: "Good",
    confidence: 80,
    expiresAt: new Date(baseT.getTime() + 1000)
  });

  const recB = localAiRecommendationOutcomes.get("REC-B");
  recB.expiresAt = new Date(baseT.getTime() + 1000);
  localAiRecommendationOutcomes.set("REC-B", recB);
  
  const adaptedB = adaptAiToSignalOutcome(recB);
  
  // Update outcome at time after expiration
  const expiredT = new Date(baseT.getTime() + 5000);
  const updatedBResult = await updateOutcomePrice(adaptedB, 2005, expiredT);
  const rawB = updatedBResult.rawAiOutcome;

  if (
    rawB.status === "EXPIRED" &&
    rawB.executionStatus === "EXPIRED" &&
    rawB.simulationNotes.includes("Trade expired")
  ) {
    console.log("-> PASS: Correctly transitioned executionStatus to EXPIRED.");
  } else {
    console.error("-> FAIL: EXPIRED transition incorrect:", rawB);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 4: Maximum Open Trades limit (Limit is 2)
  // ----------------------------------------------------
  console.log("\n[Test 4] Testing Maximum Open Trades limit block...");
  localAiRecommendationOutcomes.clear();

  localAiRecommendationOutcomes.set("T1", {
    recommendationId: "T1",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });

  localAiRecommendationOutcomes.set("T2", {
    recommendationId: "T2",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });

  localAiRecommendationOutcomes.set("T3", {
    recommendationId: "T3",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });

  const a1 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("T1")), 2005, baseT);
  const a2 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("T2")), 2005, baseT);
  const blockedT3 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("T3")), 2005, baseT);
  const rawT3 = blockedT3.rawAiOutcome;

  if (
    rawT3.status === "PENDING" &&
    rawT3.executionStatus === "BLOCKED" &&
    rawT3.blockReason === "MAX_OPEN_TRADES" &&
    rawT3.blockedAt.getTime() === baseT.getTime() &&
    rawT3.simulationNotes.includes("Trade blocked: Maximum Open Trades")
  ) {
    console.log("-> PASS: Correctly blocked third trade with MAX_OPEN_TRADES reason and blockedAt timestamp.");
  } else {
    console.error("-> FAIL: MAX_OPEN_TRADES block incorrect:", rawT3);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 5: Cooldown After SL (Cooldown is 10 minutes)
  // ----------------------------------------------------
  console.log("\n[Test 5] Testing Cooldown Active block after Stop Loss hit...");
  // Clear open trades by hitting stop loss on T1
  const t1_closed = await updateOutcomePrice(a1, 1985, new Date(baseT.getTime() + 60000)); // closed at SL
  
  localAiRecommendationOutcomes.set("T4", {
    recommendationId: "T4",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });
  
  const cooldownT = new Date(baseT.getTime() + 5 * 60 * 1000); // 5 mins later (cooldown active)
  const blockedT4 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("T4")), 2005, cooldownT);
  const rawT4 = blockedT4.rawAiOutcome;

  if (
    rawT4.status === "PENDING" &&
    rawT4.executionStatus === "BLOCKED" &&
    rawT4.blockReason === "COOLDOWN_ACTIVE" &&
    rawT4.simulationNotes.includes("Trade blocked: Cooldown Active")
  ) {
    console.log("-> PASS: Correctly blocked trade due to active Cooldown After SL.");
  } else {
    console.error("-> FAIL: COOLDOWN_ACTIVE block incorrect:", rawT4);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 6: Maximum Consecutive Losses (Limit is 2)
  // ----------------------------------------------------
  console.log("\n[Test 6] Testing Consecutive Losses block...");
  localAiRecommendationOutcomes.clear();
  
  localAiRecommendationOutcomes.set("L1", {
    recommendationId: "L1",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });
  const l1_act = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("L1")), 2005, baseT);
  await updateOutcomePrice(l1_act, 1985, new Date(baseT.getTime() + 60000)); // Loss 1
  
  // Close L2 at SL (make sure to bypass SL cooldown by setting time 15 minutes later)
  const baseT2 = new Date(baseT.getTime() + 15 * 60 * 1000);
  localAiRecommendationOutcomes.set("L2", {
    recommendationId: "L2",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });
  const l2_act = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("L2")), 2005, baseT2);
  await updateOutcomePrice(l2_act, 1985, new Date(baseT2.getTime() + 60000)); // Loss 2

  // Try L3 after L2 (consecutive losses = 2, cooldown bypassed)
  const baseT3 = new Date(baseT2.getTime() + 15 * 60 * 1000);
  localAiRecommendationOutcomes.set("L3", {
    recommendationId: "L3",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });
  const blockedL3 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("L3")), 2005, baseT3);
  const rawL3 = blockedL3.rawAiOutcome;

  if (
    rawL3.status === "PENDING" &&
    rawL3.executionStatus === "BLOCKED" &&
    rawL3.blockReason === "MAX_CONSECUTIVE_LOSSES" &&
    rawL3.simulationNotes.includes("Trade blocked: Maximum Consecutive Losses")
  ) {
    console.log("-> PASS: Correctly blocked third trade due to Maximum Consecutive Losses.");
  } else {
    console.error("-> FAIL: MAX_CONSECUTIVE_LOSSES block incorrect:", rawL3);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 7: Daily Loss Limit (Daily Limit is 3R)
  // ----------------------------------------------------
  console.log("\n[Test 7] Testing Daily Loss Limit block...");
  localAiRecommendationOutcomes.clear();

  localAiRecommendationOutcomes.set("R1", {
    recommendationId: "R1",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: [],
    plannedRiskR: 1
  });
  const r1_act = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("R1")), 2005, baseT);
  await updateOutcomePrice(r1_act, 1985, new Date(baseT.getTime() + 60000));

  // Close R2 at SL with plannedRiskR = 2.0 -> loses 2R. Total loss is 3R.
  const r2_time = new Date(baseT.getTime() + 15 * 60 * 1000);
  localAiRecommendationOutcomes.set("R2", {
    recommendationId: "R2",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: [],
    plannedRiskR: 2
  });
  const r2_act = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("R2")), 2005, r2_time);
  await updateOutcomePrice(r2_act, 1985, new Date(r2_time.getTime() + 60000));

  // Try R3 (loss limit is 3R, which is met).
  const r3_time = new Date(r2_time.getTime() + 15 * 60 * 1000);
  localAiRecommendationOutcomes.set("R3", {
    recommendationId: "R3",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    status: "PENDING",
    executionStatus: "WAITING",
    simulationMode: "PAPER",
    simulationNotes: []
  });
  const blockedR3 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("R3")), 2005, r3_time);
  const rawR3 = blockedR3.rawAiOutcome;

  if (
    rawR3.status === "PENDING" &&
    rawR3.executionStatus === "BLOCKED" &&
    rawR3.blockReason === "DAILY_LIMIT_REACHED" &&
    rawR3.simulationNotes.includes("Trade blocked: Daily Limit Reached")
  ) {
    console.log("-> PASS: Correctly blocked trade due to Daily Loss Limit reached.");
  } else {
    console.error("-> FAIL: Daily Loss Limit block incorrect:", rawR3);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 8: Risk Analytics Calculations
  // ----------------------------------------------------
  console.log("\n[Test 8] Testing risk analytics metrics calculations...");
  localAiRecommendationOutcomes.clear();
  
  localAiRecommendationOutcomes.set("A1", {
    recommendationId: "A1",
    direction: "BUY",
    pair: "XAUUSD",
    status: "FULL_TP",
    simulatedEntryPrice: 2000,
    simulatedEntryTime: baseT,
    sl: 1990,
    outcomePrice: 2020,
    outcomeTime: new Date(baseT.getTime() + 60 * 60 * 1000),
    executionStatus: "EXECUTED"
  });

  localAiRecommendationOutcomes.set("A2", {
    recommendationId: "A2",
    direction: "SELL",
    pair: "XAUUSD",
    status: "SL",
    simulatedEntryPrice: 2000,
    simulatedEntryTime: baseT,
    sl: 2010,
    outcomePrice: 2010,
    outcomeTime: new Date(baseT.getTime() + 60 * 60 * 1000),
    executionStatus: "EXECUTED"
  });

  localAiRecommendationOutcomes.set("A3", {
    recommendationId: "A3",
    direction: "BUY",
    pair: "XAUUSD",
    status: "PENDING",
    executionStatus: "BLOCKED",
    blockReason: "MAX_OPEN_TRADES"
  });

  localAiRecommendationOutcomes.set("A4", {
    recommendationId: "A4",
    direction: "BUY",
    pair: "XAUUSD",
    status: "PENDING",
    executionStatus: "BLOCKED",
    blockReason: "COOLDOWN_ACTIVE"
  });

  const stats = await getAiAnalytics();
  console.log("Calculated risk analytics:", JSON.stringify(stats, null, 2));

  if (
    stats.blockedTrades === 2 &&
    stats.blockedReasonDistribution["Maximum Open Trades"] === 1 &&
    stats.blockedReasonDistribution["Cooldown Active"] === 1 &&
    stats.avgDailyTrades === 2.0 &&
    stats.avgOpenTrades === 2.0 &&
    stats.avgDailyRiskUsed === 20.00
  ) {
    console.log("-> PASS: Risk analytics metrics successfully calculated.");
  } else {
    console.error("-> FAIL: Risk analytics metrics calculations incorrect.");
    process.exit(1);
  }

  console.log("\n=== ALL PAPER TRADING RISK MANAGER TESTS PASSED ===");
  process.exit(0);
}

run().catch(err => {
  console.error("Test suite execution failed:", err);
  process.exit(1);
});
