import mongoose from "mongoose";
import { resetOutcomeStore, getOutcomeByMessageKey, getOutcomes } from "../services/signalOutcomeStore.js";
import { resetPriceCache, fetchPrices, getCurrentPrice } from "../services/priceIngestionService.js";
import { initializeOutcome, updateOutcomePrice, processSignalUpdate } from "../services/signalOutcomeEngine.js";
import { runMonitoringCycle } from "../services/priceMonitoringScheduler.js";
import { logger } from "../utils/logger.js";
import { storeParsedSignal } from "../services/parsedSignalStore.js";
import { getPairState, resetPairStateStore } from "../services/pairStateEngine.js";


// Force quiet logging for clean test output
logger.level = "warn";

async function runTests() {
  console.log("=== STARTING SIGNAL OUTCOME TRACKING TESTS ===");
  
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    if (condition) {
      passedTests++;
      console.log(`[PASS] ${message}`);
    } else {
      failedTests++;
      console.error(`[FAIL] ${message}`);
    }
  }

  // Helper mock signal builder
  function buildMockSignal(overrides = {}) {
    return {
      _id: overrides._id || new mongoose.Types.ObjectId(),
      channel: overrides.channel || "GoldTradePrecision1",
      messageId: overrides.messageId || Math.floor(Math.random() * 10000),
      pair: overrides.pair || "XAUUSD",
      action: overrides.action || "BUY",
      entry: overrides.entry !== undefined ? overrides.entry : 2000,
      entryRange: overrides.entryRange || [],
      targets: overrides.targets !== undefined ? overrides.targets : [2010, 2020, 2030],
      pipTargets: overrides.pipTargets || [],
      stopLoss: overrides.stopLoss !== undefined ? overrides.stopLoss : 1990,
      classification: overrides.classification || "NEW_SIGNAL",
      parserClassification: overrides.parserClassification || "NEW_SIGNAL",
      createdAt: overrides.createdAt || new Date(),
    };
  }

  // TEST 1: Outcome Initialization
  try {
    resetOutcomeStore();
    const sig = buildMockSignal({ pair: "XAUUSD", action: "BUY", entryRange: [1995, 2005] });
    const outcome = await initializeOutcome(sig);
    
    assert(outcome !== null, "Signal outcome initialized successfully");
    assert(outcome.status === "PENDING", "Initial status is PENDING");
    assert(outcome.entry.entryType === "RANGE", "Entry type is RANGE");
    assert(outcome.entry.entryLow === 1995 && outcome.entry.entryHigh === 2005, "Entry range boundaries mapped correctly");
    assert(outcome.targets.length === 3, "All targets mapped correctly");
    assert(outcome.targets[0].targetNumber === 1 && outcome.targets[0].price === 2010, "Target 1 price is correct");
    assert(outcome.stopLoss === 1990, "Stop loss is set correctly");
    
    const diffHours = Math.round((new Date(outcome.expiresAt) - new Date(outcome.createdAt)) / (1000 * 60 * 60));
    assert(diffHours === 72, "Default expiration is set to 72 hours");
  } catch (err) {
    console.error("Test 1 Failed with error:", err);
    failedTests++;
  }

  // TEST 2: Price-based PENDING -> ACTIVE -> PARTIAL_TP -> FULL_TP
  try {
    resetOutcomeStore();
    const sig = buildMockSignal({ pair: "XAUUSD", action: "BUY", entryRange: [1995, 2005], targets: [2010, 2020] });
    let outcome = await initializeOutcome(sig);

    // Initial state: PENDING
    // Price outside entry
    outcome = await updateOutcomePrice(outcome, 2015, new Date());
    assert(outcome.status === "PENDING", "Status remains PENDING when price is outside range");

    // Price enters range -> ACTIVE
    outcome = await updateOutcomePrice(outcome, 2000, new Date());
    assert(outcome.status === "ACTIVE", "Status transitions to ACTIVE when price enters range");
    
    // Test Peak Tracker
    assert(outcome.highestPriceSeen === 2000, "highestPriceSeen is initialized");
    assert(outcome.lowestPriceSeen === 2000, "lowestPriceSeen is initialized");

    // Price swings
    outcome = await updateOutcomePrice(outcome, 1998, new Date());
    outcome = await updateOutcomePrice(outcome, 2008, new Date());
    assert(outcome.highestPriceSeen === 2008, "highestPriceSeen tracks highest price correctly");
    assert(outcome.lowestPriceSeen === 1998, "lowestPriceSeen tracks lowest price correctly");

    // Hit Target 1 -> PARTIAL_TP
    outcome = await updateOutcomePrice(outcome, 2012, new Date());
    assert(outcome.status === "PARTIAL_TP", "Status transitions to PARTIAL_TP when Target 1 is hit");
    assert(outcome.hitTargets.includes(1), "Target 1 is logged as hit");
    assert(outcome.maxTargetHit === 1, "maxTargetHit is 1");
    assert(outcome.outcomeReason === "PRICE_MONITOR", "outcomeReason is PRICE_MONITOR");

    // Hit Target 2 -> FULL_TP
    outcome = await updateOutcomePrice(outcome, 2022, new Date());
    assert(outcome.status === "FULL_TP", "Status transitions to FULL_TP when all targets are hit");
    assert(outcome.hitTargets.includes(2), "Target 2 is logged as hit");
    assert(outcome.maxTargetHit === 2, "maxTargetHit is 2");
  } catch (err) {
    console.error("Test 2 Failed with error:", err);
    failedTests++;
  }

  // TEST 3: Stop Loss Hit (SL_HIT)
  try {
    resetOutcomeStore();
    const sig = buildMockSignal({ pair: "EURUSD", action: "BUY", entry: 1.0800, stopLoss: 1.0750 });
    let outcome = await initializeOutcome(sig);

    // Trigger Entry -> ACTIVE
    outcome = await updateOutcomePrice(outcome, 1.0800, new Date());
    assert(outcome.status === "ACTIVE", "Status is ACTIVE at entry price");

    // Breach Stop Loss -> SL_HIT
    outcome = await updateOutcomePrice(outcome, 1.0745, new Date());
    assert(outcome.status === "SL_HIT", "Status transitions to SL_HIT when price breaches stop loss");
    assert(outcome.outcomePrice === 1.0745, "outcomePrice is set to the breached price");
    assert(outcome.outcomeReason === "PRICE_MONITOR", "outcomeReason is PRICE_MONITOR");
  } catch (err) {
    console.error("Test 3 Failed with error:", err);
    failedTests++;
  }

  // TEST 4: Sell Order Execution
  try {
    resetOutcomeStore();
    // SELL signal triggers ACTIVE when price rise/equals entry price
    const sig = buildMockSignal({ pair: "GBPUSD", action: "SELL", entry: 1.2500, stopLoss: 1.2600, targets: [1.2400] });
    let outcome = await initializeOutcome(sig);

    // Under entry -> PENDING
    outcome = await updateOutcomePrice(outcome, 1.2450, new Date());
    assert(outcome.status === "PENDING", "SELL signal remains PENDING when price is below entry");

    // Touch entry -> ACTIVE
    outcome = await updateOutcomePrice(outcome, 1.2510, new Date());
    assert(outcome.status === "ACTIVE", "SELL signal transitions to ACTIVE when price touches or rises past entry");

    // Touch Stop Loss -> SL_HIT (price rises above stopLoss)
    outcome = await updateOutcomePrice(outcome, 1.2605, new Date());
    assert(outcome.status === "SL_HIT", "SELL signal transitions to SL_HIT when price rises above stopLoss");
  } catch (err) {
    console.error("Test 4 Failed with error:", err);
    failedTests++;
  }

  // TEST 5: Expiration Handling
  try {
    resetOutcomeStore();
    const sig = buildMockSignal();
    let outcome = await initializeOutcome(sig);

    // Emulate expiration time in the past
    outcome.expiresAt = new Date(Date.now() - 1000); // 1 second ago
    
    // Evaluate price tick -> EXPIRED
    outcome = await updateOutcomePrice(outcome, 2000, new Date());
    assert(outcome.status === "EXPIRED", "Outcome transitions to EXPIRED when current time exceeds expiresAt");
    assert(outcome.outcomeReason === "PRICE_MONITOR", "outcomeReason is PRICE_MONITOR for expiration");
  } catch (err) {
    console.error("Test 5 Failed with error:", err);
    failedTests++;
  }

  // TEST 6: Manual Channel Result Overrides
  try {
    resetOutcomeStore();
    const sig = buildMockSignal({ pair: "XAUUSD", messageId: 500, targets: [2010, 2020] });
    await initializeOutcome(sig);

    // Send update signal corresponding to message 500
    const updateSignal = {
      channel: "GoldTradePrecision1",
      messageId: 501,
      pair: "XAUUSD",
      classification: "RESULT_SIGNAL",
      parserClassification: "RESULT_SIGNAL",
      resultAction: {
        type: "TARGET_HIT",
        targetIndex: 0, // Target 1
        hitPrice: 2012,
      },
      createdAt: new Date(),
    };

    const updated = await processSignalUpdate(updateSignal);
    assert(updated !== null, "Outcome updated via channel result successfully");
    assert(updated.status === "PARTIAL_TP", "Manual update transitioned state to PARTIAL_TP");
    assert(updated.outcomeReason === "CHANNEL_RESULT", "outcomeReason is CHANNEL_RESULT");
    assert(updated.maxTargetHit === 1, "maxTargetHit is 1");
    assert(updated.outcomePrice === 2012, "outcomePrice is set to the signal hitPrice");
  } catch (err) {
    console.error("Test 6 Failed with error:", err);
    failedTests++;
  }

  // TEST 7: Dynamic Polling Verification
  try {
    resetOutcomeStore();
    resetPriceCache();
    
    // Populate one pending outcome on GBPUSD
    const sig = buildMockSignal({ pair: "GBPUSD", messageId: 900 });
    await initializeOutcome(sig);

    // Run monitoring cycle
    // Note: this will fetch price for GBPUSD=X
    await runMonitoringCycle();
    
    const outcome = await getOutcomeByMessageKey("GoldTradePrecision1:900");
    assert(outcome.lastCheckedAt !== null, "Monitoring cycle executed and checked outcome");
    
    const priceInfo = await getCurrentPrice("GBPUSD");
    assert(priceInfo !== null && priceInfo.price > 0, "Price ingested and stored in cache for GBPUSD");
  } catch (err) {
    console.error("Test 7 Failed with error:", err);
    failedTests++;
  }

  // TEST 8: Pip-based Target Mapping during Initialization
  try {
    resetOutcomeStore();
    const sig = buildMockSignal({
      pair: "EURUSD",
      action: "BUY",
      entry: 1.1200,
      targets: [],
      pipTargets: [10, 20, 30]
    });
    const outcome = await initializeOutcome(sig);
    assert(outcome !== null, "Pip-based signal outcome initialized successfully");
    assert(outcome.targets.length === 3, "Mapped 3 pip targets to absolute targets");
    assert(outcome.targets[0].targetNumber === 1 && outcome.targets[0].price === 1.1210, "Target 1 price is correct (1.1210)");
    assert(outcome.targets[1].targetNumber === 2 && outcome.targets[1].price === 1.1220, "Target 2 price is correct (1.1220)");
    assert(outcome.targets[2].targetNumber === 3 && outcome.targets[2].price === 1.1230, "Target 3 price is correct (1.1230)");
  } catch (err) {
    console.error("Test 8 Failed with error:", err);
    failedTests++;
  }

  // TEST 9: Pip-based Target Mapping for SELL and JPY/Gold Pairs
  try {
    resetOutcomeStore();
    const sigGold = buildMockSignal({
      pair: "XAUUSD",
      action: "SELL",
      entry: 2350.0,
      targets: [],
      pipTargets: [50, 100]
    });
    const outcomeGold = await initializeOutcome(sigGold);
    assert(outcomeGold.targets.length === 2, "Mapped Gold pip targets successfully");
    assert(outcomeGold.targets[0].price === 2345.0, "Gold TP1 is correct (2345.0)");
    assert(outcomeGold.targets[1].price === 2340.0, "Gold TP2 is correct (2340.0)");

    const sigJpy = buildMockSignal({
      pair: "USDJPY",
      action: "BUY",
      entry: 155.00,
      targets: [],
      pipTargets: [20, 50]
    });
    const outcomeJpy = await initializeOutcome(sigJpy);
    assert(outcomeJpy.targets.length === 2, "Mapped USDJPY pip targets successfully");
    assert(outcomeJpy.targets[0].price === 155.20, "USDJPY TP1 is correct (155.20)");
    assert(outcomeJpy.targets[1].price === 155.50, "USDJPY TP2 is correct (155.50)");
  } catch (err) {
    console.error("Test 9 Failed with error:", err);
    failedTests++;
  }

  // TEST 10: Outcome-to-Consensus Synchronization
  try {
    resetOutcomeStore();
    resetPairStateStore();
    
    const signalId = new mongoose.Types.ObjectId();
    const sig = buildMockSignal({
      _id: signalId,
      pair: "XAUUSD",
      action: "BUY",
      entry: 2000,
      targets: [2010, 2020],
      stopLoss: 1990,
      messageId: 1001,
      channel: "SyncChannel1",
    });

    // 1. Ingest parsed signal
    const storeResult = await storeParsedSignal(sig);
    assert(storeResult.stored === true, "Signal stored in parsedSignalStore");

    // 2. Initialize outcome tracking
    let outcome = await initializeOutcome(sig);
    assert(outcome.status === "PENDING", "Outcome initialized as PENDING");

    // Check that pair state has 1 active signal
    let pairState = getPairState("XAUUSD");
    assert(pairState !== null && pairState.signalCount === 1, "Pair state has 1 active signal contributing to consensus");
    assert(pairState.activeSignals[0].signalState === "ACTIVE", "Active signal in-memory state is ACTIVE");

    // 3. Trigger Entry -> ACTIVE
    outcome = await updateOutcomePrice(outcome, 2000, new Date());
    assert(outcome.status === "ACTIVE", "Outcome status updated to ACTIVE");
    
    pairState = getPairState("XAUUSD");
    assert(pairState.signalCount === 1, "Consensus signal count remains 1");
    assert(pairState.activeSignals[0].signalState === "ACTIVE", "In-memory signal state remains ACTIVE");

    // 4. Trigger Stop Loss hit -> SL_HIT -> Mapped to CLOSED
    outcome = await updateOutcomePrice(outcome, 1985, new Date());
    assert(outcome.status === "SL_HIT", "Outcome status is SL_HIT");

    // Verify consensus exclusion
    pairState = getPairState("XAUUSD");
    assert(pairState.signalCount === 0, "Consensus signal count is now 0 (signal excluded)");
    assert(pairState.activeSignals[0].signalState === "CLOSED", "In-memory signal state is updated to CLOSED");

    // 5. Test another signal hitting targets -> FULL_TP -> Mapped to CLOSED
    const signalId2 = new mongoose.Types.ObjectId();
    const sig2 = buildMockSignal({
      _id: signalId2,
      pair: "XAUUSD",
      action: "BUY",
      entry: 2000,
      targets: [2010],
      stopLoss: 1990,
      messageId: 1002,
      channel: "SyncChannel1",
    });

    await storeParsedSignal(sig2);
    let outcome2 = await initializeOutcome(sig2);
    
    pairState = getPairState("XAUUSD");
    assert(pairState.signalCount === 1, "Consensus signal count rose to 1 for the second signal");

    // Price hits entry
    outcome2 = await updateOutcomePrice(outcome2, 2000, new Date());
    // Price hits target
    outcome2 = await updateOutcomePrice(outcome2, 2015, new Date());
    assert(outcome2.status === "FULL_TP", "Outcome status is FULL_TP");

    pairState = getPairState("XAUUSD");
    assert(pairState.signalCount === 0, "Consensus signal count dropped back to 0 (signal excluded)");
    assert(pairState.activeSignals.find(s => String(s._id) === String(signalId2)).signalState === "CLOSED", "In-memory signal state for target signal updated to CLOSED");

  } catch (err) {
    console.error("Test 10 Failed with error:", err);
    failedTests++;
  }

  // TEST 11: Dynamic Trade Lifecycle Management (Preserving Originals)
  try {
    resetOutcomeStore();
    resetPairStateStore();

    const signalId = new mongoose.Types.ObjectId();
    const sig = buildMockSignal({
      _id: signalId,
      pair: "XAUUSD",
      action: "BUY",
      entry: 2000,
      targets: [2010, 2020, 2030],
      stopLoss: 1990,
      messageId: 1001,
      channel: "LifecycleChannel1",
    });

    // 1. Ingest parsed signal
    await storeParsedSignal(sig);
    let outcome = await initializeOutcome(sig);

    // Initial checks
    let pairState = getPairState("XAUUSD");
    assert(pairState.signalCount === 1, "Signal is active initially");
    assert(pairState.slZone.min === 1990 && pairState.slZone.max === 1990, "Initial slZone is the original stopLoss (1990)");
    assert(pairState.tpZone.min === 2010 && pairState.tpZone.max === 2030, "Initial tpZone covers all original targets (2010-2030)");

    // 2. Trigger Entry -> ACTIVE
    outcome = await updateOutcomePrice(outcome, 2000, new Date());
    assert(outcome.status === "ACTIVE", "Outcome status is ACTIVE");

    // 3. Hit Target 1 (TP1 = 2010) -> PARTIAL_TP
    outcome = await updateOutcomePrice(outcome, 2012, new Date());
    assert(outcome.status === "PARTIAL_TP", "Outcome status transitions to PARTIAL_TP on TP1 hit");

    // Verify consensus zones have updated to break-even (SL -> Entry) and targets exclude TP1
    pairState = getPairState("XAUUSD");
    assert(pairState.slZone.min === 2000 && pairState.slZone.max === 2000, "slZone updated to Entry Price (2000) [break-even]");
    assert(pairState.tpZone.min === 2020 && pairState.tpZone.max === 2030, "tpZone updated to exclude hit target TP1 (2020-2030)");

    // Verify that original fields are preserved on the in-memory signal
    const activeSig = pairState.activeSignals[0];
    assert(activeSig.stopLoss === 1990, "Original stopLoss remains preserved (1990)");
    assert(activeSig.targets.length === 3 && activeSig.targets[0] === 2010, "Original targets list remains preserved");
    // Verify that dynamic fields are set on the in-memory signal
    assert(activeSig.effectiveStopLoss === 2000, "effectiveStopLoss is Entry Price (2000)");
    assert(activeSig.remainingTargets.length === 2 && activeSig.remainingTargets[0] === 2020, "remainingTargets contains TP2 and TP3");
    assert(activeSig.lifecycleStage === 1, "lifecycleStage is 1");

    // 4. Hit Target 2 (TP2 = 2020) -> PARTIAL_TP (Stage 2)
    outcome = await updateOutcomePrice(outcome, 2022, new Date());
    assert(outcome.status === "PARTIAL_TP", "Outcome status remains PARTIAL_TP on TP2 hit");

    pairState = getPairState("XAUUSD");
    assert(pairState.slZone.min === 2010 && pairState.slZone.max === 2010, "slZone updated to TP1 price (2010) [profit locked]");
    assert(pairState.tpZone.min === 2030 && pairState.tpZone.max === 2030, "tpZone updated to exclude hit targets TP1 and TP2 (2030-2030)");

    // Verify dynamic fields
    const activeSigStage2 = pairState.activeSignals[0];
    assert(activeSigStage2.effectiveStopLoss === 2010, "effectiveStopLoss is TP1 price (2010)");
    assert(activeSigStage2.remainingTargets.length === 1 && activeSigStage2.remainingTargets[0] === 2030, "remainingTargets contains only TP3");
    assert(activeSigStage2.lifecycleStage === 2, "lifecycleStage is 2");

    // 5. Hit Target 3 (TP3 = 2030) -> FULL_TP
    outcome = await updateOutcomePrice(outcome, 2035, new Date());
    assert(outcome.status === "FULL_TP", "Outcome status transitions to FULL_TP on TP3 hit");

    // Verify closed signal is excluded from consensus
    pairState = getPairState("XAUUSD");
    assert(pairState.signalCount === 0, "Signal is now closed and excluded from consensus");
    assert(pairState.activeSignals[0].signalState === "CLOSED", "In-memory signal state is CLOSED");

  } catch (err) {
    console.error("Test 11 Failed with error:", err);
    failedTests++;
  }



  console.log("\n=== TEST RUN SUMMARY ===");
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  
  if (failedTests > 0) {
    console.error("Some tests failed!");
    setTimeout(() => process.exit(1), 100);
  } else {
    console.log("All tests passed successfully!");
    setTimeout(() => process.exit(0), 100);
  }
}

// Run the suite
runTests().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
