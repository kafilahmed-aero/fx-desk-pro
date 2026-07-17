import assert from "assert";
import { evaluateSignalOutcome } from "../services/signalOutcomeEngineService.js";

function buildMockClosedContext(overrides = {}) {
  return {
    signalId: 7001,
    channelId: "test-chan-1",
    channelName: "TestChannel",
    symbol: "XAUUSD",
    direction: "BUY",
    entry: 2030,
    entryFrom: null,
    entryTo: null,
    stopLoss: 2020,
    takeProfits: [2045],
    receivedTimestamp: "2026-07-17T12:00:00.000Z",
    parserTimestamp: "2026-07-17T12:00:00.000Z",
    pipelineStatus: "EXECUTED",
    executionStatus: "NOT_STARTED",
    order: {
      type: "MARKET",
      plannedEntry: 2030,
      entryZone: { lower: 2030, upper: 2030 },
      currentMarketPrice: 2030,
      planningTimestamp: "2026-07-17T12:00:01.000Z",
      planningReason: "PRICE_INSIDE_ENTRY_ZONE",
      status: "PLANNED",
      executionMode: "MARKET",
      executionStatus: "EXECUTED",
      scheduledAt: "2026-07-17T12:00:02.000Z",
      nextEvaluationTime: null,
      schedulerVersion: "1.0.0",
      schedulerReason: "MARKET_ORDER",
      ticket: "882200",
      fillPrice: 2030.0,
      executedAt: "2026-07-17T12:00:05.000Z",
      executionResult: "SUCCESS"
    },
    monitoring: {
      status: "POSITION_CLOSED",
      startedAt: "2026-07-17T12:00:02.000Z",
      lastUpdate: "2026-07-17T12:10:00.000Z",
      lastKnownPrice: 2045.0,
      positionOpenedAt: "2026-07-17T12:00:05.000Z",
      positionClosedAt: "2026-07-17T12:10:05.000Z",
      closeReason: "TP"
    },
    outcome: {
      result: null,
      closedAt: null,
      profit: null,
      pips: null
    },
    rating: {
      processed: false
    },
    ...overrides
  };
}

