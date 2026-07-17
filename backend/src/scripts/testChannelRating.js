import assert from "assert";
import mongoose from "mongoose";
import { ValidationChannelStats } from "../models/validationChannelStatsModel.js";
import { evaluateChannelRating, RELIABILITY_WEIGHTS, MIN_SIGNALS_THRESHOLD } from "../services/signalChannelRatingService.js";

// Mock Database Document Store for testing stateless service
class MockStatsDoc {
  constructor(data = {}) {
    this.channelName = data.channelName || "TestChannel";
    this.sampleStatus = data.sampleStatus || "INSUFFICIENT_DATA";
    this.totalSignals = data.totalSignals || 0;
    this.executedSignals = data.executedSignals || 0;
    this.filledSignals = data.filledSignals || 0;
    this.fullTP = data.fullTP || 0;
    this.slHit = data.slHit || 0;
    this.manualClose = data.manualClose || 0;
    this.cancelled = data.cancelled || 0;
    this.expired = data.expired || 0;
    this.unknown = data.unknown || 0;
    this.totalPips = data.totalPips || 0;
    this.grossWinsPips = data.grossWinsPips || 0;
    this.grossLossPips = data.grossLossPips || 0;
    this.totalTradeDuration = data.totalTradeDuration || 0;

    // Derived
    this.winRate = data.winRate || 0;
    this.fillRate = data.fillRate || 0;
    this.averagePips = data.averagePips || 0;
    this.averageTradeDuration = data.averageTradeDuration || 0;
    this.profitFactor = data.profitFactor || null;
    this.reliabilityScore = data.reliabilityScore || 0;

    this.firstTradeAt = data.firstTradeAt || null;
    this.lastTradeAt = data.lastTradeAt || null;
    this.lastUpdated = data.lastUpdated || null;

    this.saveCount = 0;
  }

  async save() {
    this.saveCount += 1;
    return this;
  }
}

function buildMockCompletedContext(overrides = {}) {
  return {
    signalId: 8001,
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
    pipelineStatus: "COMPLETED",
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
      result: "FULL_TP",
      closedAt: "2026-07-17T12:10:05.000Z",
      closePrice: 2045.0,
      profit: 15.5,
      pips: 150.0,
      tradeDuration: 600
    },
    rating: {
      processed: false,
      processedAt: null
    },
    ...overrides
  };
}

