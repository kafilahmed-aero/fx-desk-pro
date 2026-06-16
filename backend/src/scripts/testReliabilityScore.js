import mongoose from "mongoose";
import { saveOutcome, resetOutcomeStore } from "../services/signalOutcomeStore.js";
import { aggregateChannelPerformance, resetPerformanceStore } from "../services/channelPerformanceService.js";
import { getReliabilityScores } from "../services/reliabilityScoreService.js";
import { getReliabilityScoresController } from "../controllers/reliabilityScoreController.js";
import { logger } from "../utils/logger.js";

// Force quiet logging
logger.level = "warn";

async function runTests() {
  console.log("=== STARTING RELIABILITY SCORE TESTS ===");
  
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
  async function seedOutcome(channel, status) {
    const createdAt = new Date("2026-06-15T12:00:00Z");
    const outcomeTime = new Date(createdAt.getTime() + 30 * 60 * 1000); // 30 minutes duration

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

    // 1. Seed Channel A: 20 signals (16 FULL_TP, 4 SL_HIT) - Completed = 20 (ELIGIBLE)
    // winRate = 16 / 20 = 0.8
    // targetAchievement = 16 / 20 = 0.8
    // expiryRate = 0 / 20 = 0.0
    // volumeFactor = min(20/100, 1) = 0.2
    // score = (0.8 * 0.5 + 0.8 * 0.25 + (1 - 0) * 0.15 + 0.2 * 0.1) * 100
    //       = (0.4 + 0.2 + 0.15 + 0.02) * 100 = 77.0
    // Tier: B (score 77.0 >= 70)
    for (let i = 0; i < 16; i++) {
      await seedOutcome("ChannelA", "FULL_TP");
    }
    for (let i = 0; i < 4; i++) {
      await seedOutcome("ChannelA", "SL_HIT");
    }

    // 2. Seed Channel B: 10 signals (8 FULL_TP, 2 SL_HIT) - Completed = 10 (UNRATED, completed < 20)
    // winRate = 8 / 10 = 0.8
    // targetAchievement = 8 / 10 = 0.8
    // expiryRate = 0.0
    // volumeFactor = min(10/100, 1) = 0.1
    // score = (0.8 * 0.5 + 0.8 * 0.25 + 1.0 * 0.15 + 0.1 * 0.1) * 100
    //       = (0.4 + 0.2 + 0.15 + 0.01) * 100 = 76.0
    // Tier: UNRATED (since completed < 20)
    for (let i = 0; i < 8; i++) {
      await seedOutcome("ChannelB", "FULL_TP");
    }
    for (let i = 0; i < 2; i++) {
      await seedOutcome("ChannelB", "SL_HIT");
    }

    // 3. Seed Channel C: 110 signals (90 FULL_TP, 10 SL_HIT, 10 EXPIRED) - Completed = 110 (ELIGIBLE)
    // winRate = 90 / (90 + 10) = 0.9
    // targetAchievement = 90 / 110 = 0.8182
    // expiryRate = 10 / 110 = 0.0909
    // volumeFactor = min(110/100, 1) = 1.0
    // score = (0.9 * 0.5 + 0.8182 * 0.25 + (1 - 0.0909) * 0.15 + 1.0 * 0.1) * 100
    //       = (0.45 + 0.20455 + 0.136365 + 0.1) * 100 = 89.09
    // Tier: A (score 89.09 >= 80)
    for (let i = 0; i < 90; i++) {
      await seedOutcome("ChannelC", "FULL_TP");
    }
    for (let i = 0; i < 10; i++) {
      await seedOutcome("ChannelC", "SL_HIT");
    }
    for (let i = 0; i < 10; i++) {
      await seedOutcome("ChannelC", "EXPIRED");
    }

    // Seed outcomes for private-test-channel:3955968449 (should be excluded)
    for (let i = 0; i < 20; i++) {
      await seedOutcome("private-test-channel:3955968449", "FULL_TP");
    }

    // Run channel performances aggregation
    await aggregateChannelPerformance();

    // Get reliability scores
    const results = await getReliabilityScores();
    
    assert(results.length === 3, `Expected 3 results, got ${results.length}`);
    
    const hasTestChannel = results.some(r => r.channel === "private-test-channel:3955968449");
    assert(!hasTestChannel, "private-test-channel:3955968449 is excluded from reliability scores");

    // Verify Sorting: ChannelC first (score 89.09), ChannelA second (score 77.00), ChannelB third (score 76.00)
    assert(results[0].channel === "ChannelC", `First element should be ChannelC, got ${results[0].channel}`);
    assert(results[1].channel === "ChannelA", `Second element should be ChannelA, got ${results[1].channel}`);
    assert(results[2].channel === "ChannelB", `Third element should be ChannelB, got ${results[2].channel}`);

    // ChannelC detailed validation
    const c = results[0];
    assert(c.winRate === 0.9, "ChannelC winRate correct");
    assert(c.completedSignals === 110, "ChannelC completedSignals correct");
    assert(c.isReliabilityEligible === true, "ChannelC isReliabilityEligible is true");
    assert(c.reliabilityScore === 89.09, `ChannelC reliabilityScore should be 89.09, got ${c.reliabilityScore}`);
    assert(c.confidenceTier === "A", `ChannelC confidenceTier should be A, got ${c.confidenceTier}`);

    // ChannelA detailed validation
    const a = results[1];
    assert(a.completedSignals === 20, "ChannelA completedSignals correct");
    assert(a.isReliabilityEligible === true, "ChannelA isReliabilityEligible is true");
    assert(a.reliabilityScore === 77.0, `ChannelA reliabilityScore should be 77.00, got ${a.reliabilityScore}`);
    assert(a.confidenceTier === "B", `ChannelA confidenceTier should be B, got ${a.confidenceTier}`);

    // ChannelB detailed validation (under eligibility threshold)
    const b = results[2];
    assert(b.completedSignals === 10, "ChannelB completedSignals correct");
    assert(b.isReliabilityEligible === false, "ChannelB isReliabilityEligible is false");
    assert(b.reliabilityScore === 76.0, `ChannelB reliabilityScore should be 76.00, got ${b.reliabilityScore}`);
    assert(b.confidenceTier === "UNRATED", `ChannelB confidenceTier should be UNRATED, got ${b.confidenceTier}`);

    // TEST: API Controller Response
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

    await getReliabilityScoresController(req, res);
    
    assert(responseStatus === 200, "API Controller returns 200 OK");
    assert(Array.isArray(responseData) && responseData.length === 3, "API response is an array of length 3");
    
    const apiItem = responseData[0];
    assert(apiItem.channel === "ChannelC", "API response contains channel name");
    assert(apiItem.reliabilityScore === 89.09, "API response contains reliabilityScore");
    assert(apiItem.confidenceTier === "A", "API response contains confidenceTier");
    assert(apiItem.isReliabilityEligible === true, "API response contains isReliabilityEligible");
    assert(apiItem.minimumSignalsRequired === 20, "API response contains minimumSignalsRequired");
    assert(apiItem.completedSignals === 110, "API response contains completedSignals");

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
    console.log("All reliability score tests passed successfully!");
    setTimeout(() => process.exit(0), 100);
  }
}

runTests().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
