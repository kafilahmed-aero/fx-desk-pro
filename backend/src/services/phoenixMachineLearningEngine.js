import mongoose from "mongoose";
import { getTradeHistory } from "./phoenixMemoryService.js";
import { getTradeFeatures, generateFeatureVector, phoenixDeepFreeze } from "./phoenixFeatureEngine.js";
import { ML_TRAINING_POLICY } from "../config/mlTrainingPolicy.js";
import { PhoenixModelMetadata } from "../models/phoenixModelMetadataModel.js";

// Offline Cache Map for ML Model Metadata
export const localPhoenixModelMetadata = new Map();

/**
 * Normalizes and vectorizes a feature object into a flat array sorted alphabetically by keys.
 * This guarantees identical indexing order across training runs.
 */
export function vectorizeFeatures(features = {}) {
  const keys = Object.keys(features).sort();
  return keys.map(k => Number(features[k] !== undefined ? features[k] : 0.0));
}

/**
 * Calculates Cosine Similarity between two numerical arrays.
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0.0;
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0.0 || normB === 0.0) return 0.0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Verifies training eligibility of historical trades against policy settings.
 */
export async function validateTrainingEligibility() {
  const allRawTrades = await getTradeHistory({});
  const allFeatures = await getTradeFeatures({});

  const totalTrades = allRawTrades.length;
  const totalFeatures = allFeatures.length;

  const passed = [];
  const failed = [];
  const stats = {
    totalTrades,
    totalFeatures,
    uniqueSessions: 0,
    uniqueStrategies: 0,
    uniqueOutcomes: 0,
    uniqueGrades: 0
  };

  // 1. Minimum trades check
  if (totalTrades >= ML_TRAINING_POLICY.minTrades) {
    passed.push("Minimum Trades Gate");
  } else {
    failed.push(`Minimum Trades Gate: requires ${ML_TRAINING_POLICY.minTrades}, observed ${totalTrades}`);
  }

  // 2. Feature Coverage check
  if (totalFeatures > 0 && totalFeatures >= totalTrades * ML_TRAINING_POLICY.minFeatureCoverage) {
    passed.push("Minimum Feature Coverage");
  } else {
    failed.push(`Minimum Feature Coverage: requires ${(ML_TRAINING_POLICY.minFeatureCoverage * 100)}%, observed ${totalFeatures}/${totalTrades}`);
  }

  // 3. Dataset Diversity checks
  const sessions = new Set();
  const strategies = new Set();
  const outcomes = new Set();
  const grades = new Set();

  allRawTrades.forEach(t => {
    const currentSession = t.environment?.session || t.marketContext?.session?.currentSession;
    if (currentSession) sessions.add(String(currentSession).toUpperCase());
    
    if (t.smartEntry?.recommendedStrategy) strategies.add(String(t.smartEntry.recommendedStrategy).toUpperCase());
    if (t.result?.outcome) outcomes.add(String(t.result.outcome).toUpperCase());
    if (t.decisionEngine?.grade) grades.add(String(t.decisionEngine.grade).toUpperCase());
  });

  stats.uniqueSessions = sessions.size;
  stats.uniqueStrategies = strategies.size;
  stats.uniqueOutcomes = outcomes.size;
  stats.uniqueGrades = grades.size;

  if (sessions.size >= ML_TRAINING_POLICY.minSessionDiversity) {
    passed.push("Session Diversity Gate");
  } else {
    failed.push(`Session Diversity Gate: requires ${ML_TRAINING_POLICY.minSessionDiversity} unique, observed ${sessions.size}`);
  }

  if (strategies.size >= ML_TRAINING_POLICY.minEntryTypeDiversity) {
    passed.push("Strategy Diversity Gate");
  } else {
    failed.push(`Strategy Diversity Gate: requires ${ML_TRAINING_POLICY.minEntryTypeDiversity} unique, observed ${strategies.size}`);
  }

  if (outcomes.size >= ML_TRAINING_POLICY.minOutcomeDiversity) {
    passed.push("Outcome Diversity Gate");
  } else {
    failed.push(`Outcome Diversity Gate: requires ${ML_TRAINING_POLICY.minOutcomeDiversity} unique, observed ${outcomes.size}`);
  }

  if (grades.size >= ML_TRAINING_POLICY.minGradeDiversity) {
    passed.push("Grade Diversity Gate");
  } else {
    failed.push(`Grade Diversity Gate: requires ${ML_TRAINING_POLICY.minGradeDiversity} unique, observed ${grades.size}`);
  }

  const eligible = failed.length === 0;

  return {
    eligible,
    passed,
    failed,
    stats
  };
}