async function runTests() {
  console.log("=== Channel Rating Engine Scenario Test Suite ===\n");
  let passed = true;

  // Stubs finding/creating records
  let mockDocStore = new Map();
  ValidationChannelStats.findOne = async (query) => {
    const ch = query.channelName;
    if (!mockDocStore.has(ch)) {
      mockDocStore.set(ch, new MockStatsDoc({ channelName: ch }));
    }
    return mockDocStore.get(ch);
  };

  // Test 1: FULL_TP walkthrough (increments fullTP, totalPips, winRate, reliability)
  try {
    console.log("[Test 1] Testing FULL_TP walkthrough...");
    mockDocStore.clear();

    const ctx = buildMockCompletedContext();
    const rated = await evaluateChannelRating(ctx);
    const doc = mockDocStore.get("TestChannel");

    assert(rated.rating.processed === true, "Rating processed flag should be true.");
    assert(rated.rating.processedAt !== null, "Processed timestamp should be set.");
    assert(doc.totalSignals === 1, "totalSignals should be 1.");
    assert(doc.fullTP === 1, "fullTP should be 1.");
    assert(doc.winRate === 1.0, "winRate should be 1.0.");
    assert(doc.fillRate === 1.0, "fillRate should be 1.0.");
    assert(doc.averagePips === 150.0, "averagePips should be 150.0.");
    assert(doc.grossWinsPips === 150.0, "grossWinsPips should be 150.0.");
    assert(doc.profitFactor === 99.99, "profitFactor should be 99.99.");
    assert(doc.sampleStatus === "INSUFFICIENT_DATA", "Less than 20 signals should be INSUFFICIENT_DATA.");
    assert(doc.saveCount === 1, "save() should have been called.");

    console.log("  PASS: Properly calculated FULL_TP derived stats and persisted document.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 1:", err.message);
    passed = false;
  }

  // Test 2: SL_HIT walkthrough (winRate drops, grossLossPips updates, profitFactor drops)
  try {
    console.log("\n[Test 2] Testing SL_HIT walkthrough...");
    mockDocStore.clear();

    // 1st Trade: TP
    const ctx1 = buildMockCompletedContext();
    await evaluateChannelRating(ctx1);

    // 2nd Trade: SL
    const ctx2 = buildMockCompletedContext({
      signalId: 8002,
      monitoring: {
        status: "POSITION_CLOSED",
        startedAt: "2026-07-17T12:00:02.000Z",
        lastUpdate: "2026-07-17T12:05:00.000Z",
        lastKnownPrice: 2020.0,
        positionOpenedAt: "2026-07-17T12:00:05.000Z",
        positionClosedAt: "2026-07-17T12:05:05.000Z",
        closeReason: "SL"
      },
      outcome: {
        result: "SL_HIT",
        closedAt: "2026-07-17T12:05:05.000Z",
        closePrice: 2020.0,
        profit: -10.0,
        pips: -100.0,
        tradeDuration: 300
      }
    });

    await evaluateChannelRating(ctx2);
    const doc = mockDocStore.get("TestChannel");

    assert(doc.totalSignals === 2, "totalSignals should be 2.");
    assert(doc.fullTP === 1, "fullTP should be 1.");
    assert(doc.slHit === 1, "slHit should be 1.");
    assert(doc.winRate === 0.5, "winRate should drop to 0.5.");
    assert(doc.totalPips === 50.0, "totalPips should be 50.0.");
    assert(doc.grossWinsPips === 150.0, "grossWinsPips should be 150.0.");
    assert(doc.grossLossPips === 100.0, "grossLossPips should be 100.0.");
    assert(doc.profitFactor === 1.5, "profitFactor should recalculate to 1.5 (150/100).");
    assert(doc.averagePips === 25.0, "averagePips should be 25.0.");

    console.log("  PASS: Properly calculated SL metrics and profitFactor ratio.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 2:", err.message);
    passed = false;
  }

  // Test 3: EXPIRED walkthrough (decreases fillRate, winRate remains same)
  try {
    console.log("\n[Test 3] Testing EXPIRED walkthrough...");
    mockDocStore.clear();

    // 1st Trade: TP (Filled)
    const ctx1 = buildMockCompletedContext();
    await evaluateChannelRating(ctx1);

    // 2nd Trade: Expired (Not filled, but executed pending order)
    const ctx2 = buildMockCompletedContext({
      signalId: 8003,
      order: {
        executionStatus: "EXECUTED" // Pending order placed
      },
      monitoring: {
        status: "POSITION_CLOSED",
        positionOpenedAt: null, // never opened
        positionClosedAt: "2026-07-17T12:08:00.000Z",
        closeReason: "EXPIRED"
      },
      outcome: {
        result: "EXPIRED",
        pips: 0,
        profit: 0,
        tradeDuration: 0
      }
    });

    await evaluateChannelRating(ctx2);
    const doc = mockDocStore.get("TestChannel");

    assert(doc.totalSignals === 2, "totalSignals should be 2.");
    assert(doc.executedSignals === 2, "executedSignals should be 2.");
    assert(doc.filledSignals === 1, "filledSignals should stay 1.");
    assert(doc.fillRate === 0.5, "fillRate should drop to 0.5 (1/2).");
    assert(doc.winRate === 1.0, "winRate should stay 1.0 (1/1, expired not counted).");

    console.log("  PASS: Properly reduced fillRate on order expiration.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 3:", err.message);
    passed = false;
  }

  // Test 4: MANUAL_CLOSE walkthrough
  try {
    console.log("\n[Test 4] Testing MANUAL_CLOSE walkthrough...");
    mockDocStore.clear();

    const ctx = buildMockCompletedContext({
      outcome: {
        result: "MANUAL_CLOSE",
        pips: 20.0,
        tradeDuration: 100
      }
    });

    await evaluateChannelRating(ctx);
    const doc = mockDocStore.get("TestChannel");

    assert(doc.manualClose === 1, "manualClose count should be 1.");
    assert(doc.winRate === 0, "winRate is 0 because no TP or SL hit.");
    assert(doc.totalPips === 20.0, "totalPips should accumulate manual close pips.");

    console.log("  PASS: Properly registered manual close without winRate impact.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 4:", err.message);
    passed = false;
  }

  // Test 5: sampleStatus transitions (Sufficient Data threshold check)
  try {
    console.log("\n[Test 5] Testing sampleStatus transitions...");
    mockDocStore.clear();

    const stats = new MockStatsDoc({ channelName: "ThresholdChannel", totalSignals: 19 });
    mockDocStore.set("ThresholdChannel", stats);

    const ctx = buildMockCompletedContext({ channelName: "ThresholdChannel" });
    await evaluateChannelRating(ctx);

    const doc = mockDocStore.get("ThresholdChannel");
    assert(doc.totalSignals === 20, "Signals should reach 20.");
    assert(doc.sampleStatus === "SUFFICIENT_DATA", "Status should transition to SUFFICIENT_DATA.");

    console.log("  PASS: sampleStatus successfully transitioned to SUFFICIENT_DATA at threshold limit.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 5:", err.message);
    passed = false;
  }

  // Test 6: Ingestion Guards
  try {
    console.log("\n[Test 6] Testing Ingestion guards...");

    // Case A: Uncompleted context status
    const ctxA = buildMockCompletedContext({ pipelineStatus: "EXECUTED" });
    const resA = await evaluateChannelRating(ctxA);
    assert(resA === ctxA, "Active pipeline contexts should be ignored.");

    // Case B: Already rated/processed flag
    const ctxB = buildMockCompletedContext();
    ctxB.rating.processed = true;
    const resB = await evaluateChannelRating(ctxB);
    assert(resB === ctxB, "Processed contexts should be ignored.");

    console.log("  PASS: Ingestion guards successfully protected data integrity.");
  } catch (err) {
    console.error("  FAIL: Exception in Test 6:", err.message);
    passed = false;
  }

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL CHANNEL RATING TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("CHANNEL RATING TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
