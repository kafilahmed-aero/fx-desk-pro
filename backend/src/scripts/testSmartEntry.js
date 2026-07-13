import { evaluateEntryStrategy } from "../services/smartEntryEngine.js";

function buildMockUpstream(overrides = {}) {
  return {
    decisionReport: {
      decision: "BUY",
      grade: "GRADE A",
      confidence: 90,
      ...(overrides.decisionReport || {})
    },
    marketContext: {
      overallScore: 85,
      status: "HEALTHY",
      trend: { status: "STRONG_BULLISH" },
      structure: { status: "FAVORABLE" },
      spread: { metrics: { maxSpreadLimit: 3.0 } },
      volatility: { volatilityLevel: "Normal" },
      warnings: [],
      ...(overrides.marketContext || {})
    },
    currentPrice: 2030,
    entryMin: 2028,
    entryMax: 2032,
    stopLoss: 2020,
    takeProfits: [2050, 2060],
    currentSpread: 1.5,
    timestamp: new Date().toISOString(),
    ...overrides
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
  console.log("=== RUNNING SMART ENTRY FRAMEWORK TESTS ===\n");

  // Test 1: MARKET Entry
  console.log("[Test 1] Testing MARKET strategy...");
  const inputsMarket = buildMockUpstream({ currentPrice: 2030 }); // currentPrice is inside [2028, 2032]
  const resMarket = evaluateEntryStrategy(inputsMarket);
  assert(resMarket.recommendedStrategy === "MARKET", "Recommends MARKET when inside the entry zone");
  assert(resMarket.alternativeStrategy === "BUY_LIMIT", "Alternative strategy is BUY_LIMIT");
  assert(resMarket.entryPrice === 2030, "Entry price matches current market price");

  // Test 2: BUY LIMIT (Retracement wait)
  console.log("\n[Test 2] Testing BUY LIMIT strategy...");
  const inputsBuyLimit = buildMockUpstream({ currentPrice: 2035 }); // currentPrice > entryMax (2032)
  const resBuyLimit = evaluateEntryStrategy(inputsBuyLimit);
  assert(resBuyLimit.recommendedStrategy === "BUY_LIMIT", `Recommends BUY_LIMIT (Actual: ${resBuyLimit.recommendedStrategy})`);
  assert(resBuyLimit.alternativeStrategy === "MARKET", "Alternative strategy is MARKET");
  assert(resBuyLimit.entryPrice === 2030, `Entry price set at midpoint 2030 (Actual: ${resBuyLimit.entryPrice})`);

  // Test 3: SELL LIMIT (Retracement wait)
  console.log("\n[Test 3] Testing SELL LIMIT strategy...");
  const inputsSellLimit = buildMockUpstream({
    decisionReport: { decision: "SELL", grade: "GRADE A", confidence: 90 },
    currentPrice: 2025, // currentPrice < entryMin (2028)
    entryMin: 2028,
    entryMax: 2032,
    stopLoss: 2040,
    takeProfits: [2010]
  });
  const resSellLimit = evaluateEntryStrategy(inputsSellLimit);
  assert(resSellLimit.recommendedStrategy === "SELL_LIMIT", `Recommends SELL_LIMIT (Actual: ${resSellLimit.recommendedStrategy})`);
  assert(resSellLimit.alternativeStrategy === "MARKET", "Alternative strategy is MARKET");
  assert(resSellLimit.entryPrice === 2030, `Entry price set at midpoint 2030 (Actual: ${resSellLimit.entryPrice})`);

  // Test 4: BUY STOP (Breakout wait)
  console.log("\n[Test 4] Testing BUY STOP strategy...");
  const inputsBuyStop = buildMockUpstream({ currentPrice: 2025 }); // currentPrice < entryMin (2028)
  const resBuyStop = evaluateEntryStrategy(inputsBuyStop);
  assert(resBuyStop.recommendedStrategy === "BUY_STOP", `Recommends BUY_STOP (Actual: ${resBuyStop.recommendedStrategy})`);
  assert(resBuyStop.entryPrice === 2028, `Entry price set at lower zone boundary 2028 (Actual: ${resBuyStop.entryPrice})`);

  // Test 5: SELL STOP (Breakout wait)
  console.log("\n[Test 5] Testing SELL STOP strategy...");
  const inputsSellStop = buildMockUpstream({
    decisionReport: { decision: "SELL", grade: "GRADE A", confidence: 90 },
    currentPrice: 2035, // currentPrice > entryMax (2032)
    entryMin: 2028,
    entryMax: 2032,
    stopLoss: 2040,
    takeProfits: [2010]
  });
  const resSellStop = evaluateEntryStrategy(inputsSellStop);
  assert(resSellStop.recommendedStrategy === "SELL_STOP", `Recommends SELL_STOP (Actual: ${resSellStop.recommendedStrategy})`);
  assert(resSellStop.entryPrice === 2032, `Entry price set at upper zone boundary 2032 (Actual: ${resSellStop.entryPrice})`);

  // Test 6: Price already near TP (Chasing price filter)
  console.log("\n[Test 6] Testing chasing price filter near TP...");
  const inputsChasing = buildMockUpstream({
    currentPrice: 2048, // Midpoint is 2030, TP is 2050, travelled 18 points (90% of total 20 point range)
    takeProfits: [2050]
  });
  const resChasing = evaluateEntryStrategy(inputsChasing, { maximumTpTravelBeforeReject: 0.8 });
  assert(resChasing.recommendedStrategy === "WAIT", "Chasing price rejected with WAIT recommended strategy");
  assert(resChasing.reasons.some(r => r.includes("chasing risk")), "Cites chasing risk as wait reason");

  // Test 7: Poor RR rejection / optimization
  console.log("\n[Test 7] Testing Risk-to-Reward checks...");
  const inputsPoorRR = buildMockUpstream({
    currentPrice: 2031,
    takeProfits: [2033], // Midpoint is 2030, Reward is 2 points, Risk is 11 points (entryPrice 2031 - SL 2020) -> RR is 0.18
  });
  const resPoorRR = evaluateEntryStrategy(inputsPoorRR, { minimumRR: 1.5 });
  // Recommended strategy should change to BUY_LIMIT or WAIT
  assert(resPoorRR.recommendedStrategy === "WAIT" || resPoorRR.recommendedStrategy === "BUY_LIMIT", `Resolves poor RR strategy correctly (Actual: ${resPoorRR.recommendedStrategy})`);

  // Test 8: Excellent RR
  console.log("\n[Test 8] Testing Excellent RR quality boost...");
  const inputsExc = buildMockUpstream({
    takeProfits: [2090] // Midpoint 2030, SL 2020. Reward = 60, Risk = 10 -> RR is 6.0!
  });
  const resExc = evaluateEntryStrategy(inputsExc, { excellentRR: 3.0 });
  assert(resExc.entryQuality === "GRADE A", `Yields GRADE A execution quality on excellent RR (Actual Quality: ${resExc.entryQuality})`);

  // Test 9: Wide Spread
  console.log("\n[Test 9] Testing wide spread penalty...");
  const inputsSpread = buildMockUpstream({
    currentSpread: 8.0,
    marketContext: {
      spread: { metrics: { maxSpreadLimit: 3.0 } }
    }
  });
  const resSpread = evaluateEntryStrategy(inputsSpread, { maximumSpreadMultiplier: 2.0 });
  // Should deduct quality due to high spread
  assert(resSpread.entryQuality !== "GRADE A", `High spread reduces quality grade (Actual: ${resSpread.entryQuality})`);

  // Test 10: Decision HOLD
  console.log("\n[Test 10] Testing Decision Engine HOLD state handling...");
  const inputsHold = buildMockUpstream({
    decisionReport: { decision: "HOLD", grade: "REJECT" }
  });
  const resHold = evaluateEntryStrategy(inputsHold);
  assert(resHold.recommendedStrategy === "WAIT", "HOLD decision triggers WAIT recommended strategy");

  // Test 11: Invalid Parameters
  console.log("\n[Test 11] Testing invalid parameters fallback...");
  const inputsInvalid = buildMockUpstream({
    takeProfits: []
  });
  const resInvalid = evaluateEntryStrategy(inputsInvalid);
  assert(resInvalid.recommendedStrategy === "WAIT", "Invalid inputs fallback to WAIT recommended strategy");
  assert(resInvalid.reasons.some(r => r.includes("missing")), "Cites invalid/missing parameters");

  // Test 12: Deep Freeze
  console.log("\n[Test 12] Testing deep freeze validation...");
  const resFreeze = evaluateEntryStrategy(buildMockUpstream());
  assert(Object.isFrozen(resFreeze), "Root report object is frozen");
  assert(Object.isFrozen(resFreeze.entryZone), "entryZone parameter is frozen");
  assert(Object.isFrozen(resFreeze.takeProfits), "takeProfits array is frozen");
  let mutationFailed = false;
  try {
    resFreeze.recommendedStrategy = "EXPLOIT";
  } catch (err) {
    mutationFailed = true;
  }
  assert(mutationFailed, "Attempted mutation throws write error");

  // Test 13: Determinism
  console.log("\n[Test 13] Testing determinism across repeated executions...");
  const resD1 = evaluateEntryStrategy(buildMockUpstream());
  const resD2 = evaluateEntryStrategy(buildMockUpstream());
  assert(resD1.recommendedStrategy === resD2.recommendedStrategy, "Strategies match exactly");
  assert(resD1.entryPrice === resD2.entryPrice, "Entry prices match exactly");
  assert(JSON.stringify(resD1.entryZone) === JSON.stringify(resD2.entryZone), "Entry zones match exactly");

  // Test 14: Regression compatibility
  console.log("\n[Test 14] Testing output schema structure...");
  const requiredFields = [
    "recommendedStrategy", "alternativeStrategy", "entryZone", "entryPrice",
    "stopLoss", "takeProfits", "expectedRR", "expectedReward", "expectedRisk",
    "probability", "entryQuality", "reasons", "warnings", "timestamp"
  ];
  let schemaMatch = true;
  requiredFields.forEach(f => {
    if (resMarket[f] === undefined) {
      schemaMatch = false;
      console.error(`Field ${f} is missing from response`);
    }
  });
  assert(schemaMatch, "All required schema elements exist");

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
