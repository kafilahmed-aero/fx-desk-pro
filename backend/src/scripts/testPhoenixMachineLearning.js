import mongoose from "mongoose";
import { config } from "../config/env.js";
import { localPhoenixTradeMemory } from "../services/phoenixMemoryService.js";
import { localPhoenixTradeFeatures } from "../services/phoenixFeatureEngine.js";
import { evaluateMarketOpportunity } from "../services/decisionEngine.js";
import {
  trainModel,
  evaluateOpportunity,
  getModelStatus,
  localPhoenixModelMetadata,
  validateTrainingEligibility
} from "../services/phoenixMachineLearningEngine.js";
import { ML_TRAINING_POLICY } from "../config/mlTrainingPolicy.js";

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

// Generate mock trade memory and features
function createMockTrade({ tradeId, closeTime, netProfit, outcome, session, grade, strategy }) {
  const raw = {
    tradeId,
    symbol: "XAUUSD",
    direction: "BUY",
    signalInfo: {
      channels: ["GoldChan"],
      consensusPercentage: 85,
      confidence: 88
    },
    decisionEngine: {
      decision: "BUY",
      grade,
      finalScore: 88,
      reasons: ["Test reason"],
      warnings: []
    },
    marketContext: {
      overallScore: 82,
      session: { currentSession: session },
      trend: { score: 85 },
      structure: { score: 80 }
    },
    smartEntry: {
      recommendedStrategy: strategy,
      entryQuality: "GRADE B",
      entryPrice: 2000.0,
      entryRR: 2.5
    },
    execution: {
      lotSize: 0.1,
      actualFill: 2000.0,
      stopLoss: 1990.0,
      takeProfit: 2025.0
    },
    result: {
      outcome,
      netProfit,
      rMultiple: 2.5,
      rrAchieved: outcome === "FULL_TP" ? 2.5 : (netProfit > 0 ? 1.0 : -1.0),
      durationMs: 3600000,
      closeTime: new Date(closeTime)
    },
    environment: {
      session,
      timestamp: new Date(closeTime)
    }
  };

  const features = {
    direction: 1.0,
    lotSize: 0.1,
    entryType: strategy === "LIMIT" ? 2.0 : 1.0,
    tradeDuration: 3600.0,
    risk: 10.0,
    reward: 25.0,
    rr: 2.5,
    consensusScore: 0.85,
    agreeingChannels: 1.0,
    disagreeingChannels: 0.0,
    signalFreshness: 0.0,
    finalScore: 0.88,
    grade: grade === "GRADE A" ? 1.0 : (grade === "GRADE B" ? 0.75 : 0.50),
    confidence: 0.88,
    warningCount: 0.0,
    reasonCount: 1.0,
    overallScore: 0.82,
    trendScore: 0.85,
    structureScore: 0.8,
    sessionScore: 0.9,
    volatilityScore: 0.0,
    spreadScore: 0.0,
    entryQuality: 0.66,
    strategy: strategy === "LIMIT" ? 2.0 : 1.0,
    chasingFlag: 0.0,
    expectedRR: 2.5,
    breakEvenTriggered: 0.0,
    trailingActivated: 0.0,
    partialTpCount: 0.0,
    timeExit: outcome === "TIME_EXIT" ? 1.0 : 0.0,
    marketExit: outcome === "MARKET_EXIT" ? 1.0 : 0.0,
    winLoss: (outcome === "FULL_TP" || outcome === "PARTIAL_TP") ? 1.0 : -1.0,
    profit: netProfit,
    drawdown: 0.0,
    mfe: 0.0,
    mae: 0.0,
    rMultiple: 2.5
  };

  return { raw, features };
}

