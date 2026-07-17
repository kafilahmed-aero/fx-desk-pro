import mongoose from "mongoose";
import { PhoenixTradeFeature } from "../models/phoenixFeatureModel.js";

// In-memory cache for offline operations/testing
export const localPhoenixTradeFeatures = new Map();

/**
 * Specialized deep freeze function for Phoenix data structures.
 */
export function phoenixDeepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  if (
    obj instanceof Date ||
    obj instanceof RegExp ||
    Buffer.isBuffer(obj) ||
    ArrayBuffer.isView(obj) ||
    obj.constructor?.name === "ObjectId" ||
    obj.constructor?.name === "Decimal128"
  ) {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    phoenixDeepFreeze(obj[key]);
  });
  return obj;
}

// ==========================================
// Centralized Normalization Helpers
// ==========================================

export function normalizePercentage(val) {
  const num = Number(val);
  if (isNaN(num)) return 0.0;
  return Number((num / 100.0).toFixed(4));
}

export function normalizeScore(val) {
  const num = Number(val);
  if (isNaN(num)) return 0.0;
  return Number((num / 100.0).toFixed(4));
}

export function normalizeRR(risk, reward) {
  const numRisk = Number(risk);
  const numReward = Number(reward);
  if (isNaN(numRisk) || isNaN(numReward) || numRisk <= 0) return 0.0;
  return Number((numReward / numRisk).toFixed(4));
}

export function normalizeDuration(ms) {
  const num = Number(ms);
  if (isNaN(num) || num < 0) return 0.0;
  return Number((num / 1000.0).toFixed(4)); // Milliseconds to seconds
}

export function normalizeSpread(spread) {
  const num = Number(spread);
  if (isNaN(num)) return 0.0;
  return num;
}

export function normalizeProfit(profit) {
  const num = Number(profit);
  if (isNaN(num)) return 0.0;
  return num;
}

/**
 * Deterministically generates a feature vector of 37 normalized numerical parameters.
 * Assigns defaults and records warnings for missing fields.
 * 
 * @param {Object} memorySnapshot - Raw trade memory snapshot
 * @returns {Object} { features, warnings }
 */
