import { evaluateMarketOpportunity } from "../services/decisionEngine.js";

function buildMockInputs(overrides = {}) {
  return {
    parsedSignals: [
      { action: "BUY", timestamp: new Date().toISOString(), entry: 2030, stopLoss: 2020, targets: [2045, 2050] }
    ],
    pairState: {
      direction: "BUY",
      liquidityStatus: "Clear",
      valuationZone: "Discount",
      mtfTrend: "Strong Bullish"
    },
    consensus: {
      buyConfidence: 100,
      sellConfidence: 0
    },
    marketState: {
      currentPrice: 2030,
      volatility: "Normal",
      spread: 1.5,
      marketClosed: false
    },
    riskAssessment: {
      blocked: false,
      riskGrade: "LOW_RISK",
      rrr: 2.0
    },
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
  console.log("=== RUNNING DECISION ENGINE INTEGRATION TESTS ===\n");

  // Test 1: Strong Consensus + Excellent Market
  console.log("[Test 1] Testing Strong Consensus + Excellent Market...");
  const inputsA = buildMockInputs({
    pairState: { direction: "BUY", valuationZone: "Discount", mtfTrend: "Strong Bullish" },
    marketState: { volatility: "Low", spread: 1.2 }
  });
  const resA = await evaluateMarketOpportunity(inputsA);
  assert(resA.decision === "BUY", "Decision is BUY");
  assert(resA.grade === "GRADE A", `Grade resolves to GRADE A (Actual: ${resA.grade}, Score: ${resA.score})`);
  assert(resA.decisionBreakdown.finalScore >= 90, "Final score is >= 90");
  assert(resA.decisionBreakdown.penalties === 0, "No warnings or penalties applied");

  // Test 2: Strong Consensus + Poor Market
  console.log("\n[Test 2] Testing Strong Consensus + Poor Market...");
  const inputsPoor = buildMockInputs({
    pairState: { direction: "BUY", valuationZone: "Premium", mtfTrend: "Strong Bearish" },
    marketState: { volatility: "High", spread: 2.8 },
    riskAssessment: { riskGrade: "HIGH_RISK", rrr: 1.0 }
  });
  const resPoor = await evaluateMarketOpportunity(inputsPoor);
  assert(resPoor.decision === "HOLD", "Decision becomes HOLD on poor market parameters");
  assert(resPoor.grade === "REJECT", `Grade is REJECT (Actual Score: ${resPoor.score})`);
  assert(resPoor.decisionBreakdown.finalScore < 70, `Final score is below 70 (Actual: ${resPoor.decisionBreakdown.finalScore})`);

  // Test 3: Weak Consensus + Excellent Market
  console.log("\n[Test 3] Testing Weak Consensus + Excellent Market...");
  const inputsWeak = buildMockInputs({
    consensus: { buyConfidence: 50, sellConfidence: 50 },
    pairState: { direction: "HOLD", valuationZone: "Discount", mtfTrend: "Neutral" }
  });
  const resWeak = await evaluateMarketOpportunity(inputsWeak);
  assert(resWeak.decision === "HOLD", "Weak consensus stays in HOLD");
  assert(resWeak.grade === "REJECT", "Grade resolves to REJECT");

  // Test 4: Trend Conflict
  console.log("\n[Test 4] Testing Trend Conflict rejection...");
  const inputsConflict = buildMockInputs({
    pairState: { direction: "BUY", mtfTrend: "Bearish" }
  });
  const resConflict = await evaluateMarketOpportunity(inputsConflict);
  assert(resConflict.decisionBreakdown.finalScore < resA.decisionBreakdown.finalScore, "Score is lower due to trend conflict");

  // Test 5: High Spread Rejection
  console.log("\n[Test 5] Testing High Spread rejection...");
  const inputsHighSpread = buildMockInputs({
    marketState: { spread: 5.5 }
  });
  const resHighSpread = await evaluateMarketOpportunity(inputsHighSpread);
  assert(resHighSpread.decision === "HOLD", "Wide spread triggers HOLD block");
  assert(resHighSpread.grade === "REJECT", "Grade resolves to REJECT");
  assert(resHighSpread.score === 0, "Score forced to 0 on policy check block");

  // Test 6: Market Closed
  console.log("\n[Test 6] Testing Closed Market block...");
  const inputsClosed = buildMockInputs({
    marketState: { marketClosed: true }
  });
  const resClosed = await evaluateMarketOpportunity(inputsClosed);
  assert(resClosed.decision === "HOLD", "Closed market triggers HOLD block");
  assert(resClosed.grade === "REJECT", "Grade resolves to REJECT");
  assert(resClosed.score === 0, "Score forced to 0 on closed market");

  // Test 7: Extreme Volatility
  console.log("\n[Test 7] Testing Extreme Volatility block...");
  const inputsVol = buildMockInputs({
    marketState: { volatility: "Extreme" }
  });
  const resVol = await evaluateMarketOpportunity(inputsVol);
  assert(resVol.decision === "HOLD", "Extreme volatility triggers HOLD block");
  assert(resVol.grade === "REJECT", "Grade resolves to REJECT");
  assert(resVol.score === 0, "Score forced to 0 on extreme volatility");

  // Test 8: Multiple Warning Penalties
  console.log("\n[Test 8] Testing Warning Penalties accumulation...");
  const inputsPenalties = buildMockInputs({
    session: { currentSession: "London" }, // Prevent low volume session warning
    marketState: { spread: 3.5, volatility: "High" }
  });
  const resPenalties = await evaluateMarketOpportunity(inputsPenalties, {
    policies: { blockSpreadBlocked: false, blockExtremeVolatility: false }, // disable hard blocks to isolate penalty calculations
    warningPenalty: 8,
    maximumPenalty: 25
  });
  // Should have exactly 2 warnings -> penalty = -16.
  assert(resPenalties.decisionBreakdown.penalties === -16, `Applies custom warning penalty correctly (Actual: ${resPenalties.decisionBreakdown.penalties})`);

  // Test 9: Configuration Overrides
  console.log("\n[Test 9] Testing custom weight configurations...");
  const customConfig = {
    weights: {
      consensus: 100,
      marketIntelligence: 0,
      risk: 0,
      rrr: 0
    },
    warningPenalty: 0 // Prevent warning penalties from altering final score
  };
  const inputsCustom = buildMockInputs({
    consensus: { buyConfidence: 80, sellConfidence: 20 }
  });
  const resCustom = await evaluateMarketOpportunity(inputsCustom, customConfig);
  // Consensus agreement is 80%, which maps to raw score 100. Overridden weight is 100% consensus, so score should be 100.
  assert(resCustom.score === 100, `Custom configuration uses consensus weight solely (Actual score: ${resCustom.score})`);

  // Test 10: Deep Freeze Immutability
  console.log("\n[Test 10] Testing deep freeze validation...");
  const resFreeze = await evaluateMarketOpportunity(buildMockInputs());
  assert(Object.isFrozen(resFreeze), "Root response is frozen");
  assert(Object.isFrozen(resFreeze.decisionBreakdown), "decisionBreakdown object is frozen");
  assert(Object.isFrozen(resFreeze.marketContext), "Nested marketContext is frozen");
  let mutationFailed = false;
  try {
    resFreeze.score = 555;
  } catch (err) {
    mutationFailed = true;
  }
  assert(mutationFailed, "Mutation of score throws error");

  // Test 11: Determinism
  console.log("\n[Test 11] Testing determinism across runs...");
  const resD1 = await evaluateMarketOpportunity(buildMockInputs());
  const resD2 = await evaluateMarketOpportunity(buildMockInputs());
  assert(resD1.score === resD2.score, "Scores match exactly");
  assert(resD1.decision === resD2.decision, "Decisions match exactly");
  assert(JSON.stringify(resD1.decisionBreakdown) === JSON.stringify(resD2.decisionBreakdown), "Breakdown elements match exactly");

  // Test 12: Regression compatibility / schema checks
  console.log("\n[Test 12] Testing schema validation & backward compatibility...");
  const requiredFields = [
    "status", "decision", "grade", "score", "confidence", "recommendation",
    "decisionBreakdown", "reasons", "warnings", "subsystemScores", "marketContext", "metadata", "timestamp"
  ];
  let schemaMatch = true;
  requiredFields.forEach(f => {
    if (resA[f] === undefined) {
      schemaMatch = false;
      console.error(`Field ${f} is missing from response`);
    }
  });
  assert(schemaMatch, "All required return schema fields are present");

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