async function runTests() {
  console.log("=== RUNNING PHOENIX MACHINE LEARNING TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Reset caches
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();
  localPhoenixModelMetadata.clear();

  if (isMongoAvailable) {
    try {
      await mongoose.connection.db.collection("phoenixModelMetadata").deleteMany({});
    } catch (e) {}
  }

  // Force offline state for local cache checks
  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  const todayStr = new Date().toISOString();

  // 1. Graceful Fallback check when untrained
  console.log("\n[Test 1] Testing Graceful Fallback when Untrained...");
  const statusBefore = await getModelStatus();
  assert(statusBefore === "UNTRAINED", "Initial model status is UNTRAINED");

  const fallbackEval = await evaluateOpportunity({ some: "data" });
  assert(fallbackEval.trained === false, "Opportunity evaluation returns trained: false");
  assert(fallbackEval.status === "UNTRAINED", "Opportunity evaluation status is UNTRAINED");

  // 2. Training Eligibility & Dataset Diversity Check (Rejection Case)
  console.log("\n[Test 2] Testing Training Rejection on low/undiverse datasets...");
  // Seed 10 identical trades (fails minTrades = 15, and diversity)
  for (let i = 0; i < 10; i++) {
    const { raw, features } = createMockTrade({
      tradeId: `T-UNDIVERSE-${i}`,
      closeTime: todayStr,
      netProfit: 100.0,
      outcome: "FULL_TP",
      session: "London",
      grade: "GRADE A",
      strategy: "LIMIT"
    });
    localPhoenixTradeMemory.set(`T-UNDIVERSE-${i}`, raw);
    localPhoenixTradeFeatures.set(`T-UNDIVERSE-${i}`, { tradeId: `T-UNDIVERSE-${i}`, symbol: "XAUUSD", features });
  }

  const eligibilityUndiverse = await validateTrainingEligibility();
  assert(eligibilityUndiverse.eligible === false, "Eligibility validation fails on undiverse dataset");
  assert(eligibilityUndiverse.failed.some(f => f.includes("Minimum Trades")), "Failed logs catch Minimum Trades check");
  assert(eligibilityUndiverse.failed.some(f => f.includes("Diversity")), "Failed logs catch diversity check");

  try {
    await trainModel();
    assert(false, "trainModel allowed execution on undiverse/small dataset");
  } catch (err) {
    assert(err.message.includes("violations"), "trainModel throws error detailing violations");
  }

  // Clear undiverse cache
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();

  // 3. Seed Diverse Dataset (16 trades, diverse outcomes, sessions, strategies, grades)
  console.log("\n[Test 3] Seeding diverse datasets matching policy rules...");
  const sessions = ["London", "New York", "Asian", "London/NY Overlap"];
  const strategies = ["LIMIT", "MARKET", "STOP"];
  const outcomes = ["FULL_TP", "SL", "PARTIAL_TP"];
  const grades = ["GRADE A", "GRADE B", "GRADE C"];

  for (let i = 0; i < 16; i++) {
    const session = sessions[i % sessions.length];
    const strategy = strategies[i % strategies.length];
    const outcome = outcomes[i % outcomes.length];
    const grade = grades[i % grades.length];
    const netProfit = outcome.includes("TP") ? 100.0 : -80.0;
    
    const { raw, features } = createMockTrade({
      tradeId: `T-DIVERSE-${i}`,
      closeTime: todayStr,
      netProfit,
      outcome,
      session,
      grade,
      strategy
    });
    localPhoenixTradeMemory.set(`T-DIVERSE-${i}`, raw);
    localPhoenixTradeFeatures.set(`T-DIVERSE-${i}`, { tradeId: `T-DIVERSE-${i}`, symbol: "XAUUSD", features });
  }

  const eligibilityDiverse = await validateTrainingEligibility();
  assert(eligibilityDiverse.eligible === true, "Eligibility validation passes on diverse dataset of 16 trades");

  // 4. Model Training and Lifecycle Verification
  console.log("\n[Test 4] Training the Model...");
  const modelMetadata = await trainModel();
  assert(modelMetadata.status === "ACTIVE", "Trained model status set to ACTIVE");
  assert(modelMetadata.trainingDatasetSize === 16, "Trained model logs correct dataset size of 16");
  assert(modelMetadata.trainingPolicyVersion === ML_TRAINING_POLICY.policyVersion, "Model metadata references policy version");
  assert(modelMetadata.featureSchemaVersion === "1.0", "Model metadata references feature schema version");

  const statusAfter = await getModelStatus();
  assert(statusAfter.status === "ACTIVE", "getModelStatus confirms active model registration");

  // 5. Advisory Output & Prediction Confidence Verification
  console.log("\n[Test 5] Testing Advisory Output & Prediction Confidences...");
  const currentOpportunitySnapshot = {
    symbol: "XAUUSD",
    direction: "BUY",
    signalInfo: { channels: ["GoldChan"], consensusPercentage: 85, confidence: 88 },
    decisionEngine: { decision: "BUY", grade: "GRADE A", finalScore: 88, reasons: [], warnings: [] },
    marketContext: { overallScore: 82, session: { currentSession: "London" }, trend: { score: 85 }, structure: { score: 80 } },
    smartEntry: { recommendedStrategy: "LIMIT", entryQuality: "GRADE B", entryPrice: 2000.0, entryRR: 2.5 },
    execution: { lotSize: 0.1, actualFill: 2000.0, stopLoss: 1990.0, takeProfit: 2025.0 }
  };

  const evalResult = await evaluateOpportunity(currentOpportunitySnapshot);
  assert(evalResult.trained === true, "Opportunity successfully evaluated");
  assert(evalResult.probabilityOfSuccess !== undefined, "Output includes probabilityOfSuccess");
  assert(evalResult.historicalSimilarityScore !== undefined, "Output includes historicalSimilarityScore");
  assert(evalResult.predictionConfidence !== undefined, "Output includes predictionConfidence");
  assert(evalResult.metadata.dataQuality !== undefined, "Output includes dataQuality validation");
  assert(evalResult.metadata.modelConfidence !== undefined, "Output includes modelConfidence validation");
  assert(evalResult.metadata.similarityConfidence !== undefined, "Output includes similarityConfidence validation");

  // Explainable nearest matches validation
  assert(evalResult.nearestHistoricalPatterns.length === ML_TRAINING_POLICY.kNeighbors, `Returns exactly ${ML_TRAINING_POLICY.kNeighbors} neighbors`);
  const neighbor = evalResult.nearestHistoricalPatterns[0];
  assert(neighbor.tradeId !== undefined, "Neighbor returns tradeId");
  assert(neighbor.similarity !== undefined, "Neighbor returns similarity percentage");
  assert(neighbor.outcome !== undefined, "Neighbor returns outcome");
  assert(neighbor.decisionGrade !== undefined, "Neighbor returns decisionGrade");
  assert(neighbor.session !== undefined, "Neighbor returns session");
  assert(neighbor.entryStrategy !== undefined, "Neighbor returns entryStrategy");

  // 6. Feature Importance Deterministic Ordering
  console.log("\n[Test 6] Testing Feature Importance deterministic alphabetical ordering...");
  const importance = evalResult.featureImportance;
  assert(importance.length > 0, "Feature importance array is populated");
  
  let alphabeticallySorted = true;
  for (let i = 1; i < importance.length; i++) {
    if (importance[i].featureName.localeCompare(importance[i - 1].featureName) < 0) {
      alphabeticallySorted = false;
      break;
    }
  }
  assert(alphabeticallySorted, "Feature importance array is sorted alphabetically by featureName");

  const impItem = importance[0];
  assert(impItem.featureName !== undefined, "Importance item contains featureName");
  assert(impItem.importanceScore !== undefined, "Importance item contains importanceScore");
  assert(impItem.rank !== undefined, "Importance item contains rank");
  assert(impItem.contribution !== undefined, "Importance item contains contribution (HIGH/MEDIUM/LOW)");

  // 7. Deterministic KNN Ordering
  console.log("\n[Test 7] Testing Cosine similarity and KNN determinism...");
  const evalResult2 = await evaluateOpportunity(currentOpportunitySnapshot);
  assert(evalResult.probabilityOfSuccess === evalResult2.probabilityOfSuccess, "Probability of success is identical across evaluations");
  assert(evalResult.historicalSimilarityScore === evalResult2.historicalSimilarityScore, "Historical similarity score is identical");
  assert(
    JSON.stringify(evalResult.nearestHistoricalPatterns) === JSON.stringify(evalResult2.nearestHistoricalPatterns),
    "Nearest historical patterns order is identical and deterministic"
  );

  // 8. Decision Engine Integration & Advisory Separation
  console.log("\n[Test 8] Testing Decision Engine integration and separation...");
  const decisionInputs = {
    parsedSignals: [{ action: "BUY", timestamp: todayStr, entry: 2000, stopLoss: 1990, targets: [2025] }],
    pairState: { direction: "BUY", valuationZone: "Discount", mtfTrend: "Strong Bullish" },
    consensus: { buyConfidence: 100, sellConfidence: 0 },
    marketState: { currentPrice: 2000, volatility: "Low", spread: 1.2 },
    riskAssessment: { blocked: false, riskGrade: "LOW_RISK", rrr: 2.0 },
    timestamp: todayStr
  };

  const decisionRes = await evaluateMarketOpportunity(decisionInputs);
  assert(decisionRes.mlAdvisory !== undefined, "Decision Engine output contains mlAdvisory sub-property");
  assert(decisionRes.mlAdvisory.trained === true, "mlAdvisory indicates trained state");
  assert(decisionRes.mlAdvisory.probabilityOfSuccess !== undefined, "mlAdvisory contains win probabilities");
  assert(decisionRes.mlAdvisory.historicalSimilarityScore !== undefined, "mlAdvisory contains similarity scores");
  
  // Immutability checks
  assert(Object.isFrozen(decisionRes.mlAdvisory), "mlAdvisory object is deeply frozen");

  // 9. Mongoose Online Integration
  if (isMongoAvailable) {
    console.log("\n[Test 9] Testing Mongoose Online Database Integration...");
    Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

    try {
      await trainModel();
      
      const queried = await getModelStatus();
      assert(queried.status === "ACTIVE", "Active model retrieved from MongoDB database");

      // Verify immutability
      try {
        await PhoenixModelMetadata.updateOne({ modelVersion: queried.modelVersion }, { $set: { accuracyMetric: 0.99 } });
        assert(false, "Mongoose updateOne allowed modifying append-only model accuracyMetric");
      } catch (e) {
        assert(e.message.includes("Only status transitions"), `updateOne block prevents metric modifications (Message: ${e.message})`);
      }

      // Try status transition only (should pass)
      await PhoenixModelMetadata.updateOne({ modelVersion: queried.modelVersion }, { $set: { status: "ARCHIVED" } });
      const updatedDoc = await PhoenixModelMetadata.findOne({ modelVersion: queried.modelVersion });
      assert(updatedDoc.status === "ARCHIVED", "Mongoose updateOne allowed status transition successfully");
      
      // Try to delete document (should fail)
      try {
        await PhoenixModelMetadata.deleteOne({ modelVersion: queried.modelVersion });
        assert(false, "Mongoose deleteOne allowed deleting append-only model metadata");
      } catch (e) {
        assert(e.message.includes("prohibited"), `deleteOne block prevents record deletion (Message: ${e.message})`);
      }
    } catch (e) {
      console.error("  FAIL: Online validation failed", e);
      failCount++;
    }
  }

  // Restore state
  Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

  console.log(`\n==============================================`);
  console.log(`TEST RUN COMPLETE: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log(`==============================================`);
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
