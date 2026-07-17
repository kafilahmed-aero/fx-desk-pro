import { evaluatePriceMonitor } from "../services/signalPriceMonitorService.js";

function buildMockScheduledContext(type = "BUY_LIMIT", executionStatus = "WAITING_FOR_PRICE", overrides = {}) {
  return {
    signalId: 3001,
    channelId: "test-chan-1",
    channelName: "TestChannel",
    symbol: "XAUUSD",
    direction: ["BUY_LIMIT", "BUY_STOP"].includes(type) ? "BUY" : "SELL",
    entry: 2030,
    entryFrom: null,
    entryTo: null,
    stopLoss: 2020,
    takeProfits: [2045],
    receivedTimestamp: "2026-07-17T12:00:00.000Z",
    parserTimestamp: "2026-07-17T12:00:00.000Z",
    pipelineStatus: "SCHEDULED",
    executionStatus: "NOT_STARTED",
    order: {
      type,
      plannedEntry: 2030,
      entryZone: { lower: 2030, upper: 2030 },
      currentMarketPrice: 2032,
      planningTimestamp: "2026-07-17T12:00:01.000Z",
      planningReason: "BUY_ENTRY_BELOW_MARKET",
      status: "PLANNED",
      executionMode: "PENDING",
      executionStatus,
      scheduledAt: "2026-07-17T12:00:02.000Z",
      nextEvaluationTime: null,
      schedulerVersion: "1.0.0",
      schedulerReason: "PENDING_ORDER",
      ticket: null,
      fillPrice: null,
      placedAt: null
    },
    monitoring: {
      status: "NOT_STARTED",
      startedAt: null,
      lastUpdate: null
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
  console.log("=== Price Monitor Scenario Test Suite ===\n");
  let passed = true;

  // Test 1: BUY_LIMIT promotion
  try {
    console.log("[Test 1] Testing BUY_LIMIT promotion (price <= entry)...");
    const ctx = buildMockScheduledContext("BUY_LIMIT");
    const evaluated = evaluatePriceMonitor(ctx, 2029.5); // 2029.5 <= 2030

    if (
      evaluated.order.executionStatus === "READY_FOR_EXECUTION" &&
      evaluated.order.promotionReason === "PRICE_REACHED_BUY_LIMIT" &&
      evaluated.order.promotionTimestamp !== undefined &&
      evaluated.order.lastEvaluation.result === "PROMOTED" &&
      evaluated.order.plannedEntry === 2030 // preserved
    ) {
      console.log("  PASS: Properly promoted BUY_LIMIT setup.");
    } else {
      console.error("  FAIL: BUY_LIMIT promotion mismatch:", evaluated.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: BUY_STOP promotion
  try {
    console.log("\n[Test 2] Testing BUY_STOP promotion (price >= entry)...");
    const ctx = buildMockScheduledContext("BUY_STOP");
    const evaluated = evaluatePriceMonitor(ctx, 2030.5); // 2030.5 >= 2030

    if (
      evaluated.order.executionStatus === "READY_FOR_EXECUTION" &&
      evaluated.order.promotionReason === "PRICE_REACHED_BUY_STOP" &&
      evaluated.order.lastEvaluation.result === "PROMOTED"
    ) {
      console.log("  PASS: Properly promoted BUY_STOP setup.");
    } else {
      console.error("  FAIL: BUY_STOP promotion mismatch:", evaluated.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: SELL_LIMIT promotion
  try {
    console.log("\n[Test 3] Testing SELL_LIMIT promotion (price >= entry)...");
    const ctx = buildMockScheduledContext("SELL_LIMIT");
    const evaluated = evaluatePriceMonitor(ctx, 2031); // 2031 >= 2030

    if (
      evaluated.order.executionStatus === "READY_FOR_EXECUTION" &&
      evaluated.order.promotionReason === "PRICE_REACHED_SELL_LIMIT" &&
      evaluated.order.lastEvaluation.result === "PROMOTED"
    ) {
      console.log("  PASS: Properly promoted SELL_LIMIT setup.");
    } else {
      console.error("  FAIL: SELL_LIMIT promotion mismatch:", evaluated.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Test 4: SELL_STOP promotion
  try {
    console.log("\n[Test 4] Testing SELL_STOP promotion (price <= entry)...");
    const ctx = buildMockScheduledContext("SELL_STOP");
    const evaluated = evaluatePriceMonitor(ctx, 2029); // 2029 <= 2030

    if (
      evaluated.order.executionStatus === "READY_FOR_EXECUTION" &&
      evaluated.order.promotionReason === "PRICE_REACHED_SELL_STOP" &&
      evaluated.order.lastEvaluation.result === "PROMOTED"
    ) {
      console.log("  PASS: Properly promoted SELL_STOP setup.");
    } else {
      console.error("  FAIL: SELL_STOP promotion mismatch:", evaluated.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 4:", err.message);
    passed = false;
  }

  // Test 5: Cases where no promotion occurs
  try {
    console.log("\n[Test 5] Testing No-Promotion scenario (price threshold not met)...");
    const ctx = buildMockScheduledContext("BUY_LIMIT");
    const evaluated = evaluatePriceMonitor(ctx, 2031); // 2031 > 2030 (not reached)

    if (
      evaluated.order.executionStatus === "WAITING_FOR_PRICE" &&
      evaluated.order.lastEvaluation.result === "NO_ACTION" &&
      evaluated.order.promotionReason === undefined
    ) {
      console.log("  PASS: Price Monitor left order status unchanged and logged NO_ACTION.");
    } else {
      console.error("  FAIL: No-promotion check mismatch:", evaluated.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 5:", err.message);
    passed = false;
  }

  // Test 6: Transition Guards
  try {
    console.log("\n[Test 6] Testing Transition guards for invalid states...");

    // Guard A: Already READY_FOR_EXECUTION
    const ctxA = buildMockScheduledContext("BUY_LIMIT", "READY_FOR_EXECUTION");
    const resA = evaluatePriceMonitor(ctxA, 2025);
    if (
      resA.order.executionStatus === "READY_FOR_EXECUTION" &&
      resA.order.lastEvaluation.result === "IGNORED_ALREADY_READY"
    ) {
      console.log("  PASS: Guard ignored already READY_FOR_EXECUTION context.");
    } else {
      console.error("  FAIL: Guard did not ignore already ready context:", resA.order);
      passed = false;
    }

    // Guard B: Completed/Executed stage
    const ctxB = buildMockScheduledContext("BUY_LIMIT", "EXECUTED");
    const resB = evaluatePriceMonitor(ctxB, 2025);
    if (
      resB.order.executionStatus === "EXECUTED" &&
      resB.order.lastEvaluation.result === "IGNORED_INVALID_STAGE"
    ) {
      console.log("  PASS: Guard ignored EXECUTED stage context.");
    } else {
      console.error("  FAIL: Guard did not ignore EXECUTED context:", resB.order);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 6:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL PRICE MONITOR TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("PRICE MONITOR TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
