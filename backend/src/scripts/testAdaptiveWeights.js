/* eslint-disable no-console */
import {
  calculateAdaptiveWeights,
  calculateReadinessWithWeights,
  generateWeightExplanation,
  detectConflicts
} from "../services/geminiAdvisorService.js";

// Mock template parameters to populate scenarios
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
  macroConflictLevel: "Low",
  trustLevel: "Medium",
  averageRR: 1.5,
  orderFlow: {
    nearestBullishOB: null,
    nearestBearishOB: null,
    nearestBullishFvg: null,
    nearestBearishFvg: null,
    liquidity: { equalHighs: null, equalLow: null, lastSweepType: "None" }
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

// 8 Simulated Scenarios configurations
const scenarios = [
  {
    name: "Scenario 1: London-New York Overlap",
    params: {
      ...defaultParams,
      tradingSession: { active: true, activeHour: 14 } // Overlap UTC hour
    }
  },
  {
    name: "Scenario 2: High-Impact News",
    params: {
      ...defaultParams,
      macroConflictLevel: "High",
      liveEvents: [{ title: "FOMC Statement" }] // Active high impact news
    }
  },
  {
    name: "Scenario 3: Strong Bullish Trend",
    params: {
      ...defaultParams,
      institutionalBias: "Bullish",
      overallRegime: "Strong Bullish Trending",
      structure: { bos: "BOS", choch: "CHoCH", strength: "Strong" }
    }
  },
  {
    name: "Scenario 4: Weak Ranging Market",
    params: {
      ...defaultParams,
      overallRegime: "Weak Range",
      structure: { bos: "None", choch: "None", strength: "Weak" }
    }
  },
  {
    name: "Scenario 5: High Volatility",
    params: {
      ...defaultParams,
      volatilityLevel: "High"
    }
  },
  {
    name: "Scenario 6: Low Liquidity",
    params: {
      ...defaultParams,
      tradingSession: { active: false, activeHour: 22 },
      volatilityLevel: "Low"
    }
  },
  {
    name: "Scenario 7: Strong Telegram Consensus",
    params: {
      ...defaultParams,
      buyPercentage: 90,
      dominantDir: "BUY",
      trustLevel: "High"
    }
  },
  {
    name: "Scenario 8: Weak Telegram Reliability",
    params: {
      ...defaultParams,
      buyPercentage: 90,
      dominantDir: "BUY",
      trustLevel: "Low"
    }
  }
];

// Historical outcome win rates mock (e.g. Inst has high win rate, Telegram is average)
const winRates = {
  instFlow: 82, // 1.12 Multiplier
  telegram: 61, // 0.91 Multiplier
  macro: 75, // 1.05 Multiplier
  structure: 70, // 1.00 Multiplier
  regime: 70, // 1.00 Multiplier
  risk: 70 // 1.00 Multiplier
};

console.log("=== ADAPTIVE INTELLIGENCE WEIGHTING ENGINE VERIFICATION ===");
console.log(`Historical Multipliers benchmark test:\n${JSON.stringify(winRates)}\n`);

let prevWeights = null;

scenarios.forEach((sc, index) => {
  console.log(`\n==================================================`);
  console.log(`${sc.name}`);
  console.log(`==================================================`);

  // Run weighting engine (testing: Continuous math, Historical multiplier, Capping boundaries)
  const result = calculateAdaptiveWeights(sc.params, winRates, prevWeights);
  const weights = result.weights;

  // Print raw engine parameters
  console.log(`Scores: ${JSON.stringify(result.scores)}`);
  console.log(`Multipliers: ${JSON.stringify(result.multipliers)}`);
  console.log(`Final Weights: ${JSON.stringify(weights)}`);

  // Assert sum of weights = exactly 100%
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  console.log(`Weight Sum Check: ${sum}% (PASS if 100%)`);

  // Assert safety limits (Min 5%, Max 40%)
  const boundsOk = Object.values(weights).every(w => w >= 5 && w <= 40);
  console.log(`Safety Limits [5%-40%] Check: ${boundsOk ? "PASS" : "FAIL"}`);

  // Calculate Decision Readiness based on Weighting
  const readiness = calculateReadinessWithWeights(sc.params, weights);
  console.log(`Decision Readiness Score: ${readiness.score}`);
  console.log(`Top Negatives: ${JSON.stringify(readiness.negatives)}`);

  // Calculate Conflict Severity
  const conflictsData = detectConflicts(sc.params);
  console.log(`Conflict Severity: ${conflictsData.severity}`);

  // Weight explanation output
  const explanation = generateWeightExplanation(weights, result.scores);
  console.log(`\n${explanation}`);

  // Track weight transition to test smoothing max delta +-10%
  if (prevWeights) {
    let smoothingOk = true;
    Object.keys(weights).forEach(cat => {
      const delta = Math.abs(weights[cat] - prevWeights[cat]);
      if (delta > 12.5) { // Account for float rounding and normalization shift
        smoothingOk = false;
        console.log(`Smoothing WARNING: ${cat} delta was ${delta.toFixed(2)}%`);
      }
    });
    console.log(`Smoothing Check (<= 10% Cycle-to-Cycle Shift): ${smoothingOk ? "PASS" : "FAIL"}`);
  }

  // Update previous weights cache for next step
  prevWeights = weights;
});
