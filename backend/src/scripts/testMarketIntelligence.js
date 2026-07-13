import { evaluateMarketContext } from "../services/marketIntelligenceEngine.js";

function buildBaseInputs(overrides = {}) {
  return {
    trend: {
      trendDirection: "Neutral",
      trendStrength: "Weak",
      momentum: "Neutral",
      ...(overrides.trend || {})
    },
    structure: {
      valuationZone: "Equilibrium",
      liquiditySweep: "Absent",
      marketRegime: "Range",
      ...(overrides.structure || {})
    },
    supportResistance: {
      nearestObDistance: 25.0,
      nearestFvgDistance: 25.0,
      obStrength: 50,
      ...(overrides.supportResistance || {})
    },
    session: {
      currentSession: "London",
      asianRangePips: 15.0,
      ...(overrides.session || {})
    },
    volatility: {
      volatilityLevel: "Medium",
      atr: 1.5,
      stdDev: 1.2,
      ...(overrides.volatility || {})
    },
    spread: {
      currentSpread: 1.8,
      maxSpreadLimit: 3.0,
      marketClosed: false,
      ...(overrides.spread || {})
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
  console.log("=== RUNNING MARKET INTELLIGENCE FOUNDATION TESTS ===\n");

  // Test 1: Bullish Trend
  console.log("[Test 1] Testing Bull Trend Evaluator...");
  const inputsBull = buildBaseInputs({
    trend: { trendDirection: "Bullish", trendStrength: "Strong", momentum: "Bullish" }
  });
  const resBull = evaluateMarketContext(inputsBull);
  assert(resBull.trend.score === 95, `Trend score is 95 (Actual: ${resBull.trend.score})`);
  assert(resBull.trend.status === "STRONG_BULLISH", `Trend status is STRONG_BULLISH`);
  assert(resBull.trend.reasons.includes("Market trend is Bullish"), " Cites trend direction reason");

  // Test 2: Bearish Trend
  console.log("\n[Test 2] Testing Bear Trend Evaluator...");
  const inputsBear = buildBaseInputs({
    trend: { trendDirection: "Bearish", trendStrength: "Strong", momentum: "Bearish" }
  });
  const resBear = evaluateMarketContext(inputsBear);
  assert(resBear.trend.score === 95, `Trend score is 95 (Actual: ${resBear.trend.score})`);
  assert(resBear.trend.status === "STRONG_BEARISH", `Trend status is STRONG_BEARISH`);

  // Test 3: Ranging Market
  console.log("\n[Test 3] Testing Range Market structure...");
  const inputsRange = buildBaseInputs({
    trend: { trendDirection: "Neutral" },
    structure: { valuationZone: "Equilibrium", marketRegime: "Range" }
  });
  const resRange = evaluateMarketContext(inputsRange);
  assert(resRange.trend.status === "NEUTRAL", "Trend status is NEUTRAL");
  assert(resRange.structure.status === "NEUTRAL", "Structure status is NEUTRAL");

  // Test 4: High Spread
  console.log("\n[Test 4] Testing High Spread Evaluator...");
  const inputsHighSpread = buildBaseInputs({
    spread: { currentSpread: 5.0, maxSpreadLimit: 3.0 }
  });
  const resHighSpread = evaluateMarketContext(inputsHighSpread);
  assert(resHighSpread.spread.score === 50, `Spread score decreases on exceeding max limit (Actual: ${resHighSpread.spread.score})`);
  assert(resHighSpread.spread.status === "WIDE", "Spread status is WIDE");
  assert(resHighSpread.spread.warnings.some(w => w.includes("Wide spread detected")), "Adds wide spread warning");

  // Test 5: Low Spread
  console.log("\n[Test 5] Testing Low Spread Evaluator...");
  const inputsLowSpread = buildBaseInputs({
    spread: { currentSpread: 1.2 }
  });
  const resLowSpread = evaluateMarketContext(inputsLowSpread);
  assert(resLowSpread.spread.score === 100, `Optimal spread yields score of 100 (Actual: ${resLowSpread.spread.score})`);
  assert(resLowSpread.spread.status === "OPTIMAL", "Spread status is OPTIMAL");

  // Test 6: High Volatility
  console.log("\n[Test 6] Testing High Volatility Evaluator...");
  const inputsHighVol = buildBaseInputs({
    volatility: { volatilityLevel: "High" }
  });
  const resHighVol = evaluateMarketContext(inputsHighVol);
  assert(resHighVol.volatility.score === 50, `High volatility score is 50 (Actual: ${resHighVol.volatility.score})`);
  assert(resHighVol.volatility.status === "ELEVATED", "Volatility status is ELEVATED");

  // Test 7: Low Volatility
  console.log("\n[Test 7] Testing Low Volatility Evaluator...");
  const inputsLowVol = buildBaseInputs({
    volatility: { volatilityLevel: "Low" }
  });
  const resLowVol = evaluateMarketContext(inputsLowVol);
  assert(resLowVol.volatility.score === 90, `Low volatility score is 90 (Actual: ${resLowVol.volatility.score})`);
  assert(resLowVol.volatility.status === "STABLE", "Volatility status is STABLE");

  // Test 8: Market Closed
  console.log("\n[Test 8] Testing Closed Market state...");
  const inputsClosed = buildBaseInputs({
    spread: { marketClosed: true }
  });
  const resClosed = evaluateMarketContext(inputsClosed);
  assert(resClosed.status === "CLOSED", "Overall status is CLOSED");
  assert(resClosed.overallGrade === "REJECT", "Overall grade is REJECT");
  assert(resClosed.spread.score === 0, "Spread score is 0 when market is closed");

  // Test 9: Configuration Overrides
  console.log("\n[Test 9] Testing configuration overrides...");
  const customConfig = {
    weights: {
      trend: 100,
      structure: 0,
      supportResistance: 0,
      session: 0,
      volatility: 0,
      spread: 0
    },
    thresholds: {
      gradeA: 90,
      gradeB: 80,
      gradeC: 70
    }
  };
  const inputsCustom = buildBaseInputs({
    trend: { trendDirection: "Bullish", trendStrength: "Strong", momentum: "Bullish" }
  });
  const resCustom = evaluateMarketContext(inputsCustom, customConfig);
  // Overall score should be 100% determined by trend evaluator (which score is 95)
  assert(resCustom.overallScore === 95, `Overall score is 95 using custom weights (Actual: ${resCustom.overallScore})`);
  assert(resCustom.overallGrade === "GRADE A", `Overall grade resolves to GRADE A under thresholds`);

  // Test 10: Deep Freeze Immutability
  console.log("\n[Test 10] Testing deep freeze / immutability...");
  const resFreeze = evaluateMarketContext(buildBaseInputs());
  assert(Object.isFrozen(resFreeze), "Root report object is frozen");
  assert(Object.isFrozen(resFreeze.trend), "Subsystem trend object is frozen");
  assert(Object.isFrozen(resFreeze.subsystemMetrics), "Subsystem metrics object is frozen");
  let mutationFailed = false;
  try {
    resFreeze.overallScore = 999;
  } catch (err) {
    mutationFailed = true;
  }
  assert(mutationFailed, "Mutation of root property throws error");

  // Test 11: Determinism
  console.log("\n[Test 11] Testing determinism...");
  const resD1 = evaluateMarketContext(buildBaseInputs());
  const resD2 = evaluateMarketContext(buildBaseInputs());
  assert(resD1.overallScore === resD2.overallScore, "Scores match exactly");
  assert(resD1.overallGrade === resD2.overallGrade, "Grades match exactly");
  assert(JSON.stringify(resD1.subsystemMetrics) === JSON.stringify(resD2.subsystemMetrics), "Subsystem metrics match exactly");
  assert(JSON.stringify(resD1.reasons) === JSON.stringify(resD2.reasons), "Reasons list matches exactly");

  // Test 12: Regression compatibility / required output schema
  console.log("\n[Test 12] Testing output schema / regression compatibility...");
  const requiredFields = [
    "status", "overallScore", "overallGrade", "trend", "structure",
    "supportResistance", "session", "volatility", "spread",
    "subsystemMetrics", "reasons", "warnings", "timestamp"
  ];
  let schemaMatch = true;
  requiredFields.forEach(f => {
    if (resBull[f] === undefined) {
      schemaMatch = false;
      console.error(`Field ${f} is missing from response`);
    }
  });
  assert(schemaMatch, "All required schema output fields present");

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