async function runTests() {
  console.log("=== Signal Outcome Engine Scenario Test Suite ===\n");
  let passed = true;

  // Test 1: FULL_TP closed walkthrough (positive pips + broker profit)
  try {
    console.log("[Test 1] Testing FULL_TP walkthrough...");
    const ctx = buildMockClosedContext();
    const eventPayload = { profit: 15.5 };

    const evaluated = evaluateSignalOutcome(ctx, eventPayload);
    const out = evaluated.outcome;

    if (
      evaluated.pipelineStatus === "COMPLETED" &&
      out.result === "FULL_TP" &&
      out.closedAt === "2026-07-17T12:10:05.000Z" &&
      out.closePrice === 2045.0 &&
      out.pips === 150.0 && // (2045.0 - 2030.0) / 0.1
      out.profit === 15.5 &&
      out.tradeDuration === 600 && // 600 seconds
      evaluated.monitoring.closeReason === "TP" // monitoring preserved
    ) {
      console.log("  PASS: Properly calculated positive pips and passed realized profit.");
    } else {
      console.error("  FAIL: FULL_TP outcome mismatch:", out);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: SL_HIT closed walkthrough (negative pips + null profit)
  try {
    console.log("\n[Test 2] Testing SL_HIT walkthrough...");
    const ctx = buildMockClosedContext({
      monitoring: {
        status: "POSITION_CLOSED",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:05:00.000Z",
        lastKnownPrice: 2020.0,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: "2026-07-17T12:05:05.000Z",
        closeReason: "SL"
      }
    });

    const evaluated = evaluateSignalOutcome(ctx);
    const out = evaluated.outcome;

    if (
      out.result === "SL_HIT" &&
      out.pips === -100.0 && // (2020.0 - 2030.0) / 0.1
      out.profit === null &&
      out.tradeDuration === 300
    ) {
      console.log("  PASS: Properly calculated negative pips and set profit to null.");
    } else {
      console.error("  FAIL: SL_HIT outcome mismatch:", out);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: MANUAL_CLOSE walkthrough
  try {
    console.log("\n[Test 3] Testing MANUAL_CLOSE walkthrough...");
    const ctx = buildMockClosedContext({
      monitoring: {
        status: "POSITION_CLOSED",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:08:00.000Z",
        lastKnownPrice: 2035.5,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: "2026-07-17T12:08:05.000Z",
        closeReason: "MANUAL"
      }
    });

    const evaluated = evaluateSignalOutcome(ctx);
    const out = evaluated.outcome;

    if (
      out.result === "MANUAL_CLOSE" &&
      out.pips === 55.0 &&
      out.profit === null
    ) {
      console.log("  PASS: Properly calculated pips for manual exits.");
    } else {
      console.error("  FAIL: MANUAL_CLOSE mismatch:", out);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Test 4: CANCELLED walkthrough (no position opened)
  try {
    console.log("\n[Test 4] Testing CANCELLED walkthrough (no opened position)...");
    const ctx = buildMockClosedContext({
      monitoring: {
        status: "POSITION_CLOSED",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:08:00.000Z",
        lastKnownPrice: null,
        positionOpenedAt: null,
        positionClosedAt: "2026-07-17T12:08:05.000Z",
        closeReason: "CANCELLED"
      }
    });

    const evaluated = evaluateSignalOutcome(ctx);
    const out = evaluated.outcome;

    if (
      out.result === "CANCELLED" &&
      out.pips === 0 &&
      out.profit === 0 &&
      out.tradeDuration === 0 &&
      out.closePrice === null
    ) {
      console.log("  PASS: Properly mapped CANCELLED order variables.");
    } else {
      console.error("  FAIL: CANCELLED mismatch:", out);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 4:", err.message);
    passed = false;
  }

  // Test 5: EXPIRED walkthrough (no position opened)
  try {
    console.log("\n[Test 5] Testing EXPIRED walkthrough...");
    const ctx = buildMockClosedContext({
      monitoring: {
        status: "POSITION_CLOSED",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:08:00.000Z",
        lastKnownPrice: null,
        positionOpenedAt: null,
        positionClosedAt: "2026-07-17T12:08:05.000Z",
        closeReason: "EXPIRED"
      }
    });

    const evaluated = evaluateSignalOutcome(ctx);
    const out = evaluated.outcome;

    if (
      out.result === "EXPIRED" &&
      out.pips === 0 &&
      out.profit === 0 &&
      out.tradeDuration === 0 &&
      out.closePrice === null
    ) {
      console.log("  PASS: Properly mapped EXPIRED order variables.");
    } else {
      console.error("  FAIL: EXPIRED mismatch:", out);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 5:", err.message);
    passed = false;
  }

  // Test 6: UNKNOWN walkthrough
  try {
    console.log("\n[Test 6] Testing UNKNOWN walkthrough...");
    const ctx = buildMockClosedContext({
      monitoring: {
        status: "POSITION_CLOSED",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:08:00.000Z",
        lastKnownPrice: 2030.0,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: "2026-07-17T12:08:05.000Z",
        closeReason: "OTHER"
      }
    });

    const evaluated = evaluateSignalOutcome(ctx);
    const out = evaluated.outcome;

    if (
      out.result === "UNKNOWN" &&
      out.pips === 0.0 &&
      out.profit === null
    ) {
      console.log("  PASS: Properly mapped UNKNOWN outcome result.");
    } else {
      console.error("  FAIL: UNKNOWN mismatch:", out);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 6:", err.message);
    passed = false;
  }

  // Test 7: Guards check
  try {
    console.log("\n[Test 7] Testing Ingestion guards for active stages...");

    // Case A: Unscheduled pipelineStatus
    const ctxA = buildMockClosedContext({ pipelineStatus: "SCHEDULED" });
    const resA = evaluateSignalOutcome(ctxA);
    assert(resA === ctxA, "Uncompleted contexts should be bypassed immediately.");

    // Case B: POSITION_OPEN status
    const ctxB = buildMockClosedContext();
    ctxB.monitoring.status = "POSITION_OPEN";
    const resB = evaluateSignalOutcome(ctxB);
    assert(resB === ctxB, "Open trades should be bypassed immediately.");

    console.log("  PASS: Guards bypassed active contexts cleanly.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 7:", err.message);
    passed = false;
  }

  // Test 8: Immutability Enforcements
  try {
    console.log("\n[Test 8] Testing Immutability checks...");
    const ctx = buildMockClosedContext();
    const evaluated = evaluateSignalOutcome(ctx);

    assert.throws(() => {
      evaluated.outcome.result = "MUTATED";
    }, "Deep-freeze should prevent modifications.");
    console.log("  PASS: Immutability check succeeded.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 8:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL OUTCOME TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("OUTCOME TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
