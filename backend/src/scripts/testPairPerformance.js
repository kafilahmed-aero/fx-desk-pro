import mongoose from "mongoose";
import { saveOutcome, resetOutcomeStore } from "../services/signalOutcomeStore.js";
import { aggregatePairPerformance, getPairPerformances, resetPairPerformanceStore } from "../services/pairPerformanceService.js";
import { getPairPerformanceController } from "../controllers/pairPerformanceController.js";
import { logger } from "../utils/logger.js";

// Force quiet logging
logger.level = "warn";

async function runTests() {
  console.log("=== STARTING PAIR PERFORMANCE AGGREGATION TESTS ===");
  
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

  // Seed Helper
  async function seedOutcome(channel, pair, status, minutesDuration = null) {
    const createdAt = new Date("2026-06-15T12:00:00Z");
    let outcomeTime = null;
    if (minutesDuration !== null) {
      outcomeTime = new Date(createdAt.getTime() + minutesDuration * 60 * 1000);
    }

    const outcome = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: `${channel}:${pair}:${Math.floor(Math.random() * 10000000)}`,
      channel,
      pair,
      action: "BUY",
      entry: { entryType: "PRICE", entryPrice: 2000, entryLow: null, entryHigh: null },
      targets: [{ targetNumber: 1, price: 2010, isHit: status === "FULL_TP" || status === "PARTIAL_TP" }],
      stopLoss: 1990,
      status,
      hitTargets: status === "FULL_TP" || status === "PARTIAL_TP" ? [1] : [],
      maxTargetHit: status === "FULL_TP" || status === "PARTIAL_TP" ? 1 : 0,
      outcomePrice: status === "FULL_TP" ? 2010 : (status === "SL_HIT" ? 1990 : null),
      outcomeTime,
      outcomeReason: "PRICE_MONITOR",
      expiresAt: new Date(createdAt.getTime() + 72 * 60 * 60 * 1000),
      createdAt,
      updatedAt: new Date(),
    };

    await saveOutcome(outcome);
  }

  try {
    resetOutcomeStore();
    resetPairPerformanceStore();

    const channelName = "TestPremiumGold";

    // 1. Seed XAUUSD outcomes (23 signals total - ELIGIBLE)
    // 10 FULL_TP (duration 30 mins)
    for (let i = 0; i < 10; i++) {
      await seedOutcome(channelName, "XAUUSD", "FULL_TP", 30);
    }
    // 2 PARTIAL_TP (duration 15 mins)
    for (let i = 0; i < 2; i++) {
      await seedOutcome(channelName, "XAUUSD", "PARTIAL_TP", 15);
    }
    // 5 SL_HIT (duration 60 mins)
    for (let i = 0; i < 5; i++) {
      await seedOutcome(channelName, "XAUUSD", "SL_HIT", 60);
    }
    // 3 EXPIRED
    for (let i = 0; i < 3; i++) {
      await seedOutcome(channelName, "XAUUSD", "EXPIRED");
    }
    // 1 CANCELLED
    await seedOutcome(channelName, "XAUUSD", "CANCELLED");
    // 1 PENDING
    await seedOutcome(channelName, "XAUUSD", "PENDING");
    // 1 ACTIVE
    await seedOutcome(channelName, "XAUUSD", "ACTIVE");

    // 2. Seed EURUSD outcomes (5 signals total - NOT ELIGIBLE)
    // 3 FULL_TP (duration 40 mins)
    for (let i = 0; i < 3; i++) {
      await seedOutcome(channelName, "EURUSD", "FULL_TP", 40);
    }
    // 2 SL_HIT (duration 90 mins)
    for (let i = 0; i < 2; i++) {
      await seedOutcome(channelName, "EURUSD", "SL_HIT", 90);
    }

    // 3. Seed alias "GOLD" outcomes (2 signals total - should normalize to XAUUSD!)
    // 2 FULL_TP (duration 15 mins)
    for (let i = 0; i < 2; i++) {
      await seedOutcome(channelName, "GOLD", "FULL_TP", 15);
    }

    // Seed outcomes for private-test-channel:3955968449 (should be excluded)
    for (let i = 0; i < 5; i++) {
      await seedOutcome("private-test-channel:3955968449", "XAUUSD", "FULL_TP", 30);
    }

    // Recalculate Pair Performance
    const results = await aggregatePairPerformance();
    
    // There should be exactly 2 grouped keys:
    // 1. TestPremiumGold_XAUUSD (merged XAUUSD & GOLD outcomes)
    // 2. TestPremiumGold_EURUSD
    assert(results.length === 2, `Aggregated successfully for exactly 2 groups (got ${results.length})`);
    
    const hasTestChannel = results.some(r => r.channel === "private-test-channel:3955968449");
    assert(!hasTestChannel, "private-test-channel:3955968449 is excluded from aggregated results");

    const xauusdPerf = results.find(r => r.pair === "XAUUSD");
    const eurusdPerf = results.find(r => r.pair === "EURUSD");

    assert(!!xauusdPerf, "XAUUSD record exists");
    assert(!!eurusdPerf, "EURUSD record exists");

    // XAUUSD verification (23 from XAUUSD + 2 from GOLD = 25 total signals)
    // Completed: 21 from XAUUSD + 2 from GOLD = 23 completed signals
    // FULL_TP: 10 + 2 = 12
    // PARTIAL_TP: 2
    // SL_HIT: 5
    // EXPIRED: 3
    // CANCELLED: 1
    assert(xauusdPerf.channelPairKey === "TestPremiumGold_XAUUSD", "channelPairKey is correct for XAUUSD");
    assert(xauusdPerf.channel === channelName, "Channel is correct for XAUUSD");
    assert(xauusdPerf.totalSignals === 25, `totalSignals matches expected 25 (got ${xauusdPerf.totalSignals})`);
    assert(xauusdPerf.completedSignals === 23, `completedSignals matches expected 23 (got ${xauusdPerf.completedSignals})`);
    assert(xauusdPerf.fullTpCount === 12, "fullTpCount matches expected 12");
    assert(xauusdPerf.partialTpCount === 2, "partialTpCount matches expected 2");
    assert(xauusdPerf.slHitCount === 5, "slHitCount matches expected 5");
    assert(xauusdPerf.expiredCount === 3, "expiredCount matches expected 3");
    assert(xauusdPerf.cancelledCount === 1, "cancelledCount matches expected 1");

    // Math check
    // winRate = 12 / (12 + 5) = 12 / 17 = 0.7059
    assert(xauusdPerf.winRate === 0.7059, `winRate calculation matches expected 0.7059 (got ${xauusdPerf.winRate})`);
    
    // targetAchievementRate = (12 + 2) / 23 = 14 / 23 = 0.6087
    assert(xauusdPerf.targetAchievementRate === 0.6087, `targetAchievementRate matches expected 0.6087 (got ${xauusdPerf.targetAchievementRate})`);

    // TP Duration = (10 * 30 + 2 * 15 [from XAUUSD] + 2 * 15 [from GOLD]) / 14 = (300 + 30 + 30) / 14 = 360 / 14 = 25.71
    assert(xauusdPerf.avgTpDurationMinutes === 25.71, `avgTpDurationMinutes matches expected 25.71 (got ${xauusdPerf.avgTpDurationMinutes})`);
    
    // SL Duration = (5 * 60) / 5 = 60
    assert(xauusdPerf.avgSlDurationMinutes === 60.0, `avgSlDurationMinutes matches expected 60.0 (got ${xauusdPerf.avgSlDurationMinutes})`);

    // Eligibility = 23 completed >= 20 -> true
    assert(xauusdPerf.isEligible === true, "isEligible is true since completed >= 20");
    assert(xauusdPerf.minimumSignalsRequired === 20, "minimumSignalsRequired defaults to 20");

    // EURUSD verification (5 signals, not eligible)
    assert(eurusdPerf.totalSignals === 5, `EURUSD totalSignals matches expected 5 (got ${eurusdPerf.totalSignals})`);
    assert(eurusdPerf.completedSignals === 5, `EURUSD completedSignals matches expected 5`);
    assert(eurusdPerf.isEligible === false, "EURUSD isEligible is false since completed = 5 < 20");

    // TEST: Retrieve through Service query interface
    const allPerfs = await getPairPerformances();
    assert(allPerfs.length === 2, "getPairPerformances returns 2 records");

    // TEST: Controller mock test
    let responseStatus = null;
    let responseData = null;
    const req = {};
    const res = {
      status(s) {
        responseStatus = s;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      }
    };

    await getPairPerformanceController(req, res);
    
    assert(responseStatus === 200, "API Controller returns 200 OK");
    assert(Array.isArray(responseData) && responseData.length === 2, "API response is an array of length 2");
    
    const apiXauusd = responseData.find(x => x.pair === "XAUUSD");
    assert(apiXauusd.channelPairKey === "TestPremiumGold_XAUUSD", "API response contains correct channelPairKey");
    assert(apiXauusd.channel === channelName, "API response contains correct channel");
    assert(apiXauusd.totalSignals === 25, "API response contains correct totalSignals");
    assert(apiXauusd.winRate === 0.7059, "API response contains correct winRate");
    assert(apiXauusd.completedSignals === 23, "API response contains correct completedSignals");
    assert(apiXauusd.isEligible === true, "API response contains correct eligibility status");

  } catch (err) {
    console.error("Test execution failed with error:", err);
    failedTests++;
  }

  console.log("\n=== TEST RUN SUMMARY ===");
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  
  if (failedTests > 0) {
    console.error("Some tests failed!");
    setTimeout(() => process.exit(1), 100);
  } else {
    console.log("All pair performance tests passed successfully!");
    setTimeout(() => process.exit(0), 100);
  }
}

runTests().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
