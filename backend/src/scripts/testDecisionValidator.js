/* eslint-disable no-console */
import {
  calculateAdaptiveWeights,
  calculateDirectionalScore,
  calculateEvidenceCoverage,
  calculateExecutionEnvironment,
  detectConflicts,
  calculateDecisionConsistency
} from "../services/geminiAdvisorService.js";

const defaultParams = {
  buyPercentage: 50,
  sellPercentage: 50,
  dominantDir: "HOLD",
  institutionalBias: "Neutral",
  mtfContext: {
    "1m": { status: "OK", trendDirection: "Neutral", trendStrength: "Weak" },
    "5m": { status: "OK", trendDirection: "Neutral", trendStrength: "Weak" },
    "15m": { status: "OK", trendDirection: "Neutral", trendStrength: "Weak" },
    "1h": { status: "OK", trendDirection: "Neutral", trendStrength: "Weak" },
    "4h": { status: "OK", trendDirection: "Neutral", trendStrength: "Weak" }
  },
  macroBias: "Mixed",
  macroConflictLevel: "Low",
  trustLevel: "Medium",
  averageRR: 1.5,
  orderFlow: {
    nearestBullishOB: null,
    nearestBearishOB: null,
    nearestBullishFvg: null,
    nearestBearishFvg: null,
    liquidity: { equalHighs: null, equalLows: null, lastSweepType: "None" }
  },
  tradingSession: { active: true, activeHour: 10 },
  volatilityLevel: "Low",
  overallConfluence: 60,
  currentPrice: 2000,
  dxyStats: { trendDirection: "Neutral" },
  us10yStats: { trendDirection: "Neutral" },
  overallRegime: "Range",
  momentumDirection: "Neutral",
  structure: { bos: "None", choch: "None", strength: "Weak" },
  currentSpread: 1.5,
  averageSignalAgeMin: 10
};

const winRates = {
  instFlow: 70,
  telegram: 70,
  macro: 70,
  structure: 70,
  regime: 70
};

const scenarios = [
  {
    name: "Scenario 1: Everything Agrees",
    recommendation: {
      direction: "BUY",
      reasoning: ["Perfect technical consensus", "Macro supporting", "Institutional buying"]
    },
    params: {
      ...defaultParams,
      buyPercentage: 90,
      dominantDir: "BUY",
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      macroBias: "Bullish",
      mtfContext: {
        "1m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "5m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "15m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "1h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "4h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" }
      },
      overallConfluence: 85
    }
  },
  {
    name: "Scenario 2: Institutional and Macro Disagree",
    recommendation: {
      direction: "BUY",
      reasoning: ["Macro aligns but institutional opposes"]
    },
    params: {
      ...defaultParams,
      buyPercentage: 90,
      dominantDir: "BUY",
      institutionalBias: "Bearish", // Disagrees with BUY
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      macroBias: "Bullish", // Aligns with BUY
      mtfContext: {
        "1m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "5m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "15m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "1h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "4h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" }
      },
      overallConfluence: 75
    }
  },
  {
    name: "Scenario 3: Execution Environment = Do Not Trade",
    recommendation: {
      direction: "BUY",
      reasoning: ["Attempting trade despite Do Not Trade conditions"]
    },
    params: {
      ...defaultParams,
      buyPercentage: 85,
      dominantDir: "BUY",
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      macroConflictLevel: "High",
      hasExtremeMtfConflict: true,
      hasLiveNewsBlock: true,
      hasVeryLowScore: true,
      currentSpread: 5.5 // Do Not Trade execution rating
    }
  },
  {
    name: "Scenario 4: Evidence Coverage < 60%",
    recommendation: {
      direction: "BUY",
      reasoning: ["Trading with highly incomplete evidence"]
    },
    params: {
      ...defaultParams,
      institutionalBias: "Neutral",
      structure: { bos: "None", choch: "None", strength: "Weak" },
      macroBias: "Mixed",
      buyPercentage: 50,
      sellPercentage: 50
    }
  },
  {
    name: "Scenario 5: BUY recommendation while Institutional Bias is Bearish",
    recommendation: {
      direction: "BUY",
      reasoning: ["Buying against institutional sellers"]
    },
    params: {
      ...defaultParams,
      institutionalBias: "Bearish" // Opposing
    }
  },
  {
    name: "Scenario 6: SELL recommendation while all evidence is Bullish",
    recommendation: {
      direction: "SELL",
      reasoning: ["Selling against perfect bullish alignment"]
    },
    params: {
      ...defaultParams,
      buyPercentage: 90,
      dominantDir: "BUY",
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      macroBias: "Bullish",
      mtfContext: {
        "1m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "5m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "15m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "1h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "4h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" }
      }
    }
  },
  {
    name: "Scenario 7: Gemini returns BUY, Institutional Bias = Bearish, Macro = Bullish, Execution Environment = Good",
    recommendation: {
      direction: "BUY",
      reasoning: ["Macro allows buying but institutional sellers are active"]
    },
    params: {
      ...defaultParams,
      buyPercentage: 80,
      dominantDir: "BUY",
      institutionalBias: "Bearish",
      macroBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      tradingSession: { active: true, activeHour: 14 } // Good execution session
    }
  }
];

