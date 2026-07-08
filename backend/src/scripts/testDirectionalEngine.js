/* eslint-disable no-console */
import {
  calculateAdaptiveWeights,
  calculateDirectionalScore,
  calculateEvidenceCoverage,
  calculateExecutionEnvironment,
  detectConflicts
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

const scenarios = [
  {
    name: "Scenario 1: Strong Trend + Low Risk",
    params: {
      ...defaultParams,
      buyPercentage: 75,
      dominantDir: "BUY",
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      mtfContext: {
        "1m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "5m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "15m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "1h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "4h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" }
      },
      signalsCount: 5,
      overallConfluence: 85
    }
  },
  {
    name: "Scenario 2: Strong Trend + High Risk News",
    params: {
      ...defaultParams,
      buyPercentage: 75,
      dominantDir: "BUY",
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      macroConflictLevel: "High",
      liveEvents: [{ title: "FOMC Statement" }] // Active news block
    }
  },
  {
    name: "Scenario 3: Mixed Evidence",
    params: {
      ...defaultParams,
      buyPercentage: 55,
      sellPercentage: 45,
      dominantDir: "HOLD",
      institutionalBias: "Neutral",
      structure: { bos: "None", choch: "None", strength: "Weak" }
    }
  },
  {
    name: "Scenario 4: Perfect Alignment",
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
    name: "Scenario 5: Institutional Bearish + Telegram Bullish",
    params: {
      ...defaultParams,
      buyPercentage: 85,
      dominantDir: "BUY",
      institutionalBias: "Bearish" // Counter flow conflict
    }
  },
  {
    name: "Scenario 6: Low Liquidity",
    params: {
      ...defaultParams,
      tradingSession: { active: false, activeHour: 22 }, // Outside prime session
      volatilityLevel: "Low"
    }
  },
  {
    name: "Scenario 7: Very Strong Bullish Direction + Very Poor Execution Environment",
    params: {
      ...defaultParams,
      buyPercentage: 95,
      dominantDir: "BUY",
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "Bullish", choch: "Bullish", strength: "Strong" },
      mtfContext: {
        "1m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "5m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "15m": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "1h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" },
        "4h": { status: "OK", trendDirection: "Bullish", trendStrength: "Strong" }
      },
      macroConflictLevel: "High",
      hasExtremeMtfConflict: true,
      hasLiveNewsBlock: true,
      hasVeryLowScore: true,
      currentSpread: 5.5 // Low environment factors
    }
  }
];

const winRates = {
  instFlow: 70,
  telegram: 70,
  macro: 70,
  structure: 70,
  regime: 70
};

console.log("=== DIRECTIONAL INTELLIGENCE & EXECUTION ENVIRONMENT SEPARATION VERIFICATION ===");

scenarios.forEach((sc) => {
  console.log(`\n==================================================`);
  console.log(`${sc.name}`);
  console.log(`==================================================`);

  // 1. Calculate weights
  const weightResult = calculateAdaptiveWeights(sc.params, winRates);
  const weights = weightResult.weights;

  // 2. Calculate Directional score
  const directional = calculateDirectionalScore(sc.params, weights);

  // 3. Calculate Evidence coverage
  const coverage = calculateEvidenceCoverage(sc.params);

  // 4. Calculate Execution Environment
  const execEnv = calculateExecutionEnvironment(sc.params, weights);
  const readiness = Math.max(0, 100 - execEnv.riskPenalty);

  // 5. Calculate Conflicts
  const conflicts = detectConflicts(sc.params);

  console.log(`Directional Score: ${directional.directionalScore}/100`);
  console.log(`Directional Confidence: ${directional.directionalConfidence}/100`);
  console.log(`Primary Bias: ${directional.primaryMarketBias}`);
  console.log(`Execution Environment Rating: ${execEnv.executionRating}`);
  console.log(`Decision Readiness: ${readiness}/100`);
  console.log(`Evidence Coverage: ${coverage.coveragePercentage}%`);
  console.log(`Conflict Severity: ${conflicts.severity}`);
  console.log(`Reasons to Avoid: ${JSON.stringify(execEnv.reasonsToAvoid)}`);
  
  if (sc.name.includes("Scenario 7")) {
    console.log(`--- Scenario 7 Assertions ---`);
    console.log(`Directional Score is High (>70): ${directional.directionalScore > 70 ? "PASS" : "FAIL"}`);
    console.log(`Readiness is Low (<50): ${readiness < 50 ? "PASS" : "FAIL"}`);
    console.log(`Rating is Poor or Do Not Trade: ${execEnv.executionRating === "Poor" || execEnv.executionRating === "Do Not Trade" ? "PASS" : "FAIL"}`);
  }
});
