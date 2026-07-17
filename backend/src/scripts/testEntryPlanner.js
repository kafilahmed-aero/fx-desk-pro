import { planSignalEntry } from "../services/signalEntryPlannerService.js";

function buildMockContext(overrides = {}) {
  return {
    signalId: 1001,
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
    pipelineStatus: "VALIDATED",
    executionStatus: "NOT_STARTED",
    order: {
      type: null,
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
  console.log("=== Entry Planner Scenario Test Suite ===\n");
  let passed = true;

  // Scenario 1: BUY Market (inside entry zone range)
  try {
    console.log("[Scenario 1] Testing BUY Market (inside entry zone)...");
    const ctx = buildMockContext({
      direction: "BUY",
      entry: 2032.5,
      entryFrom: 2030,
      entryTo: 2035
    });

    const planned = planSignalEntry(ctx, 2032);
    const ord = planned.order;

    if (
      ord.type === "MARKET" &&
      ord.planningReason === "PRICE_INSIDE_ENTRY_ZONE" &&
      ord.plannedEntry === 2032.5 &&
      ord.entryZone.lower === 2030 &&
      ord.entryZone.upper === 2035 &&
      ord.status === "PLANNED"
    ) {
      console.log("  PASS: Properly planned MARKET order type for BUY inside range.");
    } else {
      console.error("  FAIL: BUY Market plan mismatch:", ord);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Scenario 1:", err.message);
    passed = false;
  }

  // Scenario 2: BUY Stop (price below entry)
  try {
    console.log("\n[Scenario 2] Testing BUY Stop (price below entry)...");
    const ctx = buildMockContext({
      direction: "BUY",
      entry: 2030
    });

    const planned = planSignalEntry(ctx, 2025);
    const ord = planned.order;

    if (
      ord.type === "BUY_STOP" &&
      ord.planningReason === "BUY_ENTRY_ABOVE_MARKET" &&
      ord.plannedEntry === 2030 &&
      ord.entryZone.lower === 2030 &&
      ord.entryZone.upper === 2030
    ) {
      console.log("  PASS: Properly planned BUY_STOP order type.");
    } else {
      console.error("  FAIL: BUY Stop plan mismatch:", ord);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Scenario 2:", err.message);
    passed = false;
  }

  // Scenario 3: BUY Limit (price above entry)
  try {
    console.log("\n[Scenario 3] Testing BUY Limit (price above entry)...");
    const ctx = buildMockContext({
      direction: "BUY",
      entry: 2030
    });

    const planned = planSignalEntry(ctx, 2035);
    const ord = planned.order;

    if (
      ord.type === "BUY_LIMIT" &&
      ord.planningReason === "BUY_ENTRY_BELOW_MARKET" &&
      ord.plannedEntry === 2030
    ) {
      console.log("  PASS: Properly planned BUY_LIMIT order type.");
    } else {
      console.error("  FAIL: BUY Limit plan mismatch:", ord);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Scenario 3:", err.message);
    passed = false;
  }

  // Scenario 4: SELL Market (inside entry zone range)
  try {
    console.log("\n[Scenario 4] Testing SELL Market (inside entry zone)...");
    const ctx = buildMockContext({
      direction: "SELL",
      entry: 2032.5,
      entryFrom: 2035,
      entryTo: 2030
    });

    const planned = planSignalEntry(ctx, 2033);
    const ord = planned.order;

    if (
      ord.type === "MARKET" &&
      ord.planningReason === "PRICE_INSIDE_ENTRY_ZONE" &&
      ord.plannedEntry === 2032.5 &&
      ord.entryZone.lower === 2030 &&
      ord.entryZone.upper === 2035
    ) {
      console.log("  PASS: Properly planned MARKET order type for SELL inside range.");
    } else {
      console.error("  FAIL: SELL Market plan mismatch:", ord);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Scenario 4:", err.message);
    passed = false;
  }

  // Scenario 5: SELL Stop (price above entry)
  try {
    console.log("\n[Scenario 5] Testing SELL Stop (price above entry)...");
    const ctx = buildMockContext({
      direction: "SELL",
      entry: 2030
    });

    const planned = planSignalEntry(ctx, 2035);
    const ord = planned.order;

    if (
      ord.type === "SELL_STOP" &&
      ord.planningReason === "SELL_ENTRY_BELOW_MARKET" &&
      ord.plannedEntry === 2030
    ) {
      console.log("  PASS: Properly planned SELL_STOP order type.");
    } else {
      console.error("  FAIL: SELL Stop plan mismatch:", ord);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Scenario 5:", err.message);
    passed = false;
  }

  // Scenario 6: SELL Limit (price below entry)
  try {
    console.log("\n[Scenario 6] Testing SELL Limit (price below entry)...");
    const ctx = buildMockContext({
      direction: "SELL",
      entry: 2030
    });

    const planned = planSignalEntry(ctx, 2025);
    const ord = planned.order;

    if (
      ord.type === "SELL_LIMIT" &&
      ord.planningReason === "SELL_ENTRY_ABOVE_MARKET" &&
      ord.plannedEntry === 2030
    ) {
      console.log("  PASS: Properly planned SELL_LIMIT order type.");
    } else {
      console.error("  FAIL: SELL Limit plan mismatch:", ord);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Scenario 6:", err.message);
    passed = false;
  }

  // Asserting Context is deeply frozen
  try {
    console.log("\n[Immutability Check] Asserting context frozen status...");
    const ctx = buildMockContext();
    const planned = planSignalEntry(ctx, 2025);
    planned.order.type = "MUTATED";
    console.error("  FAIL: Immutability not enforced (mutating did not throw).");
    passed = false;
  } catch (err) {
    console.log("  PASS: Mutation thrown successfully. Immutability enforced.");
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL SCENARIO TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("SCENARIO TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
