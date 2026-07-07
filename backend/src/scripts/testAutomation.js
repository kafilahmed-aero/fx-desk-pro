import mongoose from "mongoose";
import { saveNewAiRecommendationOutcome, localAiRecommendationOutcomes } from "../services/signalOutcomeStore.js";
import { updateOutcomePrice } from "../services/signalOutcomeEngine.js";
import { adaptAiToSignalOutcome } from "../services/signalOutcomeStore.js";
import { getSettings, updateSettings } from "../services/automationSettingsService.js";

async function run() {
  console.log("=== RUNNING AUTOMATION CONFIGURATION FOUNDATION TESTS ===");

  // Mock readyState to 0 (offline/memory map fallback)
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 0,
    configurable: true
  });

  const baseT = new Date("2026-07-07T00:00:00Z");

  // ----------------------------------------------------
  // Test 1: Retrieve and Update settings
  // ----------------------------------------------------
  console.log("\n[Test 1] Testing Automation Settings model and service...");
  let s = await getSettings();
  if (
    s.automationEnabled === false &&
    s.maximumOpenTrades === 2 &&
    s.duplicateTradesPerRecommendation === 1 &&
    s.tpMode === "LOW_RISK" &&
    s.fixedLotSize === 0.1 &&
    s.duplicateExecutionMode === undefined // should be deleted
  ) {
    console.log("-> PASS: Retrieved correct defaults.");
  } else {
    console.error("-> FAIL: Default settings incorrect:", s);
    process.exit(1);
  }

  // Update settings
  await updateSettings({
    automationEnabled: true,
    maximumOpenTrades: 5,
    duplicateTradesPerRecommendation: 3,
    tpMode: "MODERATE",
    fixedLotSize: 0.2
  });

  s = await getSettings();
  if (
    s.automationEnabled === true &&
    s.maximumOpenTrades === 5 &&
    s.duplicateTradesPerRecommendation === 3 &&
    s.tpMode === "MODERATE" &&
    s.fixedLotSize === 0.2 &&
    s.duplicateExecutionMode === undefined
  ) {
    console.log("-> PASS: Successfully updated settings.");
  } else {
    console.error("-> FAIL: Settings update did not persist:", s);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Case 1: Open Trades = 2, Maximum = 5, Duplicates = 3
  // ----------------------------------------------------
  console.log("\n[Case 1] Testing Case 1: Open Trades = 2, Maximum = 5, Duplicates = 3 -> ALL THREE execute immediately...");
  localAiRecommendationOutcomes.clear();

  // Seed 2 active trades from other recommendations
  localAiRecommendationOutcomes.set("A1", {
    recommendationId: "A1",
    pair: "XAUUSD",
    direction: "BUY",
    status: "ACTIVE",
    simulatedEntryPrice: 2005,
    executionStatus: "EXECUTED"
  });
  localAiRecommendationOutcomes.set("A2", {
    recommendationId: "A2",
    pair: "XAUUSD",
    direction: "BUY",
    status: "ACTIVE",
    simulatedEntryPrice: 2005,
    executionStatus: "EXECUTED"
  });

  // Settings are max=5, duplicates=3
  await updateSettings({
    maximumOpenTrades: 5,
    duplicateTradesPerRecommendation: 3
  });

  // Create duplicate trades
  await saveNewAiRecommendationOutcome({
    recommendationId: "REC-CASE1",
    pair: "EURUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040
  });

  // Trigger entries for REC-CASE1
  const c1_1 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE1_DUP_1")), 2005, baseT);
  const c1_2 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE1_DUP_2")), 2005, baseT);
  const c1_3 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE1_DUP_3")), 2005, baseT);

  if (
    c1_1.rawAiOutcome.executionStatus === "EXECUTED" && c1_1.rawAiOutcome.status === "ACTIVE" &&
    c1_2.rawAiOutcome.executionStatus === "EXECUTED" && c1_2.rawAiOutcome.status === "ACTIVE" &&
    c1_3.rawAiOutcome.executionStatus === "EXECUTED" && c1_3.rawAiOutcome.status === "ACTIVE"
  ) {
    console.log("-> PASS: ALL THREE duplicate trades executed immediately.");
  } else {
    console.error("-> FAIL: Case 1 execution failed:", c1_1.rawAiOutcome, c1_2.rawAiOutcome, c1_3.rawAiOutcome);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Case 2: Open Trades = 3, Maximum = 5, Duplicates = 3
  // ----------------------------------------------------
  console.log("\n[Case 2] Testing Case 2: Open Trades = 3, Maximum = 5, Duplicates = 3 -> NONE execute...");
  localAiRecommendationOutcomes.clear();

  // Seed 3 active trades
  for (let i = 1; i <= 3; i++) {
    localAiRecommendationOutcomes.set(`A${i}`, {
      recommendationId: `A${i}`,
      pair: "XAUUSD",
      direction: "BUY",
      status: "ACTIVE",
      simulatedEntryPrice: 2005,
      executionStatus: "EXECUTED"
    });
  }

  // Settings: max=5, duplicates=3
  await updateSettings({
    maximumOpenTrades: 5,
    duplicateTradesPerRecommendation: 3
  });

  // Create duplicate trades
  await saveNewAiRecommendationOutcome({
    recommendationId: "REC-CASE2",
    pair: "EURUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040
  });

  // Trigger entries for REC-CASE2
  const c2_1 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE2_DUP_1")), 2005, baseT);
  const c2_2 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE2_DUP_2")), 2005, baseT);
  const c2_3 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE2_DUP_3")), 2005, baseT);

  let blockedCase2Doc = null;
  if (
    c2_1.rawAiOutcome.executionStatus === "BLOCKED" && c2_1.rawAiOutcome.status === "PENDING" &&
    c2_2.rawAiOutcome.executionStatus === "BLOCKED" && c2_2.rawAiOutcome.status === "PENDING" &&
    c2_3.rawAiOutcome.executionStatus === "BLOCKED" && c2_3.rawAiOutcome.status === "PENDING"
  ) {
    blockedCase2Doc = c2_1.rawAiOutcome;
    console.log("-> PASS: NONE executed. The entire recommendation is blocked.");
  } else {
    console.error("-> FAIL: Case 2 check failed:", c2_1.rawAiOutcome, c2_2.rawAiOutcome, c2_3.rawAiOutcome);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Case 3: Open Trades = 4, Maximum = 5, Duplicates = 1
  // ----------------------------------------------------
  console.log("\n[Case 3] Testing Case 3: Open Trades = 4, Maximum = 5, Duplicates = 1 -> Trade executes...");
  localAiRecommendationOutcomes.clear();

  // Seed 4 active trades
  for (let i = 1; i <= 4; i++) {
    localAiRecommendationOutcomes.set(`A${i}`, {
      recommendationId: `A${i}`,
      pair: "XAUUSD",
      direction: "BUY",
      status: "ACTIVE",
      simulatedEntryPrice: 2005,
      executionStatus: "EXECUTED"
    });
  }

  // Settings: max=5, duplicates=1
  await updateSettings({
    maximumOpenTrades: 5,
    duplicateTradesPerRecommendation: 1
  });

  // Create duplicate trades
  await saveNewAiRecommendationOutcome({
    recommendationId: "REC-CASE3",
    pair: "EURUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040
  });

  // Trigger entries for REC-CASE3
  const c3_1 = await updateOutcomePrice(adaptAiToSignalOutcome(localAiRecommendationOutcomes.get("REC-CASE3")), 2005, baseT);

  if (c3_1.rawAiOutcome.executionStatus === "EXECUTED" && c3_1.rawAiOutcome.status === "ACTIVE") {
    console.log("-> PASS: Sibling trade executed successfully.");
  } else {
    console.error("-> FAIL: Case 3 execution failed:", c3_1.rawAiOutcome);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Case 4: No queue, no waiting, no retry logic exists
  // ----------------------------------------------------
  console.log("\n[Case 4] Testing Case 4: Confirming no queueing, waiting, or retry logic exists...");
  
  // Re-run Case 2 block check and assert properties
  const blockedDoc = blockedCase2Doc;
  if (
    blockedDoc && 
    blockedDoc.executionStatus === "BLOCKED" && 
    blockedDoc.status === "PENDING" && 
    blockedDoc.blockReason === "MAX_OPEN_TRADES" &&
    blockedDoc.queueTimer === undefined &&
    blockedDoc.retryCount === undefined
  ) {
    console.log("-> PASS: Blocked immediately with no retry, delay, or queuing fields.");
  } else {
    console.error("-> FAIL: Queue or waiting logic detected on blocked document:", blockedDoc);
    process.exit(1);
  }

  // ----------------------------------------------------
  // Test 5: TP Target Mode
  // ----------------------------------------------------
  console.log("\n[Test 5] Testing automationTpMode target assertion...");
  
  // Set TP Mode to MODERATE
  await updateSettings({
    tpMode: "MODERATE"
  });

  const adaptedMod = adaptAiToSignalOutcome({
    recommendationId: "REC-M",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    lowRiskTp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    status: "ACTIVE"
  });

  // targets should contain ONLY TP2 (moderateTp = 2030)
  if (adaptedMod.targets.length === 1 && adaptedMod.targets[0].price === 2030 && adaptedMod.targets[0].targetNumber === 2) {
    console.log("-> PASS: MODERATE mode successfully isolated to single TP2 target.");
  } else {
    console.error("-> FAIL: MODERATE mode target assertion incorrect:", adaptedMod.targets);
    process.exit(1);
  }

  // Set TP Mode to HIGH_RISK
  await updateSettings({
    tpMode: "HIGH_RISK"
  });

  const adaptedHigh = adaptAiToSignalOutcome({
    recommendationId: "REC-H",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    lowRiskTp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    status: "ACTIVE"
  });

  // targets should contain ONLY TP3 (highRiskTp = 2040)
  if (adaptedHigh.targets.length === 1 && adaptedHigh.targets[0].price === 2040 && adaptedHigh.targets[0].targetNumber === 3) {
    console.log("-> PASS: HIGH_RISK mode successfully isolated to single TP3 target.");
  } else {
    console.error("-> FAIL: HIGH_RISK mode target assertion incorrect:", adaptedHigh.targets);
    process.exit(1);
  }

  console.log("\n=== ALL AUTOMATION TESTS PASSED ===");
  process.exit(0);
}

run().catch(err => {
  console.error("Test suite execution failed:", err);
  process.exit(1);
});