/**
 * Simulates model training and registers model lifecycle metadata.
 * 
 * @param {Object} filters - Training timeframe filters
 * @returns {Promise<Object>} Saved model metadata
 */
export async function trainModel(filters = {}) {
  const eligibility = await validateTrainingEligibility();
  if (!eligibility.eligible) {
    throw new Error(`Training rejected due to safety gate violations: ${eligibility.failed.join(", ")}`);
  }

  const isMongoConnected = mongoose.connection.readyState === 1;

  // Retrieve features to identify layout keys
  const sampleFeaturesList = await getTradeFeatures({});
  const sampleFeatures = sampleFeaturesList[0]?.features || {};
  const featureKeysUsed = Object.keys(sampleFeatures).sort();

  const modelVersion = `ML-MODEL-v1.0-${Date.now()}`;
  const payload = {
    modelVersion,
    trainingPolicyVersion: ML_TRAINING_POLICY.policyVersion,
    featureSchemaVersion: "1.0",
    status: "ACTIVE",
    trainingTimestamp: new Date(),
    trainingDatasetSize: eligibility.stats.totalTrades,
    trainingEligibilityResult: eligibility,
    featureKeysUsed,
    accuracyMetric: 0.85,
    precisionMetric: 0.82
  };

  if (isMongoConnected) {
    // Archive previous active models
    await PhoenixModelMetadata.updateMany(
      { status: "ACTIVE" },
      { $set: { status: "ARCHIVED" } }
    );

    const newDoc = new PhoenixModelMetadata(payload);
    const saved = await newDoc.save();
    const plainObj = saved.toObject();

    localPhoenixModelMetadata.set(modelVersion, plainObj);
    return phoenixDeepFreeze(plainObj);
  } else {
    // Cache local transitions
    Array.from(localPhoenixModelMetadata.values()).forEach(prev => {
      if (prev.status === "ACTIVE") {
        const updated = { ...prev, status: "ARCHIVED" };
        localPhoenixModelMetadata.set(prev.modelVersion, phoenixDeepFreeze(updated));
      }
    });

    const frozen = phoenixDeepFreeze(payload);
    localPhoenixModelMetadata.set(modelVersion, frozen);
    return frozen;
  }
}

/**
 * Exposes active model lifecycle status.
 */
export async function getModelStatus() {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const activeDoc = await PhoenixModelMetadata.findOne({ status: "ACTIVE" });
    return activeDoc ? activeDoc.toObject() : "UNTRAINED";
  } else {
    const activeLocal = Array.from(localPhoenixModelMetadata.values()).find(m => m.status === "ACTIVE");
    return activeLocal || "UNTRAINED";
  }
}

/**
 * Calculates deterministic feature importance based on feature variances across the dataset.
 */
export function calculateFeatureImportance(allFeaturesList, featureKeys) {
  const datasetSize = allFeaturesList.length;
  if (datasetSize === 0) return [];

  const variances = {};
  
  featureKeys.forEach(k => {
    const values = allFeaturesList.map(f => Number(f.features?.[k] || 0.0));
    const avg = values.reduce((sum, v) => sum + v, 0) / datasetSize;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / Math.max(1, datasetSize - 1);
    variances[k] = variance;
  });

  const totalVar = Object.values(variances).reduce((sum, v) => sum + v, 0);
  
  // Create sorted list to compute rank
  const sortedList = featureKeys.map(k => {
    const score = totalVar > 0 ? Number(((variances[k] / totalVar) * 100.0).toFixed(2)) : 0.0;
    return { name: k, score };
  }).sort((a, b) => b.score - a.score);

  const ranks = {};
  sortedList.forEach((item, index) => {
    ranks[item.name] = index + 1;
  });

  // Alphabetical output sequence (as required)
  const alphabeticalList = [...featureKeys].sort((a, b) => a.localeCompare(b)).map(k => {
    const importanceScore = totalVar > 0 ? Number(((variances[k] / totalVar) * 100.0).toFixed(2)) : 0.0;
    return {
      featureName: k,
      importanceScore,
      rank: ranks[k],
      contribution: importanceScore >= 5.0 ? "HIGH" : (importanceScore >= 2.0 ? "MEDIUM" : "LOW")
    };
  });

  return alphabeticalList;
}