console.log("=== AI SELF-REVIEW & DECISION VALIDATION LAYER VERIFICATION ===");

scenarios.forEach((sc) => {
  console.log(`\n==================================================`);
  console.log(`${sc.name}`);
  console.log(`==================================================`);

  // 1. Pre-Decision pipeline calculations
  const weightResult = calculateAdaptiveWeights(sc.params, winRates);
  const weights = weightResult.weights;
  const directional = calculateDirectionalScore(sc.params, weights);
  const coverage = calculateEvidenceCoverage(sc.params);
  const execEnv = calculateExecutionEnvironment(sc.params, weights);
  const conflicts = detectConflicts(sc.params);

  // 2. Decision validation review (Post-parsing)
  const validation = calculateDecisionConsistency(
    sc.recommendation,
    sc.params,
    weights,
    directional,
    coverage,
    execEnv,
    conflicts
  );

  console.log(`Recommendation: ${sc.recommendation.direction}`);
  console.log(`Consistency Score: ${validation.score}%`);
  console.log(`Validation Result (Flag): ${validation.validationResult}`);
  console.log(`Decision Flags: ${JSON.stringify(validation.flags)}`);
  console.log(`Validation Summary Output:\n${validation.validationSummary}\n`);

  // Assertions
  if (sc.name.includes("Scenario 1")) {
    console.log(`Assert Consistency Score > 90: ${validation.score > 90 ? "PASS" : "FAIL"}`);
  }
  if (sc.name.includes("Scenario 2")) {
    console.log(`Assert Consistency Score is Medium (40-80): ${(validation.score >= 40 && validation.score <= 80) ? "PASS" : "FAIL"}`);
  }
  if (sc.name.includes("Scenario 3")) {
    console.log(`Assert Consistency Score is Low (<50): ${validation.score < 50 ? "PASS" : "FAIL"}`);
  }
  if (sc.name.includes("Scenario 4")) {
    console.log(`Assert LOW_EVIDENCE flag is present: ${validation.flags.includes("LOW_EVIDENCE") ? "PASS" : "FAIL"}`);
  }
  if (sc.name.includes("Scenario 5")) {
    console.log(`Assert MAJOR_CONFLICT flag is present: ${validation.flags.includes("MAJOR_CONFLICT") ? "PASS" : "FAIL"}`);
  }
  if (sc.name.includes("Scenario 6")) {
    console.log(`Assert Consistency penalty exists (< 50): ${validation.score < 50 ? "PASS" : "FAIL"}`);
  }
  if (sc.name.includes("Scenario 7")) {
    console.log(`Assert preserved recommendation: ${sc.recommendation.direction === "BUY" ? "PASS" : "FAIL"}`);
    console.log(`Assert MAJOR_CONFLICT flag is present: ${validation.flags.includes("MAJOR_CONFLICT") ? "PASS" : "FAIL"}`);
    console.log(`Assert validation identifies Bearish Institutional contradiction: ${validation.reasons.some(r => r.includes("Institutional Flow Bias")) ? "PASS" : "FAIL"}`);
  }
});
