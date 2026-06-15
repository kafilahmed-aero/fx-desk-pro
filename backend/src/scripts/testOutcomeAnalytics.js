import mongoose from "mongoose";
import { saveOutcome, resetOutcomeStore } from "../services/signalOutcomeStore.js";
import { aggregateChannelPerformance, resetPerformanceStore } from "../services/channelPerformanceService.js";
import { aggregatePairPerformance, resetPairPerformanceStore } from "../services/pairPerformanceService.js";
import { getOutcomeSummary } from "../services/outcomeAnalyticsService.js";
import { getOutcomeSummaryController } from "../controllers/outcomeAnalyticsController.js";
import { logger } from "../utils/logger.js";

// Force quiet logging
logger.level = "warn";

async function runTests() {
  console.log("=== STARTING OUTCOME SUMMARY ANALYTICS TESTS ===");
  
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
  async function seedOutcome(channel, pair, status, dateOffsetDays = 0) {
    const baseDate = new Date("2026-06-15T12:00:00Z");
    const createdAt = new Date(baseDate.getTime() - dateOffsetDays * 24 * 60 * 60 * 1000);
    const outcomeTime = new Date(createdAt.getTime() + 30 * 60 * 1000); // 30 minutes duration

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
    resetPerformanceStore();
    resetPairPerformanceStore();

    // 1. Initial State: Empty Store
    let summary = await getOutcomeSummary();
    assert(summary.totalSignalsTracked === 0, "Initial tracked count should be 0");
    assert(summary.readinessLevel === "LOW", "Initial readiness level should be LOW");
    assert(summary.weightedConsensusRecommended === false, "Initial recommendation should be false");

    // 2. Seed Channel1: 22 signals on XAUUSD (completed = 22, eligible channel, eligible pair)
    // First signal date offset = 5 days ago, latest offset = 1 day ago
    for (let i = 0; i < 15; i++) {
      await seedOutcome("Channel1", "XAUUSD", "FULL_TP", 3);
    }
    for (let i = 0; i < 5; i++) {
      await seedOutcome("Channel1", "XAUUSD", "SL_HIT", 2);
    }
    await seedOutcome("Channel1", "XAUUSD", "EXPIRED", 5); // Earliest (first signal)
    await seedOutcome("Channel1", "XAUUSD", "CANCELLED", 1); // Latest (latest signal)

    // Aggregate stats
    await aggregateChannelPerformance();
    await aggregatePairPerformance();

    summary = await getOutcomeSummary();

    assert(summary.totalSignalsTracked === 22, "totalSignalsTracked is 22");
    assert(summary.completedSignals === 22, "completedSignals is 22");
    assert(summary.reliabilityEligibleChannels === 1, "reliabilityEligibleChannels is 1");
    assert(summary.pairEligibleRecords === 1, "pairEligibleRecords is 1");
    
    // Check transition criteria: Completed 22 < 50 => LOW
    assert(summary.readinessLevel === "LOW", `Readiness level should be LOW (got ${summary.readinessLevel})`);
    assert(summary.weightedConsensusRecommended === false, "Recommendation is false under LOW");

    // 3. Seed Channel2: 30 signals on XAUUSD (completed = 30, eligible channel, eligible pair)
    for (let i = 0; i < 20; i++) {
      await seedOutcome("Channel2", "XAUUSD", "FULL_TP", 1);
    }
    for (let i = 0; i < 10; i++) {
      await seedOutcome("Channel2", "XAUUSD", "SL_HIT", 1);
    }

    // Re-aggregate
    await aggregateChannelPerformance();
    await aggregatePairPerformance();

    summary = await getOutcomeSummary();

    assert(summary.completedSignals === 52, `completedSignals is 52 (got ${summary.completedSignals})`);
    assert(summary.reliabilityEligibleChannels === 2, "reliabilityEligibleChannels is 2");
    assert(summary.pairEligibleRecords === 2, "pairEligibleRecords is 2");

    // Check transition criteria: Completed 52 >= 50, eligible channels 2 >= 1, eligible pairs 2 >= 2 => MEDIUM
    assert(summary.readinessLevel === "MEDIUM", `Readiness level should scale to MEDIUM (got ${summary.readinessLevel})`);
    assert(summary.weightedConsensusRecommended === false, "Recommendation is false under MEDIUM");

    // 4. Seed Channel3: 150 signals on EURUSD (completed = 150)
    // Plus more eligible pair records (Channel1 EURUSD, Channel2 EURUSD, Channel3 EURUSD) to reach 5 eligible pairs and 3 eligible channels
    for (let i = 0; i < 120; i++) {
      await seedOutcome("Channel3", "EURUSD", "FULL_TP", 1);
    }
    for (let i = 0; i < 30; i++) {
      await seedOutcome("Channel3", "EURUSD", "SL_HIT", 1);
    }

    // Add eligible pairs:
    // We already have:
    // - Channel1_XAUUSD (22 signals)
    // - Channel2_XAUUSD (30 signals)
    // - Channel3_EURUSD (150 signals)
    // Let's add:
    // - Channel1_EURUSD (20 signals)
    // - Channel2_EURUSD (20 signals)
    for (let i = 0; i < 20; i++) {
      await seedOutcome("Channel1", "EURUSD", "FULL_TP", 1);
    }
    for (let i = 0; i < 20; i++) {
      await seedOutcome("Channel2", "EURUSD", "FULL_TP", 1);
    }

    // Re-aggregate
    await aggregateChannelPerformance();
    await aggregatePairPerformance();

    summary = await getOutcomeSummary();

    // Sum completed signals: 22 (Ch1 XAU) + 30 (Ch2 XAU) + 150 (Ch3 EUR) + 20 (Ch1 EUR) + 20 (Ch2 EUR) = 242 signals
    assert(summary.completedSignals === 242, `completedSignals is 242 (got ${summary.completedSignals})`);
    assert(summary.reliabilityEligibleChannels === 3, `reliabilityEligibleChannels is 3 (got ${summary.reliabilityEligibleChannels})`);
    assert(summary.pairEligibleRecords === 5, `pairEligibleRecords is 5 (got ${summary.pairEligibleRecords})`);

    // Check transition criteria: Completed 242 >= 200, eligible channels 3 >= 3, eligible pairs 5 >= 5 => HIGH
    assert(summary.readinessLevel === "HIGH", `Readiness level should scale to HIGH (got ${summary.readinessLevel})`);
    assert(summary.weightedConsensusRecommended === true, "Recommendation is true under HIGH");

    // Check dates for Channel1
    const ch1Coverage = summary.historicalCoverage.find(c => c.channel === "Channel1");
    assert(!!ch1Coverage, "Channel1 coverage record exists");
    
    // First signal date offset = 5 days ago, latest = 1 day ago. We expect ISO strings.
    assert(!!ch1Coverage.firstSignalDate, "firstSignalDate exists");
    assert(!!ch1Coverage.latestSignalDate, "latestSignalDate exists");
    assert(new Date(ch1Coverage.firstSignalDate) < new Date(ch1Coverage.latestSignalDate), "firstSignalDate is earlier than latest");

    // 5. TEST: API Controller Response
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

    await getOutcomeSummaryController(req, res);
    
    assert(responseStatus === 200, "API Controller returns 200 OK");
    assert(responseData.totalSignalsTracked === 242, "API response contains correct totalSignalsTracked");
    assert(responseData.readinessLevel === "HIGH", "API response contains correct readinessLevel");
    assert(responseData.weightedConsensusRecommended === true, "API response contains correct recommendation flag");
    assert(responseData.reliabilityEligibleChannels === 3, "API response contains correct reliabilityEligibleChannels");
    assert(responseData.pairEligibleRecords === 5, "API response contains correct pairEligibleRecords");
    assert(Array.isArray(responseData.historicalCoverage) && responseData.historicalCoverage.length === 3, "API response contains historicalCoverage array of length 3");

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
    console.log("All outcome summary analytics tests passed successfully!");
    setTimeout(() => process.exit(0), 100);
  }
}

runTests().catch((err) => {
  console.error("Fatal Test Failure:", err);
  process.exit(1);
});
