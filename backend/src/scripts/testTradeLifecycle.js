import { evaluateTradeLifecycle } from "../services/tradeLifecycleManager.js";

function buildMockInputs(overrides = {}) {
  const base = {
    position: {
      ticket: "123456",
      type: "BUY",
      openPrice: 2000.0,
      currentPrice: 2000.0,
      sl: 1985.0,
      tp: 2045.0,
      volume: 0.1,
      timeOpen: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 mins ago
      lifecycleState: "POSITION_OPEN",
      partiallyClosedStages: []
    },
    marketContext: {
      overallScore: 85,
      status: "HEALTHY",
      trend: { status: "STRONG_BULLISH" },
      structure: { status: "FAVORABLE" },
      spread: { metrics: { maxSpreadLimit: 3.0 } }
    },
    currentSpread: 1.5,
    timestamp: new Date().toISOString()
  };

  return {
    ...base,
    ...overrides,
    position: {
      ...base.position,
      ...(overrides.position || {})
    },
    marketContext: {
      ...base.marketContext,
      ...(overrides.marketContext || {})
    }
  };
}

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log("=== RUNNING TRADE LIFECYCLE MANAGER TESTS ===\n");

  // Test 1: Initial HOLD (no triggers met)
  console.log("[Test 1] Testing Initial HOLD...");
  const inputsHold = buildMockInputs({
    position: { currentPrice: 2005.0 } // 50 points profit -> below 100 points break-even trigger
  });
  const resHold = evaluateTradeLifecycle(inputsHold);
  assert(resHold.lifecycleAction === "HOLD_POSITION", "Holds position when no triggers are met");
  assert(resHold.nextState === "POSITION_OPEN", "Stays in POSITION_OPEN state");

  // Test 2: Break-even Move
  console.log("\n[Test 2] Testing Break-even triggers...");
  const inputsBE = buildMockInputs({
    position: { currentPrice: 2110.0 } // 110 points profit -> meets 100 points trigger
  });
  const resBE = evaluateTradeLifecycle(inputsBE, { partialProfitStages: [] });
  assert(resBE.lifecycleAction === "MOVE_SL_TO_BREAKEVEN", "Moves SL to break-even");
  assert(resBE.nextState === "BREAK_EVEN_PROTECTED", "Transitions to BREAK_EVEN_PROTECTED state");
  assert(resBE.stopLoss === 2010.0, `Sets SL to open price + offset of 10.0 points (Actual SL: ${resBE.stopLoss})`);

  // Test 3: Break-even Idempotency
  console.log("\n[Test 3] Testing Break-even idempotency...");
  const inputsBEAlready = buildMockInputs({
    position: {
      currentPrice: 2005.0,
      sl: 2010.0, // SL already at breakeven
      lifecycleState: "BREAK_EVEN_PROTECTED"
    }
  });
  const resBEAlready = evaluateTradeLifecycle(inputsBEAlready, { partialProfitStages: [] });
  assert(resBEAlready.lifecycleAction === "HOLD_POSITION", "Holds position if break-even has already been applied");
  assert(resBEAlready.nextState === "BREAK_EVEN_PROTECTED", "Stays in BREAK_EVEN_PROTECTED state");

  // Test 4: Trailing Stop Move
  console.log("\n[Test 4] Testing Trailing Stop adjustment...");
  const inputsTrailNoStep = buildMockInputs({
    position: {
      currentPrice: 2170.0, // Target SL 2020. Change (10) < step (20) -> Hold
      sl: 2010.0,
      lifecycleState: "BREAK_EVEN_PROTECTED"
    }
  });
  const resTrailNoStep = evaluateTradeLifecycle(inputsTrailNoStep, { partialProfitStages: [] });
  assert(resTrailNoStep.lifecycleAction === "HOLD_POSITION", "Holds position if trailing step is not met");

  const inputsTrailStep = buildMockInputs({
    position: {
      currentPrice: 2190.0, // Target SL 2040. Change (30) >= step (20) -> Trail
      sl: 2010.0,
      lifecycleState: "BREAK_EVEN_PROTECTED"
    }
  });
  const resTrailStep = evaluateTradeLifecycle(inputsTrailStep, { partialProfitStages: [] });
  assert(resTrailStep.lifecycleAction === "TRAIL_STOP", "Trailing stop triggered on sufficient step change");
  assert(resTrailStep.stopLoss === 2040.0, `Trails SL correctly (Actual SL: ${resTrailStep.stopLoss})`);

  // Test 5: Trailing never worsens SL
  console.log("\n[Test 5] Testing Trailing never worsens SL...");
  const inputsWorsen = buildMockInputs({
    position: {
      currentPrice: 2160.0, // Target SL is 2010
      sl: 2030.0, // Existing SL is better
      lifecycleState: "TRAILING_ACTIVE"
    }
  });
  const resWorsen = evaluateTradeLifecycle(inputsWorsen, { partialProfitStages: [] });
  assert(resWorsen.lifecycleAction === "HOLD_POSITION", "Does not trail when target SL is worse than current SL");
  assert(resWorsen.stopLoss === 2030.0, "Keeps existing better stop loss");

  // Test 6: Partial TP1
  console.log("\n[Test 6] Testing Partial TP1 stage trigger...");
  // slAtEntry is 1985 (15 points risk). CurrentPrice is 2016 (16 points profit). RR ratio is 16/15 = 1.06 (meets stage 1 triggerRR = 1)
  const inputsTP1 = buildMockInputs({
    position: {
      currentPrice: 2016.0,
      slAtEntry: 1985.0
    }
  });
  const resTP1 = evaluateTradeLifecycle(inputsTP1);
  assert(resTP1.lifecycleAction === "PARTIAL_CLOSE", "Recommends PARTIAL_CLOSE for TP1 stage");
  assert(resTP1.nextState === "PARTIAL_TP1", "Transitions to PARTIAL_TP1 state");
  assert(resTP1.partialClosePercent === 30, "Closes 30% of the volume");
  assert(resTP1.remainingVolume === 0.07, "Calculates remaining volume correctly");

  // Test 7: Partial TP2
  console.log("\n[Test 7] Testing Partial TP2 stage trigger...");
  const inputsTP2 = buildMockInputs({
    position: {
      currentPrice: 2032.0, // profit = 32 points. Risk = 15. RR = 2.13 (meets triggerRR = 2)
      slAtEntry: 1985.0,
      partiallyClosedStages: [1], // TP1 stage already completed
      lifecycleState: "PARTIAL_TP1"
    }
  });
  const resTP2 = evaluateTradeLifecycle(inputsTP2);
  assert(resTP2.lifecycleAction === "PARTIAL_CLOSE", "Recommends PARTIAL_CLOSE for TP2 stage");
  assert(resTP2.nextState === "PARTIAL_TP2", "Transitions to PARTIAL_TP2 state");

  // Test 8: Final TP (Stage 3)
  console.log("\n[Test 8] Testing Final TP Stage trigger...");
  const inputsTP3 = buildMockInputs({
    position: {
      currentPrice: 2046.0, // profit = 46. Risk = 15. RR = 3.06 (meets triggerRR = 3)
      slAtEntry: 1985.0,
      partiallyClosedStages: [1, 2],
      lifecycleState: "PARTIAL_TP2"
    }
  });
  const resTP3 = evaluateTradeLifecycle(inputsTP3);
  assert(resTP3.lifecycleAction === "PARTIAL_CLOSE", "Recommends PARTIAL_CLOSE for final stage");
  assert(resTP3.nextState === "POSITION_CLOSED", "Transitions to POSITION_CLOSED state");
  assert(resTP3.partialClosePercent === 40, "Closes remaining 40% of the stage limits");

  // Test 9: Time exit
  console.log("\n[Test 9] Testing Time Exit on stagnant progress...");
  const inputsTimeExit = buildMockInputs({
    position: {
      currentPrice: 2010.0, // Progress is 10 points (which is < 20 points minimumProgressPoints)
      timeOpen: new Date(Date.now() - 130 * 60 * 1000).toISOString() // 130 mins open (exceeds 120 mins)
    }
  });
  const resTimeExit = evaluateTradeLifecycle(inputsTimeExit);
  assert(resTimeExit.lifecycleAction === "FULL_CLOSE", "Forces FULL_CLOSE time exit");
  assert(resTimeExit.nextState === "POSITION_CLOSED", "Transitions to POSITION_CLOSED");

  // Test 10: Time exceeded but trend still healthy
  console.log("\n[Test 10] Testing time exceeded with healthy progress...");
  const inputsTimeProgress = buildMockInputs({
    position: {
      currentPrice: 2035.0, // Progress is 35 points (exceeds 20 points limit)
      timeOpen: new Date(Date.now() - 130 * 60 * 1000).toISOString()
    }
  });
  const resTimeProgress = evaluateTradeLifecycle(inputsTimeProgress, { partialProfitStages: [] });
  assert(resTimeProgress.lifecycleAction === "HOLD_POSITION", "Holds position if progress is healthy despite age");

  // Test 11: Market Deterioration exit
  console.log("\n[Test 11] Testing Market Deterioration exits...");
  const inputsDeterioration = buildMockInputs({
    marketContext: {
      overallScore: 35, // Below exit threshold 50
      trend: { status: "STRONG_BEARISH" }, // Opposite trend to BUY position
      structure: { status: "UNFAVORABLE" }
    }
  });
  const resDeterioration = evaluateTradeLifecycle(inputsDeterioration);
  assert(resDeterioration.lifecycleAction === "FULL_CLOSE", "Exits immediately on market deterioration");
  assert(resDeterioration.nextState === "POSITION_CLOSED", "Transitions to POSITION_CLOSED");

  // Test 12: Emergency Spread
  console.log("\n[Test 12] Testing Emergency Spread freeze lock...");
  const inputsSpread = buildMockInputs({
    position: {
      currentPrice: 2190.0,
      sl: 2010.0,
      lifecycleState: "BREAK_EVEN_PROTECTED"
    },
    currentSpread: 10.5 // Exceeds emergency threshold
  });
  const resSpread = evaluateTradeLifecycle(inputsSpread, { partialProfitStages: [] });
  assert(resSpread.lifecycleAction === "HOLD_POSITION", "Freezes trailing stops when emergency spread is active");
  assert(resSpread.stopLoss === 2010.0, "Maintains existing Stop Loss");

  // Test 13: Deep Freeze Immutability
  console.log("\n[Test 13] Testing deep freeze validation...");
  const resFreeze = evaluateTradeLifecycle(buildMockInputs());
  assert(Object.isFrozen(resFreeze), "Root report is frozen");
  assert(Object.isFrozen(resFreeze.reasons), "reasons array is frozen");
  let mutationFailed = false;
  try {
    resFreeze.lifecycleState = "HACKED";
  } catch (err) {
    mutationFailed = true;
  }
  assert(mutationFailed, "Attempted write throws error");

  // Test 14: Determinism
  console.log("\n[Test 14] Testing determinism across repeated executions...");
  const resD1 = evaluateTradeLifecycle(buildMockInputs());
  const resD2 = evaluateTradeLifecycle(buildMockInputs());
  assert(resD1.lifecycleAction === resD2.lifecycleAction, "Actions match exactly");
  assert(resD1.stopLoss === resD2.stopLoss, "Stop losses match exactly");
  assert(resD1.nextState === resD2.nextState, "States match exactly");

  // Test 15: Regression Compatibility
  console.log("\n[Test 15] Testing schema regression checks...");
  const requiredFields = [
    "lifecycleState", "lifecycleAction", "previousState", "nextState",
    "stopLoss", "remainingVolume", "partialClosePercent", "lifecycleScore",
    "reasons", "warnings", "timestamp"
  ];
  let schemaMatch = true;
  requiredFields.forEach(f => {
    if (resBE[f] === undefined) {
      schemaMatch = false;
      console.error(`Field ${f} is missing from response`);
    }
  });
  assert(schemaMatch, "All required schema elements are present");

  console.log("\n==============================================");
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log("==============================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