export function generateFeatureVector(memorySnapshot = {}) {
  const warnings = [];
  const features = {};

  // 1. Trade Features
  // Direction
  let direction = 0.0;
  if (!memorySnapshot.direction) {
    warnings.push("Missing snapshot field: direction. Defaulted to 0.0.");
  } else {
    const dir = String(memorySnapshot.direction).toUpperCase();
    direction = dir === "BUY" ? 1.0 : (dir === "SELL" ? -1.0 : 0.0);
  }

  // Lot Size
  let lotSize = 0.01;
  if (!memorySnapshot.execution || memorySnapshot.execution.lotSize === undefined) {
    warnings.push("Missing execution field: lotSize. Defaulted to 0.01.");
  } else {
    lotSize = Number(memorySnapshot.execution.lotSize);
    if (isNaN(lotSize)) lotSize = 0.01;
  }

  // Entry Type
  let entryType = 0.0;
  const strategyStr = memorySnapshot.smartEntry?.recommendedStrategy || "";
  if (!strategyStr) {
    warnings.push("Missing smartEntry field: recommendedStrategy. Defaulted to 0.0.");
  } else {
    const upperStrat = strategyStr.toUpperCase();
    if (upperStrat === "MARKET") entryType = 1.0;
    else if (upperStrat === "LIMIT") entryType = 2.0;
    else if (upperStrat === "STOP") entryType = 3.0;
    else if (upperStrat === "WAIT") entryType = 4.0;
  }

  // Trade Duration
  let durationMs = 0.0;
  if (!memorySnapshot.result || memorySnapshot.result.durationMs === undefined) {
    warnings.push("Missing result field: durationMs. Defaulted to 0.0.");
  } else {
    durationMs = Number(memorySnapshot.result.durationMs);
  }
  const tradeDuration = normalizeDuration(durationMs);

  // Risk, Reward, RR
  let actualFill = 0.0;
  let stopLoss = 0.0;
  let takeProfit = 0.0;
  if (!memorySnapshot.execution) {
    warnings.push("Missing execution block. Defaulted risk, reward, and rr to 0.0.");
  } else {
    actualFill = Number(memorySnapshot.execution.actualFill || memorySnapshot.execution.requestedEntry || 0);
    stopLoss = Number(memorySnapshot.execution.stopLoss || 0);
    takeProfit = Number(memorySnapshot.execution.takeProfit || 0);
  }

  const risk = actualFill > 0 && stopLoss > 0 ? Number(Math.abs(actualFill - stopLoss).toFixed(4)) : 0.0;
  const reward = actualFill > 0 && takeProfit > 0 ? Number(Math.abs(takeProfit - actualFill).toFixed(4)) : 0.0;
  const rr = normalizeRR(risk, reward);

  // 2. Consensus Features
  let consensusPercentage = 0.0;
  let agreeingChannels = 0.0;
  let disagreeingChannels = 0.0;
  if (!memorySnapshot.signalInfo) {
    warnings.push("Missing signalInfo block. Defaulted consensus scores and channel counts to 0.0.");
  } else {
    consensusPercentage = Number(memorySnapshot.signalInfo.consensusPercentage || 0);
    agreeingChannels = Number(memorySnapshot.signalInfo.agreeingChannels || 0);
    disagreeingChannels = Number(memorySnapshot.signalInfo.disagreeingChannels || 0);
  }
  const consensusScore = normalizePercentage(consensusPercentage);

  // Signal Freshness
  let signalFreshness = 0.0;
  const timeline = memorySnapshot.lifecycleTimeline || [];
  if (timeline.length === 0) {
    warnings.push("Missing lifecycleTimeline. Signal freshness defaulted to 0.0.");
  } else {
    const openTime = timeline[0]?.timestamp ? new Date(timeline[0].timestamp).getTime() : null;
    const parsedSignalTime = memorySnapshot.signalInfo?.parsedSignal?.timestamp || memorySnapshot.signalInfo?.parsedSignal?.createdAt;
    const signalTime = parsedSignalTime ? new Date(parsedSignalTime).getTime() : null;
    if (openTime && signalTime) {
      signalFreshness = Math.max(0.0, (openTime - signalTime) / 1000.0);
    } else {
      warnings.push("Could not resolve openTime or signalTime for freshness calculation. Defaulted to 0.0.");
    }
  }

  // 3. Decision Engine Features
  let deScore = 0.0;
  let deGrade = 0.0;
  let confidenceVal = 0.0;
  let warningCount = 0;
  let reasonCount = 0;

  if (!memorySnapshot.decisionEngine) {
    warnings.push("Missing decisionEngine snapshot. Defaulted finalScore, grade, and confidence to 0.0.");
  } else {
    const de = memorySnapshot.decisionEngine;
    deScore = Number(de.finalScore || 0);
    const gradeStr = String(de.grade || "").toUpperCase();
    if (gradeStr === "GRADE A") deGrade = 1.0;
    else if (gradeStr === "GRADE B") deGrade = 0.75;
    else if (gradeStr === "GRADE C") deGrade = 0.5;
    else if (gradeStr === "GRADE D") deGrade = 0.25;

    confidenceVal = Number(memorySnapshot.signalInfo?.confidence || de.finalScore || 0);
    warningCount = Array.isArray(de.warnings) ? de.warnings.length : 0;
    reasonCount = Array.isArray(de.reasons) ? de.reasons.length : 0;
  }
  const finalScore = normalizeScore(deScore);
  const confidence = normalizeScore(confidenceVal);
  const grade = deGrade;

  // 4. Market Intelligence Features
  let overallScoreRaw = 0.0;
  let trendScoreRaw = 0.0;
  let structureScoreRaw = 0.0;
  let sessionScoreRaw = 0.0;
  let volatilityScoreRaw = 0.0;
  let spreadScoreRaw = 0.0;

  const mc = memorySnapshot.marketContext || {};
  if (!memorySnapshot.marketContext) {
    warnings.push("Missing marketContext snapshot. Defaulted Market Intelligence scores to 0.0.");
  } else {
    overallScoreRaw = Number(mc.overallScore || 0);
    trendScoreRaw = Number(mc.trend?.score || mc.subsystemScores?.trend || 0);
    structureScoreRaw = Number(mc.structure?.score || mc.subsystemScores?.structure || 0);
    sessionScoreRaw = Number(mc.session?.score || mc.subsystemScores?.session || 0);
    volatilityScoreRaw = Number(mc.volatility?.score || mc.subsystemScores?.volatility || 0);
    spreadScoreRaw = Number(mc.spread?.score || mc.subsystemScores?.spread || 0);
  }
  const overallScore = normalizeScore(overallScoreRaw);
  const trendScore = normalizeScore(trendScoreRaw);
  const structureScore = normalizeScore(structureScoreRaw);
  const sessionScore = normalizeScore(sessionScoreRaw);
  const volatilityScore = normalizeScore(volatilityScoreRaw);
  const spreadScore = normalizeScore(spreadScoreRaw);

  // 5. Smart Entry Features
  let entryQuality = 0.0;
  let strategy = 0.0;
  let chasingFlag = 0.0;
  let expectedRR = 0.0;

  if (!memorySnapshot.smartEntry) {
    warnings.push("Missing smartEntry snapshot. Defaulted entryQuality, strategy, and expectedRR to 0.0.");
  } else {
    const se = memorySnapshot.smartEntry;
    const entryQualStr = String(se.entryQuality || "").toUpperCase();
    if (entryQualStr === "GRADE A+") entryQuality = 1.0;
    else if (entryQualStr === "GRADE A") entryQuality = 0.85;
    else if (entryQualStr === "GRADE B") entryQuality = 0.66;
    else if (entryQualStr === "GRADE C") entryQuality = 0.33;

    if (strategyStr === "MARKET") strategy = 1.0;
    else if (strategyStr === "LIMIT") strategy = 2.0;
    else if (strategyStr === "STOP") strategy = 3.0;
    else if (strategyStr === "WAIT") strategy = 4.0;

    chasingFlag = (
      strategyStr === "CHASE" || 
      String(se.alternativeStrategy).toUpperCase() === "CHASE" ||
      (memorySnapshot.decisionEngine?.reasons && memorySnapshot.decisionEngine.reasons.some(r => {
        const ru = r.toUpperCase();
        return ru.includes("CHAS") || ru.includes("CHASE") || ru.includes("CHASING");
      }))
    ) ? 1.0 : 0.0;

    expectedRR = Number(se.entryRR || 0);
  }

  // 6. Lifecycle Features
  const breakEvenTriggered = timeline.some(e => {
    const ev = String(e.event || "").toUpperCase();
    return ev.includes("BREAK_EVEN") || ev.includes("BREAKEVEN") || ev.includes("BREAK EVEN");
  }) ? 1.0 : 0.0;

  const trailingActivated = timeline.some(e => {
    const ev = String(e.event || "").toUpperCase();
    return ev.includes("TRAILING") || ev.includes("TRAIL");
  }) ? 1.0 : 0.0;

  const partialTpCount = timeline.filter(e => {
    const ev = String(e.event || "").toUpperCase();
    return ev.includes("PARTIAL_TP") || ev.includes("PARTIAL TP");
  }).length;

  let timeExit = 0.0;
  let marketExit = 0.0;
  if (!memorySnapshot.result || !memorySnapshot.result.outcome) {
    warnings.push("Missing result outcome snapshot. Defaulted winLoss, timeExit, and marketExit to 0.0.");
  } else {
    const outcomeStr = String(memorySnapshot.result.outcome).toUpperCase();
    timeExit = outcomeStr === "TIME_EXIT" ? 1.0 : 0.0;
    marketExit = outcomeStr === "MARKET_EXIT" ? 1.0 : 0.0;
  }

  // 7. Result Features
  let winLoss = 0.0;
  let profitVal = 0.0;
  let drawdownVal = 0.0;
  let mfeVal = 0.0;
  let maeVal = 0.0;
  let rMultipleVal = 0.0;

  if (!memorySnapshot.result) {
    warnings.push("Missing result snapshot. Defaulted netProfit, drawdown, mfe, mae, and rMultiple to 0.0.");
  } else {
    const result = memorySnapshot.result;
    const resOutcome = String(result.outcome || "").toUpperCase();
    if (resOutcome === "FULL_TP" || resOutcome === "PARTIAL_TP") {
      winLoss = 1.0;
    } else if (resOutcome === "SL") {
      winLoss = -1.0;
    } else if (Number(result.netProfit) > 0) {
      winLoss = 1.0;
    } else if (Number(result.netProfit) < 0) {
      winLoss = -1.0;
    }

    profitVal = Number(result.netProfit || 0);
    drawdownVal = Number(result.drawdown || 0);
    mfeVal = Number(result.mfe || 0);
    maeVal = Number(result.mae || 0);
    rMultipleVal = Number(result.rMultiple || 0);
  }

  const profit = normalizeProfit(profitVal);
  const drawdown = drawdownVal;
  const mfe = mfeVal;
  const mae = maeVal;
  const rMultiple = rMultipleVal;

  // Stable column ordering layout
  features.direction = direction;
  features.lotSize = lotSize;
  features.entryType = entryType;
  features.tradeDuration = tradeDuration;
  features.risk = risk;
  features.reward = reward;
  features.rr = rr;

  features.consensusScore = consensusScore;
  features.agreeingChannels = agreeingChannels;
  features.disagreeingChannels = disagreeingChannels;
  features.signalFreshness = signalFreshness;

  features.finalScore = finalScore;
  features.grade = grade;
  features.confidence = confidence;
  features.warningCount = warningCount;
  features.reasonCount = reasonCount;

  features.overallScore = overallScore;
  features.trendScore = trendScore;
  features.structureScore = structureScore;
  features.sessionScore = sessionScore;
  features.volatilityScore = volatilityScore;
  features.spreadScore = spreadScore;

  features.entryQuality = entryQuality;
  features.strategy = strategy;
  features.chasingFlag = chasingFlag;
  features.expectedRR = expectedRR;

  features.breakEvenTriggered = breakEvenTriggered;
  features.trailingActivated = trailingActivated;
  features.partialTpCount = partialTpCount;
  features.timeExit = timeExit;
  features.marketExit = marketExit;

  features.winLoss = winLoss;
  features.profit = profit;
  features.drawdown = drawdown;
  features.mfe = mfe;
  features.mae = mae;
  features.rMultiple = rMultiple;

  return phoenixDeepFreeze({
    features,
    warnings
  });
}

