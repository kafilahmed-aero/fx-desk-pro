import { scheduleSignalExecution } from "../services/signalExecutionSchedulerService.js";

function buildMockPlannedContext(type = "MARKET", overrides = {}) {
  return {
    signalId: 2001,
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
    pipelineStatus: "PLANNED",
    executionStatus: "NOT_STARTED",
    order: {
      type,
      plannedEntry: 2030,
      entryZone: { lower: 2030, upper: 2030 },
      currentMarketPrice: 2030,
      planningTimestamp: "2026-07-17T12:00:01.000Z",
      planningReason: type === "MARKET" ? "PRICE_INSIDE_ENTRY_ZONE" : "BUY_ENTRY_ABOVE_MARKET",
      status: "PLANNED",
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

// Emulates Stage 4 consumer check
function shouldExecuteStage4(context) {
  return context.pipelineStatus === "SCHEDULED" && context.order?.executionStatus === "READY_FOR_EXECUTION";
}

async function runTests() {
  console.log("=== Execution Scheduler Scenario Test Suite ===\n");
  let passed = true;

  // Test 1: MARKET order scheduling
  try {
    console.log("[Test 1] Testing MARKET order scheduling...");
    const ctx = buildMockPlannedContext("MARKET");
    const scheduled = scheduleSignalExecution(ctx);

    if (
      scheduled.pipelineStatus === "SCHEDULED" &&
      scheduled.order.executionMode === "MARKET" &&
      scheduled.order.executionStatus === "READY_FOR_EXECUTION" &&
      scheduled.order.schedulerReason === "MARKET_ORDER" &&
      scheduled.order.nextEvaluationTime === null &&
      scheduled.order.status === "PLANNED" && // planning data preserved
      shouldExecuteStage4(scheduled) === true
    ) {
      console.log("  PASS: Properly scheduled MARKET order. Meets Stage 4 execution contract.");
    } else {
      console.error("  FAIL: Market schedule mismatch:", scheduled);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: PENDING (BUY_STOP) order scheduling
  try {
    console.log("\n[Test 2] Testing PENDING (BUY_STOP) order scheduling...");
    const ctx = buildMockPlannedContext("BUY_STOP");
    const scheduled = scheduleSignalExecution(ctx);

    if (
      scheduled.pipelineStatus === "SCHEDULED" &&
      scheduled.order.executionMode === "PENDING" &&
      scheduled.order.executionStatus === "WAITING_FOR_PRICE" &&
      scheduled.order.schedulerReason === "PENDING_ORDER" &&
      scheduled.order.nextEvaluationTime === null &&
      shouldExecuteStage4(scheduled) === false
    ) {
      console.log("  PASS: Properly scheduled PENDING order. Bypasses Stage 4 execution bridge contract.");
    } else {
      console.error("  FAIL: Pending schedule mismatch:", scheduled);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: Immutability check
  try {
    console.log("\n[Test 3] Asserting scheduled context is frozen...");
    const ctx = buildMockPlannedContext("MARKET");
    const scheduled = scheduleSignalExecution(ctx);
    scheduled.order.executionStatus = "MUTATED";
    console.error("  FAIL: Mutation did not throw an error.");
    passed = false;
  } catch (err) {
    console.log("  PASS: Mutation thrown successfully. Immutability enforced.");
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL SCHEDULER TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("SCHEDULER TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
