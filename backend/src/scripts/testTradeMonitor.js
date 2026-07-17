import assert from "assert";
import { evaluateTradeMonitor } from "../services/signalTradeMonitorService.js";

function buildMockExecutedContext(overrides = {}) {
  return {
    signalId: 5001,
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
      fillPrice: 2030.15,
      executedAt: "2026-07-17T12:00:05.000Z",
      executionResult: "SUCCESS"
    },
    monitoring: {
      status: "NOT_STARTED",
      startedAt: null,
      lastUpdate: null,
      lastKnownPrice: null,
      positionOpenedAt: null,
      positionClosedAt: null,
      closeReason: null
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
  console.log("=== Trade Monitor Scenario Test Suite ===\n");
  let passed = true;

  // Test 1: POSITION_OPENED walkthrough (ORDER_FILLED)
  try {
    console.log("[Test 1] Testing POSITION_OPENED transition...");
    const ctx = buildMockExecutedContext();
    const payload = {
      event: "ORDER_FILLED",
      recommendationId: "5001",
      ticket: 882200,
      fillPrice: 2030.15,
      fillTime: "2026-07-17T12:00:05.000Z"
    };

    const monitored = evaluateTradeMonitor(ctx, payload);
    const mon = monitored.monitoring;

    if (
      monitored.pipelineStatus === "EXECUTED" && // pipelineStatus remains EXECUTED
      mon.status === "POSITION_OPEN" &&
      mon.lastEvent === "POSITION_OPENED" &&
      mon.positionOpenedAt === "2026-07-17T12:00:05.000Z" &&
      mon.lastKnownPrice === 2030.15 &&
      mon.lastEventTimestamp !== undefined &&
      monitored.order.ticket === "882200" // execution data preserved
    ) {
      console.log("  PASS: Properly normalized POSITION_OPENED deal.");
    } else {
      console.error("  FAIL: POSITION_OPENED transition mismatch:", mon);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: POSITION_UPDATED walkthrough (TICK)
  try {
    console.log("\n[Test 2] Testing POSITION_UPDATED transition (TICK)...");
    const ctx = buildMockExecutedContext();
    const payload = {
      event: "TICK",
      price: 2032.5
    };

    const monitored = evaluateTradeMonitor(ctx, payload);
    const mon = monitored.monitoring;

    if (
      mon.status === "MONITORING" &&
      mon.lastEvent === "POSITION_UPDATED" &&
      mon.lastKnownPrice === 2032.5 &&
      mon.positionOpenedAt === null
    ) {
      console.log("  PASS: Properly normalized POSITION_UPDATED price tick.");
    } else {
      console.error("  FAIL: POSITION_UPDATED transition mismatch:", mon);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: POSITION_CLOSED walkthrough (TP reason)
  try {
    console.log("\n[Test 3] Testing Take Profit (TP) closed transition...");
    const ctx = buildMockExecutedContext({
      monitoring: {
        status: "POSITION_OPEN",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:00:05.000Z",
        lastKnownPrice: 2030.15,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: null,
        closeReason: null
      }
    });

    const payload = {
      event: "ORDER_CLOSED",
      exitPrice: 2045.0,
      exitTime: "2026-07-17T12:10:00.000Z",
      reason: "TP"
    };

    const monitored = evaluateTradeMonitor(ctx, payload);
    const mon = monitored.monitoring;

    if (
      mon.status === "POSITION_CLOSED" &&
      mon.lastEvent === "POSITION_CLOSED" &&
      mon.positionClosedAt === "2026-07-17T12:10:00.000Z" &&
      mon.lastKnownPrice === 2045.0 &&
      mon.closeReason === "TP"
    ) {
      console.log("  PASS: Properly normalized TP closed deal.");
    } else {
      console.error("  FAIL: TP closed mismatch:", mon);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Test 4: Stop Loss (SL) closed walkthrough
  try {
    console.log("\n[Test 4] Testing Stop Loss (SL) closed transition...");
    const ctx = buildMockExecutedContext({
      monitoring: {
        status: "POSITION_OPEN",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:00:05.000Z",
        lastKnownPrice: 2030.15,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: null,
        closeReason: null
      }
    });

    const payload = {
      event: "ORDER_CLOSED",
      exitPrice: 2020.0,
      exitTime: "2026-07-17T12:05:00.000Z",
      reason: "SL"
    };

    const monitored = evaluateTradeMonitor(ctx, payload);
    const mon = monitored.monitoring;

    if (
      mon.status === "POSITION_CLOSED" &&
      mon.closeReason === "SL" &&
      mon.positionClosedAt === "2026-07-17T12:05:00.000Z"
    ) {
      console.log("  PASS: Properly normalized SL closed deal.");
    } else {
      console.error("  FAIL: SL closed mismatch:", mon);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 4:", err.message);
    passed = false;
  }

  // Test 5: Manual close walkthrough
  try {
    console.log("\n[Test 5] Testing Manual closed transition...");
    const ctx = buildMockExecutedContext({
      monitoring: {
        status: "POSITION_OPEN",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:00:05.000Z",
        lastKnownPrice: 2030.15,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: null,
        closeReason: null
      }
    });

    const payload = {
      event: "ORDER_CLOSED",
      exitPrice: 2035.5,
      exitTime: "2026-07-17T12:08:00.000Z",
      reason: "MANUAL"
    };

    const monitored = evaluateTradeMonitor(ctx, payload);
    const mon = monitored.monitoring;

    if (
      mon.status === "POSITION_CLOSED" &&
      mon.closeReason === "MANUAL" &&
      mon.positionClosedAt === "2026-07-17T12:08:00.000Z"
    ) {
      console.log("  PASS: Properly normalized MANUAL close deal.");
    } else {
      console.error("  FAIL: MANUAL close mismatch:", mon);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 5:", err.message);
    passed = false;
  }

  // Test 6: Expired order walkthrough
  try {
    console.log("\n[Test 6] Testing EXPIRED closed transition...");
    const ctx = buildMockExecutedContext();
    const payload = {
      event: "ORDER_CLOSED",
      exitPrice: 2030,
      exitTime: "2026-07-17T12:08:00.000Z",
      reason: "EXPIRED"
    };

    const monitored = evaluateTradeMonitor(ctx, payload);
    const mon = monitored.monitoring;

    if (
      mon.status === "POSITION_CLOSED" &&
      mon.closeReason === "EXPIRED"
    ) {
      console.log("  PASS: Properly normalized EXPIRED close deal.");
    } else {
      console.error("  FAIL: EXPIRED close mismatch:", mon);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Test 6:", err.message);
    passed = false;
  }

  // Test 7: Ingestion guards
  try {
    console.log("\n[Test 7] Testing Ingestion guards for non-executed contexts...");

    // Case A: Unscheduled pipelineStatus
    const ctxA = buildMockExecutedContext({ pipelineStatus: "SCHEDULED" });
    const resA = evaluateTradeMonitor(ctxA, { event: "TICK", price: 2030 });
    assert(resA === ctxA, "Unexecuted contexts should be bypassed immediately.");

    // Case B: READY_FOR_EXECUTION executionStatus
    const ctxB = buildMockExecutedContext();
    ctxB.order.executionStatus = "READY_FOR_EXECUTION";
    const resB = evaluateTradeMonitor(ctxB, { event: "TICK", price: 2030 });
    assert(resB === ctxB, "Ready execution contexts should be bypassed immediately.");

    console.log("  PASS: Guards bypassed non-executed contexts cleanly.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 7:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL MONITOR TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("MONITOR TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
