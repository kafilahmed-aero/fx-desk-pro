import mongoose from "mongoose";
import { saveNewAiRecommendationOutcome, localAiRecommendationOutcomes } from "../services/signalOutcomeStore.js";
import { updateOutcomePrice } from "../services/signalOutcomeEngine.js";
import { getAiAnalytics } from "../services/aiAnalyticsService.js";
import { adaptAiToSignalOutcome } from "../services/signalOutcomeStore.js";

async function run() {
  console.log("=== RUNNING PAPER TRADING / SIMULATION ENGINE UNIT TESTS ===");

  // Mock readyState to 0 (offline/memory map fallback)
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 0,
    configurable: true
  });

  // Clear local outcomes
  localAiRecommendationOutcomes.clear();

  // Test 1: Save new AI recommendation (PENDING)
  console.log("\n[Test 1] Testing initial paper trade creation...");
  const mockRec = {
    recommendationId: "AI-TEST-001",
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000,
    entryMax: 2010,
    sl: 1990,
    tp: 2020,
    moderateTp: 2030,
    highRiskTp: 2040,
    tradeQuality: "Excellent",
    confidence: 90,
    confluenceScore: 85,
    tradeFilter: "ALLOW",
    overallConfluence: 85,
    estimatedHoldingTime: "30-60 min",
    tradeStyle: "Intraday",
    triggerSource: "MANUAL",
    generationTimeMs: 150
  };

  await saveNewAiRecommendationOutcome(mockRec);

  const saved = localAiRecommendationOutcomes.get("AI-TEST-001");
  if (
    saved &&
    saved.status === "PENDING" &&
    saved.simulationMode === "PAPER" &&
    saved.aiSnapshot.confidence === 90 &&
    saved.aiSnapshot.tradeQuality === "Excellent" &&
    saved.aiSnapshot.confluenceScore === 85 &&
    saved.aiSnapshot.tradeFilter === "ALLOW" &&
    saved.aiSnapshot.overallConfluence === 85 &&
    saved.triggerSource === "MANUAL" &&
    Array.isArray(saved.simulationNotes) &&
    saved.simulationNotes.length === 0
  ) {
    console.log("-> PASS: Correctly initialized paper trade with simulationMode, aiSnapshot, triggerSource, and notes.");
  } else {
    console.error("-> FAIL: Initialized paper trade incorrectly:", saved);
    process.exit(1);
  }

  // Test 2: PENDING -> ACTIVE transition
  console.log("\n[Test 2] Testing PENDING -> ACTIVE transition on entry range trigger...");
  const adapted = adaptAiToSignalOutcome(saved);
  const timeActive = new Date();
  
  // Update price inside entry range (2005)
  const updatedActive = await updateOutcomePrice(adapted, 2005, timeActive);
  const rawActive = updatedActive.rawAiOutcome;

  if (
    rawActive.status === "ACTIVE" &&
    rawActive.simulatedEntryPrice === 2005 &&
    rawActive.simulatedEntryTime.getTime() === timeActive.getTime() &&
    rawActive.simulatedSL === 1990 &&
    rawActive.simulationNotes.includes("Entry triggered")
  ) {
    console.log("-> PASS: Transitioned to ACTIVE and recorded entry price, time, SL, and notes.");
  } else {
    console.error("-> FAIL: Active transition incorrect:", rawActive);
    process.exit(1);
  }

  // Test 3: ACTIVE -> PARTIAL_TP (TP1 hit) and move stop to breakeven
  console.log("\n[Test 3] Testing TP1 hit, status transition to PARTIAL_TP, and SL moved to Entry...");
  const timeTp1 = new Date(timeActive.getTime() + 10000);
  const updatedTp1 = await updateOutcomePrice(updatedActive, 2025, timeTp1);
  const rawTp1 = updatedTp1.rawAiOutcome;

  if (
    rawTp1.status === "PARTIAL_TP" &&
    rawTp1.simulatedSL === 2005 && // moved to simulatedEntryPrice (2005)
    updatedTp1.stopLoss === 2005 && // mapped stopLoss updated as well
    rawTp1.simulationNotes.includes("TP1 reached") &&
    rawTp1.simulationNotes.includes("Stop moved to breakeven")
  ) {
    console.log("-> PASS: Correctly transitioned to PARTIAL_TP, updated simulated SL to entry, and appended notes.");
  } else {
    console.error("-> FAIL: TP1 transition incorrect:", rawTp1);
    process.exit(1);
  }

  // Test 4: PARTIAL_TP -> BREAK_EVEN (price retraces to entry)
  console.log("\n[Test 4] Testing Break-even closure when price returns to entry...");
  const timeBe = new Date(timeTp1.getTime() + 10000);
  const updatedBe = await updateOutcomePrice(updatedTp1, 2005, timeBe);
  const rawBe = updatedBe.rawAiOutcome;

  if (
    rawBe.status === "BREAK_EVEN" &&
    rawBe.exitType === "BREAK_EVEN" &&
    rawBe.closedAtBreakEven === true &&
    rawBe.outcomePrice === 2005 &&
    rawBe.outcomeTime.getTime() === timeBe.getTime() &&
    rawBe.simulationNotes.includes("Closed at breakeven")
  ) {
    console.log("-> PASS: Correctly closed trade at BREAK_EVEN with exitType and exit logs.");
  } else {
    console.error("-> FAIL: Break-even closure incorrect:", rawBe);
    process.exit(1);
  }

  // Test 5: TP2, TP3 progression to FULL_TP
  console.log("\n[Test 5] Testing target progression to FULL_TP...");
  localAiRecommendationOutcomes.clear();
  await saveNewAiRecommendationOutcome({
    ...mockRec,
    recommendationId: "AI-TEST-002"
  });
  
  const saved2 = localAiRecommendationOutcomes.get("AI-TEST-002");
  const adapted2 = adaptAiToSignalOutcome(saved2);
  
  // Trigger entry
  const act2 = await updateOutcomePrice(adapted2, 2005, timeActive);
  // Hit TP1
  const tp1_2 = await updateOutcomePrice(act2, 2025, timeTp1);
  // Hit TP3 (2045) -> FULL_TP
  const timeTp3 = new Date(timeTp1.getTime() + 15000);
  const fullTp = await updateOutcomePrice(tp1_2, 2045, timeTp3);
  const rawFull = fullTp.rawAiOutcome;

  if (
    rawFull.status === "FULL_TP" &&
    rawFull.exitType === "TP" &&
    rawFull.outcomePrice === 2045 &&
    rawFull.outcomeTime.getTime() === timeTp3.getTime() &&
    rawFull.simulationNotes.includes("Closed at TP3")
  ) {
    console.log("-> PASS: Target progression completed to FULL_TP successfully.");
  } else {
    console.error("-> FAIL: FULL_TP progression incorrect:", rawFull);
    process.exit(1);
  }

  // Test 6: Standard SL hit before TP1
  console.log("\n[Test 6] Testing standard SL hit before TP1 is reached...");
  localAiRecommendationOutcomes.clear();
  await saveNewAiRecommendationOutcome({
    ...mockRec,
    recommendationId: "AI-TEST-003"
  });
  const saved3 = localAiRecommendationOutcomes.get("AI-TEST-003");
  const adapted3 = adaptAiToSignalOutcome(saved3);
  
  // Trigger entry
  const act3 = await updateOutcomePrice(adapted3, 2005, timeActive);
  // Hit SL (1985)
  const timeSl = new Date(timeActive.getTime() + 5000);
  const slHit = await updateOutcomePrice(act3, 1985, timeSl);
  const rawSl = slHit.rawAiOutcome;

  if (
    rawSl.status === "SL" &&
    rawSl.exitType === "SL" &&
    rawSl.outcomePrice === 1985 &&
    rawSl.outcomeTime.getTime() === timeSl.getTime() &&
    rawSl.simulationNotes.includes("Closed at SL")
  ) {
    console.log("-> PASS: Standard SL hit resolved successfully.");
  } else {
    console.error("-> FAIL: Standard SL resolution incorrect:", rawSl);
    process.exit(1);
  }

  // Test 7: Trade Expiry
  console.log("\n[Test 7] Testing simulated trade expiry...");
  localAiRecommendationOutcomes.clear();
  await saveNewAiRecommendationOutcome({
    ...mockRec,
    recommendationId: "AI-TEST-004"
  });
  const saved4 = localAiRecommendationOutcomes.get("AI-TEST-004");
  const adapted4 = adaptAiToSignalOutcome(saved4);
  
  // Trigger entry
  const act4 = await updateOutcomePrice(adapted4, 2005, timeActive);
  // Trigger expiration
  const expiredTime = new Date(timeActive.getTime() + 48 * 60 * 60 * 1000); // 48 hours later
  const expRes = await updateOutcomePrice(act4, 2015, expiredTime);
  const rawExp = expRes.rawAiOutcome;

  if (
    rawExp.status === "EXPIRED" &&
    rawExp.outcomePrice === 2015 &&
    rawExp.outcomeTime.getTime() === expiredTime.getTime() &&
    rawExp.simulationNotes.includes("Trade expired")
  ) {
    console.log("-> PASS: Simulated trade expired successfully.");
  } else {
    console.error("-> FAIL: simulated trade expiry incorrect:", rawExp);
    process.exit(1);
  }

  // Test 8: Superseded Trade
  console.log("\n[Test 8] Testing superseding recommendations...");
  localAiRecommendationOutcomes.clear();
  await saveNewAiRecommendationOutcome({
    ...mockRec,
    recommendationId: "AI-TEST-005"
  });
  
  // Create another recommendation with opposite direction (SELL) to supersede the active one
  await saveNewAiRecommendationOutcome({
    ...mockRec,
    recommendationId: "AI-TEST-006",
    direction: "SELL"
  });

  const superRec = localAiRecommendationOutcomes.get("AI-TEST-005");
  if (superRec && superRec.status === "SUPERSEDED" && superRec.simulationNotes.includes("Superseded")) {
    console.log("-> PASS: Recommendation successfully superseded with simulation notes logged.");
  } else {
    console.error("-> FAIL: Recommendation not superseded correctly:", superRec);
    process.exit(1);
  }

  // Test 9: Analytics Calculations
  console.log("\n[Test 9] Testing paper trading simulation analytics calculations...");
  // Clear and seed specific mock outcomes:
  // Trade 1: Buy XAUUSD, entry 2000, exit at TP3 (2030) -> WIN. Hold time: 60 mins. PnL: +30
  // Trade 2: Sell XAUUSD, entry 2000, exit at SL (2010) -> LOSS. Hold time: 60 mins. PnL: -10
  // Trade 3: Buy XAUUSD, entry 2000, exit at BE (2000) -> BE. Hold time: 30 mins. PnL: 0
  // Trade 4: Buy XAUUSD, entry 2000, still ACTIVE -> open.
  localAiRecommendationOutcomes.clear();
  
  const baseT = new Date("2026-07-07T00:00:00Z");

  localAiRecommendationOutcomes.set("AI-SIM-001", {
    recommendationId: "AI-SIM-001",
    direction: "BUY",
    pair: "XAUUSD",
    status: "FULL_TP",
    simulatedEntryPrice: 2000,
    simulatedEntryTime: baseT,
    outcomePrice: 2030,
    outcomeTime: new Date(baseT.getTime() + 60 * 60 * 1000), // 60 mins
    exitType: "TP"
  });

  localAiRecommendationOutcomes.set("AI-SIM-002", {
    recommendationId: "AI-SIM-002",
    direction: "SELL",
    pair: "XAUUSD",
    status: "SL",
    simulatedEntryPrice: 2000,
    simulatedEntryTime: baseT,
    outcomePrice: 2010,
    outcomeTime: new Date(baseT.getTime() + 60 * 60 * 1000), // 60 mins
    exitType: "SL"
  });

  localAiRecommendationOutcomes.set("AI-SIM-003", {
    recommendationId: "AI-SIM-003",
    direction: "BUY",
    pair: "XAUUSD",
    status: "BREAK_EVEN",
    simulatedEntryPrice: 2000,
    simulatedEntryTime: baseT,
    outcomePrice: 2000,
    outcomeTime: new Date(baseT.getTime() + 30 * 60 * 1000), // 30 mins
    exitType: "BREAK_EVEN",
    closedAtBreakEven: true
  });

  localAiRecommendationOutcomes.set("AI-SIM-004", {
    recommendationId: "AI-SIM-004",
    direction: "BUY",
    pair: "XAUUSD",
    status: "ACTIVE",
    simulatedEntryPrice: 2000,
    simulatedEntryTime: baseT
  });

  const stats = await getAiAnalytics();
  console.log("Calculated simulated analytics:", JSON.stringify(stats, null, 2));

  if (
    stats.simulationTrades === 4 &&
    stats.simulationWins === 1 &&
    stats.simulationLosses === 1 &&
    stats.simulationBreakEven === 1 &&
    stats.simulationWinRate === 50.0 && // wins / (wins + losses) * 100 = 1 / (1 + 1) * 100 = 50%
    stats.simulationProfitFactor === 3.00 && // Gross Profit (30) / Gross Loss (10) = 3.00
    stats.simulationAverageHoldingTime === "50 min" && // (60 + 60 + 30) / 3 = 150 / 3 = 50 min
    stats.simulationCurrentOpenTrades === 1 &&
    stats.simulationMaxDrawdown === 10.00 && // starts 10000 -> 10000 -> 10030 -> 10020. Peak 10030, dd = 10.00
    JSON.stringify(stats.simulationEquityCurve) === "[10000,10000,10030,10020]"
  ) {
    console.log("-> PASS: Simulated trade analytics metrics are mathematically accurate.");
  } else {
    console.error("-> FAIL: Simulated trade analytics incorrect.");
    process.exit(1);
  }

  console.log("\n=== ALL PAPER TRADING / SIMULATION TESTS PASSED ===");
  process.exit(0);
}

run().catch(err => {
  console.error("Test suite execution failed:", err);
  process.exit(1);
});