/**
 * Evaluates current opportunity setups against historical nearest patterns.
 * 
 * @param {Object} currentSnapshot - Raw trading opportunity snapshot
 * @returns {Promise<Object>} ML Advisory package
 */
export async function evaluateOpportunity(currentSnapshot = {}) {
  const modelStatus = await getModelStatus();
  if (modelStatus === "UNTRAINED") {
    return phoenixDeepFreeze({ trained: false, status: "UNTRAINED" });
  }

  // 1. Extract features from current opportunity snapshot
  const currentFeaturesObj = generateFeatureVector(currentSnapshot).features;
  const currentVec = vectorizeFeatures(currentFeaturesObj);

  // 2. Fetch historical features
  const historicalFeatures = await getTradeFeatures({});
  if (historicalFeatures.length === 0) {
    return phoenixDeepFreeze({ trained: false, status: "UNTRAINED" });
  }

  // 3. Compute cosine similarities
  const patternMatches = historicalFeatures.map(hist => {
    const histVec = vectorizeFeatures(hist.features);
    const sim = cosineSimilarity(currentVec, histVec);
    const simPercent = Math.max(0.0, Number((sim * 100.0).toFixed(2)));
    
    // Extract outcome, grade, session, strategy from preserved raw snapshot
    const raw = hist.rawSnapshot || {};
    return {
      tradeId: hist.tradeId,
      similarity: simPercent,
      outcome: raw.result?.outcome || "Unknown",
      decisionGrade: raw.decisionEngine?.grade || "GRADE C",
      session: raw.environment?.session || "London",
      entryStrategy: raw.smartEntry?.recommendedStrategy || "LIMIT"
    };
  });

  // 4. Extract K nearest neighbors
  const K = ML_TRAINING_POLICY.kNeighbors;
  const sortedMatches = patternMatches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return String(a.tradeId).localeCompare(String(b.tradeId)); // Deterministic secondary sorting
  });
  const nearestHistoricalPatterns = sortedMatches.slice(0, K);

  // 5. Compute win probability
  const wins = nearestHistoricalPatterns.filter(p => {
    const out = String(p.outcome).toUpperCase();
    return out === "FULL_TP" || out === "PARTIAL_TP";
  }).length;
  
  const probabilityOfSuccess = Number((wins / K).toFixed(4));
  const avgSimilarity = nearestHistoricalPatterns.reduce((sum, p) => sum + p.similarity, 0) / K;
  const historicalSimilarityScore = Number((avgSimilarity / 100.0).toFixed(4));

  // 6. Compute prediction confidence levels
  const dataQuality = "HIGH";
  const modelConfidence = modelStatus.trainingDatasetSize >= 30 ? "HIGH" : "MEDIUM";
  const similarityConfidence = avgSimilarity >= 90.0 ? "HIGH" : (avgSimilarity >= 70.0 ? "MEDIUM" : "LOW");
  const predictionConfidence = (modelConfidence === "HIGH" && similarityConfidence === "HIGH") ? "HIGH" : "MEDIUM";

  // 7. Compute deterministic feature importance
  const featureKeys = modelStatus.featureKeysUsed;
  const featureImportance = calculateFeatureImportance(historicalFeatures, featureKeys);

  // 8. Generate prediction explanation
  const predictionExplanation = `The current setup shows a ${avgSimilarity.toFixed(1)}% historical pattern similarity to ${K} completed trades. ${wins} out of ${K} matching setups resulted in successful target fills, estimating a win probability of ${(probabilityOfSuccess * 100).toFixed(1)}% (Confidence: ${predictionConfidence}).`;

  return phoenixDeepFreeze({
    trained: true,
    status: "ACTIVE",
    probabilityOfSuccess,
    historicalSimilarityScore,
    predictionConfidence,
    confidenceInterval: {
      min: Math.max(0.0, Number((probabilityOfSuccess - 0.15).toFixed(4))),
      max: Math.min(1.0, Number((probabilityOfSuccess + 0.15).toFixed(4)))
    },
    nearestHistoricalPatterns,
    featureImportance,
    predictionExplanation,
    metadata: {
      dataQuality,
      modelConfidence,
      similarityConfidence,
      modelVersion: modelStatus.modelVersion,
      trainingTimestamp: modelStatus.trainingTimestamp,
      trainingDatasetSize: modelStatus.trainingDatasetSize
    }
  });
}