/**
 * Transforms completed raw trade memory and saves features to the ledger collection (or cache).
 * 
 * @param {Object} memorySnapshot - Raw trade memory snapshot
 * @returns {Promise<Object>} Immutable Phoenix Trade Feature document
 */
export async function recordTradeFeatures(memorySnapshot = {}) {
  const tradeId = memorySnapshot.tradeId;
  if (!tradeId) {
    throw new Error("Missing required parameter: tradeId");
  }

  const symbol = memorySnapshot.symbol || "XAUUSD";
  const { features, warnings } = generateFeatureVector(memorySnapshot);
  
  const payload = {
    tradeId,
    symbol,
    featureVersion: "1.0",
    rawSnapshot: memorySnapshot,
    features,
    warnings
  };

  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    // Unique check
    const exists = await PhoenixTradeFeature.findOne({ tradeId });
    if (exists) {
      throw new Error(`Duplicate feature entry detected. Trade ID '${tradeId}' already exists in the Phoenix Feature collection.`);
    }

    const newDoc = new PhoenixTradeFeature(payload);
    const savedDoc = await newDoc.save();
    const plainObj = savedDoc.toObject();

    // Cache locally as well
    localPhoenixTradeFeatures.set(tradeId, plainObj);
    return phoenixDeepFreeze(plainObj);
  } else {
    // Unique check local
    if (localPhoenixTradeFeatures.has(tradeId)) {
      throw new Error(`Duplicate feature entry detected. Trade ID '${tradeId}' already exists in the Phoenix Feature collection.`);
    }

    // Local validation
    const mockDoc = new PhoenixTradeFeature(payload);
    await mockDoc.validate();

    const plainObj = {
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...mockDoc.toObject()
    };

    localPhoenixTradeFeatures.set(tradeId, plainObj);
    return phoenixDeepFreeze(plainObj);
  }
}

/**
 * Query trade features from ledger (Read-Only).
 */
export async function getTradeFeatures(filter = {}, options = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const query = PhoenixTradeFeature.find(filter);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(options.limit);
    if (options.skip) query.skip(options.skip);

    const docs = await query.exec();
    return phoenixDeepFreeze(docs.map(doc => doc.toObject()));
  } else {
    let list = Array.from(localPhoenixTradeFeatures.values());
    
    Object.keys(filter).forEach(key => {
      list = list.filter(item => {
        const val = item[key];
        return val === filter[key];
      });
    });

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return phoenixDeepFreeze(list);
  }
}
