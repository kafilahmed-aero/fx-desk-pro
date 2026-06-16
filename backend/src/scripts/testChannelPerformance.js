import mongoose from "mongoose";
import { saveOutcome, resetOutcomeStore } from "../services/signalOutcomeStore.js";
import { aggregateChannelPerformance, getChannelPerformances, resetPerformanceStore } from "../services/channelPerformanceService.js";
import { getChannelPerformanceController } from "../controllers/channelPerformanceController.js";
import { logger } from "../utils/logger.js";

// Force quiet logging
logger.level = "warn";

async function runTests() {
  console.log("=== STARTING CHANNEL PERFORMANCE AGGREGATION TESTS ===");
  
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
  async function seedOutcome(channel, status, minutesDuration = null) {
    const createdAt = new Date("2026-06-15T12:00:00Z");
    let outcomeTime = null;
    if (minutesDuration !== null) {
      outcomeTime = new Date(createdAt.getTime() + minutesDuration * 60 * 1000);
    }

    const outcome = {
      signalId: new mongoose.Types.ObjectId(),
      messageKey: `${channel}:${Math.floor(Math.random() * 10000000)}`,
      channel,
      pair: "XAUUSD",
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
    resetPerformanceStore();

    const channelName = "TestPremiumGold";

    // Seed 23 signals total:
    // 10 FULL_TP (duration 30 mins)
    for (let i = 0; i < 10; i++) {
      await seedOutcome(channelName, "FULL_TP", 30);
    }
    // 2 PARTIAL_TP (duration 15 mins)
    for (let i = 0; i < 2; i++) {
      await seedOutcome(channelName, "PARTIAL_TP", 15);
    }
    // 5 SL_HIT (duration 60 mins)
    for (let i = 0; i < 5; i++) {
      await seedOutcome(channelName, "SL_HIT", 60);
    }
    // 3 EXPIRED
    for (let i = 0; i < 3; i++) {
      await seedOutcome(channelName, "EXPIRED");
    }
    // 1 CANCELLED
    await seedOutcome(channelName, "CANCELLED");
    // 1 PENDING
    await seedOutcome(channelName, "PENDING");
    // 1 ACTIVE
    await seedOutcome(channelName, "ACTIVE");

    // Seed outcomes for private-test-channel:3955968449 (should be excluded)
    for (let i = 0; i < 5; i++) {
      await seedOutcome("private-test-channel:3955968449", "FULL_TP", 30);
    }

    // Recalculate Performance
    const results = await aggregateChannelPerformance();
    
    assert(results.length === 1, "Aggregated successfully for exactly 1 channel");
    
    const hasTestChannel = results.some(r => r.channel === "private-test-channel:3955968449");
    assert(!hasTestChannel, "private-test-channel:3955968449 is excluded from aggregated results");

    const p = results[0];

    assert(p.channel === channelName, "Channel name is correct");
    assert(p.totalSignals === 23, `totalSignals matches expected 23 (got ${p.totalSignals})`);
    assert(p.pendingCount === 1, "pendingCount matches expected 1");
    assert(p.activeCount === 1, "activeCount matches expected 1");
    assert(p.fullTpCount === 10, "fullTpCount matches expected 10");
    assert(p.partialTpCount === 2, "partialTpCount matches expected 2");
    assert(p.slHitCount === 5, "slHitCount matches expected 5");
    assert(p.expiredCount === 3, "expiredCount matches expected 3");
    assert(p.cancelledCount === 1, "cancelledCount matches expected 1");
    assert(p.completedSignals === 21, `completedSignals matches expected 21 (got ${p.completedSignals})`);

    // Math check
    // winRate = 10 / (10 + 5) = 10 / 15 = 0.6667
    assert(p.winRate === 0.6667, `winRate calculation matches expected 0.6667 (got ${p.winRate})`);
    
    // targetAchievementRate = (10 + 2) / 21 = 12 / 21 = 0.5714
    assert(p.targetAchievementRate === 0.5714, `targetAchievementRate matches expected 0.5714 (got ${p.targetAchievementRate})`);
    
    // expiryRate = 3 / 23 = 0.1304
    assert(p.expiryRate === 0.1304, `expiryRate matches expected 0.1304 (got ${p.expiryRate})`);

    // TP Duration = (10 * 30 + 2 * 15) / 12 = 330 / 12 = 27.5
    assert(p.avgTpDurationMinutes === 27.5, `avgTpDurationMinutes matches expected 27.5 (got ${p.avgTpDurationMinutes})`);
    
    // SL Duration = (5 * 60) / 5 = 60
    assert(p.avgSlDurationMinutes === 60.0, `avgSlDurationMinutes matches expected 60.0 (got ${p.avgSlDurationMinutes})`);

    // Reliability eligibility = 21 >= 20 -> true
    assert(p.isReliabilityEligible === true, "isReliabilityEligible is true since completed > 20");

    // TEST 8: Retrieve through Service query interface
    const allPerfs = await getChannelPerformances();
    assert(allPerfs.length === 1 && allPerfs[0].channel === channelName, "getChannelPerformances returns the correct entries");

    // TEST 9: Controller mock test
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

    await getChannelPerformanceController(req, res);
    
    assert(responseStatus === 200, "API Controller returns 200 OK");
    assert(Array.isArray(responseData) && responseData.length === 1, "API response is an array of length 1");
    const item = responseData[0];
    
    assert(item.channel === channelName, "API response contains correct channel");
    assert(item.totalSignals === 23, "API response contains correct totalSignals");
    assert(item.winRate === 0.6667, "API response contains correct winRate");
    assert(item.fullTpCount === 10, "API response contains correct fullTpCount");
    assert(item.avgTpDurationMinutes === 27.5, "API response contains correct average TP duration");
    assert(item.isReliabilityEligible === true, "API response contains correct eligibility status");

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
    console.log("All channel performance tests passed successfully!");
    setTimeout(() => process.exit(0), 100);
  }
}

runTests().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
