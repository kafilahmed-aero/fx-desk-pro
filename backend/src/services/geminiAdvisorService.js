import mongoose from "mongoose";
import crypto from "crypto";
import { config } from "../config/env.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getParsedSignals } from "./parsedSignalStore.js";
import { getCurrentPrice, getPriceHistory } from "./priceIngestionService.js";
import { getXauusdNewsContext } from "./xauusdNewsService.js";
import { saveNewAiRecommendationOutcome } from "./signalOutcomeStore.js";
import { getMultiTimeframeContext } from "./multiTimeframeIntelligenceService.js";
import { logger } from "../utils/logger.js";

// Configurable clustering tolerances
export const ENTRY_CLUSTER_TOLERANCE = 2.0;
export const SL_CLUSTER_TOLERANCE = 3.0;
export const TP_CLUSTER_TOLERANCE = 5.0;

/**
 * Clusters an array of numbers using an O(n log n) one-pass grouping algorithm.
 * Groups elements that fall within the given tolerance range consecutively.
 * @param {Array<number>} numbers - Array of numeric values
 * @param {number} tolerance - Grouping tolerance
 * @returns {Array<Object>} Sorted clusters with min, max, and count
 */
export function findClusters(numbers, tolerance) {
  if (!numbers || numbers.length === 0) return [];
  const sorted = [...numbers].sort((a, b) => a - b);
  const clusters = [];
  let currentCluster = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    // group using consecutive sorted values so naturally dense clusters remain together
    if (sorted[i] - sorted[i - 1] <= tolerance) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }
  clusters.push(currentCluster);

  return clusters
    .filter(c => c.length >= 2)
    .map(c => ({
      min: Math.min(...c),
      max: Math.max(...c),
      count: c.length
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Helper to compute distance from a price to a cluster
 */
function getDistanceToNearestCluster(currentPrice, clusters) {
  if (!clusters || clusters.length === 0) return { distance: null, cluster: null };
  let minDistance = Infinity;
  let nearestCluster = null;

  clusters.forEach(c => {
    let dist = 0;
    if (currentPrice >= c.min && currentPrice <= c.max) {
      dist = 0;
    } else {
      dist = Math.min(Math.abs(currentPrice - c.min), Math.abs(currentPrice - c.max));
    }
    if (dist < minDistance) {
      minDistance = dist;
      nearestCluster = c;
    }
  });

  return {
    distance: minDistance === Infinity ? null : minDistance,
    cluster: nearestCluster
  };
}

/**
 * Lookup price point in local memory array at offset
 */
function getPriceAtOffset(history, offsetMinutes, currentPrice) {
  if (!history || history.length === 0) return currentPrice;
  const nowMs = Date.now();
  const targetTimeMs = nowMs - offsetMinutes * 60 * 1000;

  let closestVal = currentPrice;
  let minDiff = Infinity;

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (typeof item.price !== "number") continue;
    const diff = Math.abs(item.timestamp - targetTimeMs);
    if (diff < minDiff) {
      minDiff = diff;
      closestVal = item.price;
    }
  }

  if (minDiff > (offsetMinutes + 10) * 60 * 1000) {
    return currentPrice;
  }
  return closestVal;
}

/**
 * Helper to compute price trends and momentum for macro indicators
 */
function calculateCrossMarketMetrics(pair, currentPrice, priceHistory) {
  if (currentPrice === null || !priceHistory || priceHistory.length === 0) {
    return null;
  }

  const price5m = getPriceAtOffset(priceHistory, 5, currentPrice);
  const price15m = getPriceAtOffset(priceHistory, 15, currentPrice);
  const price30m = getPriceAtOffset(priceHistory, 30, currentPrice);
  const price60m = getPriceAtOffset(priceHistory, 60, currentPrice);

  const change5m = currentPrice - price5m;
  const change15m = currentPrice - price15m;
  const change30m = currentPrice - price30m;
  const change60m = currentPrice - price60m;

  const momentumScore = (change5m * 0.4) + (change15m * 0.3) + (change30m * 0.2) + (change60m * 0.1);
  let momentumDirection = "Neutral";
  let momentumStrength = "Weak";

  const thresholdScale = currentPrice > 1000 ? 1.0 : (currentPrice > 50 ? 0.05 : 0.01);

  if (Math.abs(momentumScore) > 0.15 * thresholdScale) {
    momentumDirection = momentumScore > 0 ? "Bullish" : "Bearish";
    const absScore = Math.abs(momentumScore);
    if (absScore > 3.0 * thresholdScale) momentumStrength = "Strong";
    else if (absScore > 1.0 * thresholdScale) momentumStrength = "Moderate";
    else momentumStrength = "Weak";
  }

  let trendDirection = "Neutral";
  let trendStrength = "Weak";
  if (priceHistory.length >= 5) {
    const oldPrice = priceHistory[0].price;
    const netChange = currentPrice - oldPrice;
    const absChange = Math.abs(netChange);
    
    if (absChange > 2.0 * thresholdScale) {
      trendDirection = netChange > 0 ? "Bullish" : "Bearish";
      if (absChange > 6.0 * thresholdScale) trendStrength = "Strong";
      else trendStrength = "Moderate";
    }
  }

  return {
    current: currentPrice,
    change5m,
    change15m,
    change30m,
    change60m,
    trendDirection,
    trendStrength,
    momentumDirection,
    momentumStrength
  };
}

/**
 * Gets all active XAUUSD parsed signals from the DB or fallback memory store.
 * @returns {Promise<Array>} Array of parsed signals
 */
export async function getActiveXauusdSignals() {
  const isMongoConnected = mongoose.connection.readyState === 1;
  if (isMongoConnected) {
    try {
      return await ParsedSignal.find({
        pair: "XAUUSD",
        signalState: "ACTIVE"
      }).lean();
    } catch (err) {
      logger.error("gemini_advisor.db_query_failed", { error: err.message });
      return [];
    }
  } else {
    try {
      const signals = await getParsedSignals(100, { activeOnly: true });
      return signals.filter(s => s.pair === "XAUUSD" && s.signalState === "ACTIVE");
    } catch (err) {
      logger.error("gemini_advisor.in_memory_query_failed", { error: err.message });
      return [];
    }
  }
}

/**
 * Contacts the Gemini API (gemini-2.5-flash) to get a trade recommendation
 * based on active signals and current price.
 * @returns {Promise<Object>} Recommendation JSON or failure status object
 */
export async function getXauusdRecommendation(triggerSource = "MANUAL") {
  const startTime = Date.now();
  try {
    // 1. Check API Key
    if (!config.geminiApiKey) {
      logger.warn("gemini_advisor.missing_api_key");
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    // 2. Fetch price, signals, and news context
    const priceInfo = await getCurrentPrice("XAUUSD");
    const currentPrice = priceInfo ? priceInfo.price : null;
    const signals = await getActiveXauusdSignals();

    // Fetch DXY and US10Y prices & history for cross-market context
    let dxyPrice = null;
    let us10yPrice = null;
    try {
      const dxyInfo = await getCurrentPrice("DXY");
      dxyPrice = dxyInfo ? dxyInfo.price : null;
      const us10yInfo = await getCurrentPrice("US10Y");
      us10yPrice = us10yInfo ? us10yInfo.price : null;
    } catch (e) {
      logger.warn("gemini_advisor.fetch_macro_failed", { error: e.message });
    }

    // Query historical price from internal PriceIngestionService memory history buffer
    // NEVER query direct external Yahoo/Binance APIs from here.
    const priceHistory = getPriceHistory("XAUUSD");
    const dxyHistory = getPriceHistory("DXY");
    const us10yHistory = getPriceHistory("US10Y");

    let newsContext = { highImpactEvents: [], goldNews: [] };
    try {
      newsContext = await getXauusdNewsContext();
    } catch (newsErr) {
      logger.warn("gemini_advisor.fetch_news_failed", { error: newsErr.message });
    }

    // Calculate Signal Intelligence Metrics
    const now = new Date();
    const totalActive = signals.length;
    const buySignals = signals.filter(s => s.action === "BUY");
    const sellSignals = signals.filter(s => s.action === "SELL");
    const buyCount = buySignals.length;
    const sellCount = sellSignals.length;
    const buyPercentage = totalActive > 0 ? (buyCount / totalActive) * 100 : 0;
    const sellPercentage = totalActive > 0 ? (sellCount / totalActive) * 100 : 0;

    const signalAgesMs = signals.map(s => {
      const time = new Date(s.timestamp || s.createdAt || now);
      return Math.max(0, now.getTime() - time.getTime());
    });

    const newestSignalAgeMin = signalAgesMs.length > 0 ? Math.min(...signalAgesMs) / 60000 : 0;
    const oldestSignalAgeMin = signalAgesMs.length > 0 ? Math.max(...signalAgesMs) / 60000 : 0;
    const averageSignalAgeMin = signalAgesMs.length > 0 ? (signalAgesMs.reduce((a, b) => a + b, 0) / signalAgesMs.length) / 60000 : 0;

    // Time Distribution Bins
    const timeDistribution = {
      "0-5 min": 0,
      "5-15 min": 0,
      "15-30 min": 0,
      "30-60 min": 0,
      "60+ min": 0
    };
    signalAgesMs.forEach(ageMs => {
      const ageMin = ageMs / 60000;
      if (ageMin <= 5) timeDistribution["0-5 min"]++;
      else if (ageMin <= 15) timeDistribution["5-15 min"]++;
      else if (ageMin <= 30) timeDistribution["15-30 min"]++;
      else if (ageMin <= 60) timeDistribution["30-60 min"]++;
      else timeDistribution["60+ min"]++;
    });

    // Inflow Density
    const signalDensity = {
      "last 5 min": signalAgesMs.filter(ageMs => ageMs / 60000 <= 5).length,
      "last 15 min": signalAgesMs.filter(ageMs => ageMs / 60000 <= 15).length,
      "last 30 min": signalAgesMs.filter(ageMs => ageMs / 60000 <= 30).length,
      "last 60 min": signalAgesMs.filter(ageMs => ageMs / 60000 <= 60).length
    };

    // Direction Agreement
    let directionAgreement = "Neutral";
    if (totalActive > 0) {
      if (buyPercentage >= 80) directionAgreement = "Strong BUY";
      else if (buyPercentage > 50) directionAgreement = "Moderate BUY";
      else if (sellPercentage >= 80) directionAgreement = "Strong SELL";
      else if (sellPercentage > 50) directionAgreement = "Moderate SELL";
      else directionAgreement = "Neutral";
    }

    // Extract entries, stop losses, and take profits for cluster analysis
    const entries = [];
    const stopLosses = [];
    const takeProfits = [];
    let totalSLDistance = 0;
    let validSLDistanceCount = 0;

    signals.forEach(s => {
      let entryPrice = null;
      if (typeof s.entry === "number" && s.entry > 0) {
        entryPrice = s.entry;
        entries.push(s.entry);
      } else if (Array.isArray(s.entryRange) && s.entryRange.length > 0) {
        const validRange = s.entryRange.filter(val => typeof val === "number" && val > 0);
        if (validRange.length > 0) {
          entryPrice = validRange.reduce((a, b) => a + b, 0) / validRange.length;
          entries.push(...validRange);
        }
      }

      const sl = s.effectiveStopLoss !== undefined && s.effectiveStopLoss !== null ? s.effectiveStopLoss : s.stopLoss;
      if (typeof sl === "number" && sl > 0) {
        stopLosses.push(sl);
        if (entryPrice !== null) {
          totalSLDistance += Math.abs(entryPrice - sl);
          validSLDistanceCount++;
        }
      }

      if (Array.isArray(s.remainingTargets)) {
        s.remainingTargets.forEach(t => {
          if (typeof t === "number" && t > 0) takeProfits.push(t);
        });
      } else if (Array.isArray(s.targets)) {
        s.targets.forEach(t => {
          const val = typeof t === "object" ? t.target : t;
          if (typeof val === "number" && val > 0) takeProfits.push(val);
        });
      } else if (typeof s.target === "number" && s.target > 0) {
        takeProfits.push(s.target);
      }
    });

    // Run Cluster Analysis
    const entryClusters = findClusters(entries, ENTRY_CLUSTER_TOLERANCE);
    const slClusters = findClusters(stopLosses, SL_CLUSTER_TOLERANCE);
    const tpClusters = findClusters(takeProfits, TP_CLUSTER_TOLERANCE);

    const entryClusterWidth = entryClusters.length > 0 ? (entryClusters[0].max - entryClusters[0].min) : 0;
    const tpClusterWidth = tpClusters.length > 0 ? (tpClusters[0].max - tpClusters[0].min) : 0;

    // SL Stats (Spread, average distance, consistency)
    const slSpread = stopLosses.length > 1 ? Math.max(...stopLosses) - Math.min(...stopLosses) : 0;
    const averageSLDistance = validSLDistanceCount > 0 ? totalSLDistance / validSLDistanceCount : 0;

    let slConsistency = 100;
    if (stopLosses.length > 1) {
      const slAvg = stopLosses.reduce((a, b) => a + b, 0) / stopLosses.length;
      const slVariance = stopLosses.reduce((sum, val) => sum + Math.pow(val - slAvg, 2), 0) / stopLosses.length;
      const slStdDev = Math.sqrt(slVariance);
      slConsistency = Math.max(0, Math.round(100 - (slStdDev / 10) * 100));
    }

    // Consensus Strength Score (0-100)
    let consensusStrength = 0;
    if (totalActive > 0) {
      const agreement = Math.max(buyPercentage, sellPercentage);
      const agreementFactor = Math.max(0, (agreement - 50) * 2);

      let freshnessFactor = 20;
      if (averageSignalAgeMin <= 15) freshnessFactor = 100;
      else if (averageSignalAgeMin <= 60) freshnessFactor = 100 - ((averageSignalAgeMin - 15) / 45) * 80;

      let countFactor = 30;
      if (totalActive === 2) countFactor = 60;
      else if (totalActive === 3) countFactor = 80;
      else if (totalActive >= 4) countFactor = 100;

      consensusStrength = Math.round((agreementFactor * 0.5) + (freshnessFactor * 0.25) + (countFactor * 0.25));
    }

    // Signal Quality Summary (High, Medium, Low)
    let signalQualitySummary = "Low";
    if (totalActive > 0) {
      let score = 0;
      if (directionAgreement.startsWith("Strong")) score += 40;
      else if (directionAgreement.startsWith("Moderate")) score += 20;

      if (averageSignalAgeMin <= 15) score += 30;
      else if (averageSignalAgeMin <= 60) score += 15;

      if (entryClusters.length > 0) {
        const primaryCluster = entryClusters[0];
        const width = primaryCluster.max - primaryCluster.min;
        if (width <= 2.0) score += 30;
        else if (width <= 5.0) score += 15;
      } else {
        if (totalActive === 1) score += 30;
      }

      if (score >= 70) signalQualitySummary = "High";
      else if (score >= 40) signalQualitySummary = "Medium";
      else signalQualitySummary = "Low";
    }

    // Market Window Parameters & Hist. changes (using cached priceHistory buffer)
    const price5m = getPriceAtOffset(priceHistory, 5, currentPrice);
    const price15m = getPriceAtOffset(priceHistory, 15, currentPrice);
    const price30m = getPriceAtOffset(priceHistory, 30, currentPrice);
    const price60m = getPriceAtOffset(priceHistory, 60, currentPrice);

    const change5m = currentPrice - price5m;
    const change15m = currentPrice - price15m;
    const change30m = currentPrice - price30m;
    const change60m = currentPrice - price60m;

    const cutoff60m = Date.now() - 60 * 60 * 1000;
    const recentHistoryPrices = priceHistory.filter(h => h.timestamp >= cutoff60m).map(h => h.price);

    let highestPrice60m = currentPrice;
    let lowestPrice60m = currentPrice;
    let range60m = 0;
    let volatilityLevel = "Medium";

    if (recentHistoryPrices.length > 0) {
      highestPrice60m = Math.max(...recentHistoryPrices, currentPrice);
      lowestPrice60m = Math.min(...recentHistoryPrices, currentPrice);
      range60m = highestPrice60m - lowestPrice60m;

      if (recentHistoryPrices.length > 1) {
        const avg = recentHistoryPrices.reduce((a, b) => a + b, 0) / recentHistoryPrices.length;
        const variance = recentHistoryPrices.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recentHistoryPrices.length;
        const stdDev = Math.sqrt(variance);
        
        if (stdDev < 1.0) volatilityLevel = "Low";
        else if (stdDev > 4.0) volatilityLevel = "High";
        else volatilityLevel = "Medium";
      }
    }

    // Intraday Momentum Vectors
    const momentumScore = (change5m * 0.4) + (change15m * 0.3) + (change30m * 0.2) + (change60m * 0.1);
    let momentumDirection = "Neutral";
    let momentumStrength = "Weak";

    if (Math.abs(momentumScore) > 0.15) {
      momentumDirection = momentumScore > 0 ? "Bullish" : "Bearish";
      const absScore = Math.abs(momentumScore);
      if (absScore > 3.0) momentumStrength = "Strong";
      else if (absScore > 1.0) momentumStrength = "Moderate";
      else momentumStrength = "Weak";
    }

    // Cluster Distance Calculations
    const entryDistInfo = getDistanceToNearestCluster(currentPrice, entryClusters);
    const slDistInfo = getDistanceToNearestCluster(currentPrice, slClusters);
    const tpDistInfo = getDistanceToNearestCluster(currentPrice, tpClusters);

    let nearestClusterType = "Entry";
    let nearestClusterDistance = Infinity;
    let nearestClusterWidth = 0;
    let nearestClusterRange = null;

    if (entryDistInfo.distance !== null && entryDistInfo.distance < nearestClusterDistance) {
      nearestClusterDistance = entryDistInfo.distance;
      nearestClusterType = "Entry";
      nearestClusterRange = entryDistInfo.cluster;
    }
    if (tpDistInfo.distance !== null && tpDistInfo.distance < nearestClusterDistance) {
      nearestClusterDistance = tpDistInfo.distance;
      nearestClusterType = "Take Profit (TP)";
      nearestClusterRange = tpDistInfo.cluster;
    }
    if (slDistInfo.distance !== null && slDistInfo.distance < nearestClusterDistance) {
      nearestClusterDistance = slDistInfo.distance;
      nearestClusterType = "Stop Loss (SL)";
      nearestClusterRange = slDistInfo.cluster;
    }

    if (nearestClusterRange) {
      nearestClusterWidth = nearestClusterRange.max - nearestClusterRange.min;
    } else {
      nearestClusterDistance = 0;
    }

    // Market Alignment structured tag
    let marketAlignment = "Price trading inside neutral channel";
    if (entryDistInfo.distance === 0) {
      marketAlignment = "Price inside Entry";
    } else if (entryDistInfo.distance !== null && entryDistInfo.distance <= ENTRY_CLUSTER_TOLERANCE) {
      marketAlignment = "Price approaching Entry";
    } else if (tpDistInfo.distance === 0 || (tpDistInfo.distance !== null && tpDistInfo.distance <= 2.0)) {
      marketAlignment = "Price near TP";
    } else if (tpDistInfo.cluster && ((directionAgreement.includes("BUY") && currentPrice > tpDistInfo.cluster.max) || (directionAgreement.includes("SELL") && currentPrice < tpDistInfo.cluster.min))) {
      marketAlignment = "Price beyond TP";
    } else if (slDistInfo.distance !== null && slDistInfo.distance <= 1.5) {
      marketAlignment = "Price near SL";
    } else if (slDistInfo.cluster && ((directionAgreement.includes("BUY") && currentPrice < slDistInfo.cluster.min) || (directionAgreement.includes("SELL") && currentPrice > slDistInfo.cluster.max))) {
      marketAlignment = "Price below SL";
    }

    // ==================================================
    // DECISION INTELLIGENCE CALCULATIONS
    // ==================================================
    let readinessScore = 50;
    let readinessReason = "Insufficient active signal consensus or high volatility risk.";

    if (totalActive > 0) {
      let score = 0;
      // Consensus factor (max 40 pts)
      score += (consensusStrength / 100) * 40;

      // Alignment factor (max 30 pts)
      if (marketAlignment === "Price inside Entry") score += 30;
      else if (marketAlignment === "Price approaching Entry") score += 20;
      else if (marketAlignment === "Price near TP") score += 10;

      // Volatility/Risk penalty/bonus
      if (volatilityLevel === "High") score -= 15;
      else if (volatilityLevel === "Low") score += 15;

      // Momentum factor (max 15 pts)
      if (momentumDirection !== "Neutral" && directionAgreement.includes(momentumDirection)) {
        score += 15;
      }

      readinessScore = Math.min(100, Math.max(0, Math.round(score)));
    }

    let readinessRating = "AVOID";
    if (readinessScore >= 85) {
      readinessRating = "READY";
      readinessReason = "Consensus is strong, entry levels are tightly grouped, and market momentum is supportive.";
    } else if (readinessScore >= 60) {
      readinessRating = "WAIT";
      readinessReason = "Market structure is viable, but waiting for price pullback to entry zones or momentum alignment.";
    } else {
      readinessRating = "AVOID";
      if (volatilityLevel === "High") {
        readinessReason = "Volatility risk is excessive. Stand aside.";
      } else if (consensusStrength < 50) {
        readinessReason = "Active signals have weak consensus. High disagreement.";
      } else {
        readinessReason = "Price is extended past targets or stop levels. Avoid trading.";
      }
    }

    let decisionConfidence = 50;
    let confidenceReason = "Baseline confidence for limited signal counts.";

    if (totalActive > 0) {
      let conf = 0;
      // Consensus alignment (max 50 pts)
      conf += (consensusStrength / 100) * 50;

      // Signal consistency/SL cluster (max 30 pts)
      conf += (slConsistency / 100) * 30;

      // News impact (max 20 pts)
      if (newsContext.highImpactEvents.length === 0) conf += 20;
      else conf += 10;

      decisionConfidence = Math.min(100, Math.max(0, Math.round(conf)));
    }

    if (decisionConfidence >= 80) {
      confidenceReason = "High confidence driven by high signal consensus and low macro event risk.";
    } else if (decisionConfidence >= 50) {
      confidenceReason = "Moderate confidence. Support exists but limited by news uncertainties or SL consistency spreads.";
    } else {
      confidenceReason = "Low confidence due to signal conflict, wide SL spreads, or high-impact macroeconomic events.";
    }

    let opportunityGrade = "D";
    const combinedScore = (readinessScore * 0.6) + (decisionConfidence * 0.4);
    if (combinedScore >= 90) opportunityGrade = "A+";
    else if (combinedScore >= 75) opportunityGrade = "A";
    else if (combinedScore >= 60) opportunityGrade = "B";
    else if (combinedScore >= 45) opportunityGrade = "C";
    else opportunityGrade = "D";

    let riskLevel = "MEDIUM";
    let riskReason = "Standard market exposure parameters.";

    if (volatilityLevel === "High" || slSpread > 10.0 || consensusStrength < 40) {
      riskLevel = "HIGH";
      if (volatilityLevel === "High") riskReason = "Elevated risk due to high intraday volatility.";
      else if (slSpread > 10.0) riskReason = "Elevated risk due to wide Stop Loss divergence.";
      else riskReason = "Elevated risk due to strong signal disagreement.";
    } else if (volatilityLevel === "Low" && slSpread <= 3.0 && consensusStrength >= 80) {
      riskLevel = "LOW";
      riskReason = "Low volatility coupled with tightly aligned stop levels and high consensus.";
    } else {
      riskLevel = "MEDIUM";
      riskReason = "Moderate volatility and stable stop-loss spreads within tolerance limits.";
    }

    // Conflict severity warnings
    const conflictsList = [];
    if (directionAgreement.includes("BUY") && momentumDirection === "Bearish") {
      conflictsList.push("BUY signal consensus is active, but short-term market momentum is bearish.");
    }
    if (directionAgreement.includes("SELL") && momentumDirection === "Bullish") {
      conflictsList.push("SELL signal consensus is active, but short-term market momentum is bullish.");
    }
    if (directionAgreement.includes("BUY") && marketAlignment === "Price beyond TP") {
      conflictsList.push("Consensus is BUY, but current price has already extended past take-profit levels.");
    }
    if (directionAgreement.includes("SELL") && marketAlignment === "Price below SL") {
      conflictsList.push("Consensus is SELL, but current price has traded beyond stop levels.");
    }
    if (totalActive >= 3 && consensusStrength < 50) {
      conflictsList.push("Multiple active signals are in direct opposition, resulting in low consensus strength.");
    }

    let conflictSeverity = "None";
    if (conflictsList.length === 1) {
      conflictSeverity = "Minor";
    } else if (conflictsList.length === 2) {
      conflictSeverity = "Moderate";
    } else if (conflictsList.length >= 3) {
      conflictSeverity = "Major";
    }

    // Strengths, Weaknesses, Recommendations list
    const strengths = [];
    const weaknesses = [];
    let overallRecommendation = "Stand aside. Wait for market structure alignment.";

    if (consensusStrength >= 70) {
      strengths.push(`Strong direction consensus (${directionAgreement}) among active signals.`);
    }
    if (slConsistency >= 80) {
      strengths.push("Tightly clustered Stop Loss boundaries suggesting defined risk levels.");
    }
    if (momentumDirection !== "Neutral" && directionAgreement.includes(momentumDirection)) {
      strengths.push(`Momentum (${momentumDirection}) is aligned with signal direction.`);
    }

    if (volatilityLevel === "High") {
      weaknesses.push("High market volatility increases risk of execution slippage or premature SL hits.");
    }
    if (conflictsList.length > 0) {
      conflictsList.forEach(c => weaknesses.push(c));
    }
    if (entryDistInfo.distance > ENTRY_CLUSTER_TOLERANCE) {
      weaknesses.push(`Price is extended from the nearest entry cluster by ${entryDistInfo.distance.toFixed(2)}.`);
    }

    if (readinessRating === "READY") {
      overallRecommendation = `Initiate ${directionAgreement} positions within current entry clusters. Manage risk according to SL targets.`;
    } else if (readinessRating === "WAIT") {
      overallRecommendation = `Wait for price retracement closer to primary entry zone (${entryDistInfo.cluster ? entryDistInfo.cluster.min.toFixed(2) + "-" + entryDistInfo.cluster.max.toFixed(2) : "N/A"}) before executing.`;
    } else {
      overallRecommendation = "Do not trade. Risk metrics or signal contradictions indicate poor trade probability.";
    }

    if (strengths.length === 0) strengths.push("None identified.");
    if (weaknesses.length === 0) weaknesses.push("No significant weaknesses detected.");

    // Extensible Decision Intelligence Object
    const decisionIntelligence = {
      marketSummary: `${momentumStrength} ${momentumDirection} Momentum | ${volatilityLevel} Volatility | ${marketAlignment}`,
      readinessScore,
      readinessRating,
      readinessReason,
      decisionConfidence,
      confidenceReason,
      opportunityGrade,
      riskLevel,
      riskReason,
      entryTiming: marketAlignment === "Price inside Entry" ? "NOW" : (marketAlignment.includes("TP") ? "WAIT FOR RETRACEMENT" : "WAIT FOR BREAKOUT"),
      conflictSeverity,
      conflicts: conflictsList,
      strengths,
      weaknesses,
      recommendation: overallRecommendation
    };

    // ==================================================
    // AI EXPERIENCE LAYER CALCULATIONS
    // ==================================================
    const aiExperience = {
      learningStatus: "Collecting AI recommendation history.",
      recommendationHistory: "Insufficient.",
      confidenceSource: [
        "Signal Intelligence",
        "Market Intelligence",
        "Decision Intelligence",
        "News Context"
      ],
      experienceNotes: "AI recommendation history is not yet sufficient for historical performance analysis.",
      // Placeholders for future compatibility
      aiWinRate: null,
      aiDrawdown: null,
      aiStreaks: null,
      aiProfitFactor: null,
      aiAccuracy: null
    };

    // Raw signals format
    const formattedSignals = signals.map((s, idx) => {
      const direction = s.action || "N/A";
      const entry = s.entry !== null ? s.entry : (s.entryRange && s.entryRange.length > 0 ? s.entryRange.join("-") : "N/A");
      const sl = s.stopLoss !== null ? s.stopLoss : (s.effectiveStopLoss !== null ? s.effectiveStopLoss : "N/A");
      const tp = s.targets && s.targets.length > 0
        ? s.targets.map(t => typeof t === "object" ? t.target : t).filter(val => val !== null && val !== undefined).join(", ")
        : (s.target !== null ? s.target : "N/A");
      const channel = s.channelTitle || s.channel || "N/A";
      const timestamp = s.timestamp ? new Date(s.timestamp).toISOString() : "N/A";

      return `Signal #${idx + 1}:
  - Direction: ${direction}
  - Entry: ${entry}
  - SL: ${sl}
  - TP: ${tp}
  - Channel Name: ${channel}
  - Timestamp: ${timestamp}`;
    }).join("\n\n");

    // ==================================================
    // ADVANCED MARKET CONTEXT CALCULATIONS (Phase 5.2)
    // ==================================================
    let high24h = currentPrice;
    let low24h = currentPrice;
    if (priceHistory && priceHistory.length > 0) {
      const prices = priceHistory.map(h => h.price).filter(p => typeof p === "number" && !Number.isNaN(p));
      if (prices.length > 0) {
        high24h = Math.max(...prices, currentPrice);
        low24h = Math.min(...prices, currentPrice);
      }
    }

    const dailyRange = high24h !== null && low24h !== null ? Number((high24h - low24h).toFixed(2)) : "Unavailable";
    const distToHigh = (currentPrice !== null && high24h !== null) ? Number(Math.abs(high24h - currentPrice).toFixed(2)) : "Unavailable";
    const distToLow = (currentPrice !== null && low24h !== null) ? Number(Math.abs(currentPrice - low24h).toFixed(2)) : "Unavailable";

    let atr = "Unavailable";
    if (priceHistory && priceHistory.length >= 2) {
      const diffs = [];
      for (let i = 1; i < priceHistory.length; i++) {
        const diff = Math.abs(priceHistory[i].price - priceHistory[i-1].price);
        diffs.push(diff);
      }
      if (diffs.length > 0) {
        const avg = diffs.reduce((s, v) => s + v, 0) / diffs.length;
        atr = Number(avg.toFixed(2));
      }
    }

    // ==================================================
    // INSTITUTIONAL SESSION MARKET STRUCTURE CALCULATIONS (Phase 1.1)
    // ==================================================
    const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const startOfYesterdayUtc = startOfTodayUtc - 24 * 60 * 60 * 1000;

    const yesterdayPrices = [];
    const asianPrices = [];
    const londonPrices = [];
    const nyPrices = [];

    if (priceHistory && priceHistory.length > 0) {
      priceHistory.forEach(item => {
        if (typeof item.price !== "number" || Number.isNaN(item.price)) return;
        const ts = item.timestamp;
        const tDate = new Date(ts);
        const hour = tDate.getUTCHours();

        // Yesterday vs Today
        if (ts >= startOfYesterdayUtc && ts < startOfTodayUtc) {
          yesterdayPrices.push(item.price);
        }

        // Asian session: 00:00 to 09:00 UTC
        if (hour >= 0 && hour < 9) {
          asianPrices.push(item.price);
        }
        // London session: 08:00 to 16:00 UTC
        if (hour >= 8 && hour < 16) {
          londonPrices.push(item.price);
        }
        // NY session: 13:00 to 21:00 UTC
        if (hour >= 13 && hour < 21) {
          nyPrices.push(item.price);
        }
      });
    }

    const pdh = yesterdayPrices.length > 0 ? Math.max(...yesterdayPrices) : null;
    const pdl = yesterdayPrices.length > 0 ? Math.min(...yesterdayPrices) : null;

    const asianHigh = asianPrices.length > 0 ? Math.max(...asianPrices) : null;
    const asianLow = asianPrices.length > 0 ? Math.min(...asianPrices) : null;

    const londonHigh = londonPrices.length > 0 ? Math.max(...londonPrices) : null;
    const londonLow = londonPrices.length > 0 ? Math.min(...londonPrices) : null;

    const nyHigh = nyPrices.length > 0 ? Math.max(...nyPrices) : null;
    const nyLow = nyPrices.length > 0 ? Math.min(...nyPrices) : null;

    // Premium/Discount Zone calculation relative to Today's High/Low
    let premiumDiscount = "NEUTRAL";
    let percentThroughRange = 50;
    let distFromMidpoint = 0;
    const midpoint = (high24h + low24h) / 2;

    if (high24h > low24h && currentPrice !== null) {
      percentThroughRange = ((currentPrice - low24h) / (high24h - low24h)) * 100;
      distFromMidpoint = currentPrice - midpoint;
      if (percentThroughRange > 60) {
        premiumDiscount = "PREMIUM";
      } else if (percentThroughRange < 40) {
        premiumDiscount = "DISCOUNT";
      } else {
        premiumDiscount = "NEUTRAL";
      }
    }

    // Helper for relative position
    const getSessionRelation = (price, high, low) => {
      if (price === null || high === null || low === null) return "Unavailable";
      if (price > high) return `ABOVE (Distance to High: ${(price - high).toFixed(2)} USD)`;
      if (price < low) return `BELOW (Distance to Low: ${(low - price).toFixed(2)} USD)`;
      return `INSIDE (Dist to High: ${(high - price).toFixed(2)} USD, Dist to Low: ${(price - low).toFixed(2)} USD)`;
    };

    const asianRelation = getSessionRelation(currentPrice, asianHigh, asianLow);
    const londonRelation = getSessionRelation(currentPrice, londonHigh, londonLow);
    const nyRelation = getSessionRelation(currentPrice, nyHigh, nyLow);

    // ==================================================
    // CROSS-MARKET INTELLIGENCE CALCULATIONS (Phase 1.2)
    // ==================================================
    const dxyStats = calculateCrossMarketMetrics("DXY", dxyPrice, dxyHistory);
    const us10yStats = calculateCrossMarketMetrics("US10Y", us10yPrice, us10yHistory);

    let dxyCorrelation = "Neutral cross-market conditions";
    let yieldAlignment = "Neutral cross-market conditions";
    let macroAlignment = "Neutral/Mixed Macro Conditions";

    if (dxyStats && momentumDirection !== "Neutral") {
      const goldBull = momentumDirection === "Bullish";
      const dxyBull = dxyStats.momentumDirection === "Bullish";
      const dxyBear = dxyStats.momentumDirection === "Bearish";

      if (goldBull && dxyBear) {
        dxyCorrelation = "Gold rising while DXY falling";
      } else if (!goldBull && dxyBull) {
        dxyCorrelation = "Gold falling while DXY rising";
      } else if (goldBull && dxyBull) {
        dxyCorrelation = "Gold rising despite strong DXY";
      } else if (!goldBull && dxyBear) {
        dxyCorrelation = "Gold and DXY diverging";
      }
    }

    if (us10yStats && momentumDirection !== "Neutral") {
      const goldBull = momentumDirection === "Bullish";
      const yieldBull = us10yStats.momentumDirection === "Bullish";
      const yieldBear = us10yStats.momentumDirection === "Bearish";

      if (yieldBull && !goldBull) {
        yieldAlignment = "Gold weakening with rising yields";
      } else if (yieldBear && goldBull) {
        yieldAlignment = "Gold strengthening with falling yields";
      }
    }

    if (dxyStats && us10yStats && momentumDirection !== "Neutral") {
      const goldBull = momentumDirection === "Bullish";
      const dxyBear = dxyStats.momentumDirection === "Bearish";
      const yieldBear = us10yStats.momentumDirection === "Bearish";
      const dxyBull = dxyStats.momentumDirection === "Bullish";
      const yieldBull = us10yStats.momentumDirection === "Bullish";

      if (goldBull && dxyBear && yieldBear) {
        macroAlignment = "Perfect Bullish Macro Alignment";
      } else if (!goldBull && dxyBull && yieldBull) {
        macroAlignment = "Perfect Bearish Macro Alignment";
      }
    }

    // Support and Resistance: recent swing highs, recent swing lows, and existing price clusters.
    const levels = [];
    entryClusters.forEach(c => { levels.push(c.min, c.max); });
    slClusters.forEach(c => { levels.push(c.min, c.max); });
    tpClusters.forEach(c => { levels.push(c.min, c.max); });
    if (priceHistory && priceHistory.length > 0) {
      const prices = priceHistory.map(h => h.price).filter(p => typeof p === "number" && !Number.isNaN(p));
      if (prices.length > 0) {
        levels.push(Math.max(...prices), Math.min(...prices));
      }
    }

    let nearestSupport = "Unavailable";
    let nearestResistance = "Unavailable";
    if (currentPrice !== null) {
      const supports = levels.filter(v => v < currentPrice);
      const resistances = levels.filter(v => v > currentPrice);
      if (supports.length > 0) {
        nearestSupport = Number(Math.max(...supports).toFixed(2));
      }
      if (resistances.length > 0) {
        nearestResistance = Number(Math.min(...resistances).toFixed(2));
      }
    }

    let currentSpread = "Unavailable";
    if (priceInfo && priceInfo.ask !== undefined && priceInfo.bid !== undefined) {
      const diff = priceInfo.ask - priceInfo.bid;
      if (diff > 0) {
        currentSpread = Number(diff.toFixed(2));
      }
    }

    let marketLiquidity = "Normal";
    const currentHourIST = new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
    const isWeekend = [0, 6].includes(new Date().getDay());
    if (isWeekend) {
      marketLiquidity = "Very Low";
    } else if (currentHourIST >= "18:30" && currentHourIST <= "21:30") {
      marketLiquidity = "Very High";
    } else if (currentHourIST >= "13:30" && currentHourIST < "23:00") {
      marketLiquidity = "High";
    } else if (currentHourIST >= "06:00" && currentHourIST < "13:30") {
      marketLiquidity = "Normal";
    } else {
      marketLiquidity = "Low";
    }

    let trendStrength = "Weak";
    if (priceHistory && priceHistory.length >= 5) {
      const latestPrice = currentPrice;
      const oldPrice = priceHistory[0].price;
      const netChange = Math.abs(latestPrice - oldPrice);
      if (netChange > 6.0) trendStrength = "Strong";
      else if (netChange > 2.0) trendStrength = "Moderate";
      else trendStrength = "Weak";
    }

    let marketPhase = "Ranging";
    if (trendStrength === "Strong") {
      if (momentumDirection !== "Neutral") {
        marketPhase = "Trending";
      } else {
        marketPhase = "Pullback";
      }
    } else if (trendStrength === "Moderate") {
      if (Math.abs(momentumScore) > 1.5) {
        marketPhase = "Breakout";
      } else {
        marketPhase = "Pullback";
      }
    } else {
      if (Math.abs(momentumScore) > 2.0) {
        marketPhase = "Reversal";
      } else {
        marketPhase = "Ranging";
      }
    }

    let marketBias = "Neutral";
    if (buyPercentage > 60) marketBias = "Bullish";
    else if (sellPercentage > 60) marketBias = "Bearish";
    else if (momentumDirection !== "Neutral") marketBias = momentumDirection;

    let distanceToEntry = "Unavailable";
    if (currentPrice !== null && entryDistInfo.distance !== null) {
      distanceToEntry = `${Number(entryDistInfo.distance.toFixed(2))} USD`;
    }

    // Macro events separation
    const liveEvents = [];
    const upcomingEvents = [];
    const recentlyReleasedEvents = [];
    const nowMs = Date.now();
    (newsContext.highImpactEvents || []).forEach(e => {
      const eventTime = new Date(e.publishedAt).getTime();
      if (Number.isNaN(eventTime)) {
        recentlyReleasedEvents.push(e);
        return;
      }
      const diffMin = (eventTime - nowMs) / 60000;
      if (diffMin >= -15 && diffMin <= 15) {
        liveEvents.push(e);
      } else if (diffMin > 15) {
        upcomingEvents.push(e);
      } else {
        recentlyReleasedEvents.push(e);
      }
    });

    const formatEventItem = (e, idx) => `Event #${idx + 1}:
  - Title: ${e.title}
  - Source: ${e.source}
  - Time/Date: ${e.publishedAt}
  - Impact: ${e.impact}
  - Details: ${e.summary}`;

    const formattedLiveEvents = liveEvents.length > 0 ? liveEvents.map(formatEventItem).join("\n\n") : "None";
    const formattedUpcomingEvents = upcomingEvents.length > 0 ? upcomingEvents.map(formatEventItem).join("\n\n") : "None";
    const formattedRecentlyReleasedEvents = recentlyReleasedEvents.length > 0 ? recentlyReleasedEvents.map(formatEventItem).join("\n\n") : "None";

    const formattedNews = newsContext.goldNews && newsContext.goldNews.length > 0
      ? newsContext.goldNews.map((n, idx) => `News #${idx + 1}:
  - Title: ${n.title}
  - Source: ${n.source}
  - Time/Date: ${n.publishedAt}
  - Summary: ${n.summary}`).join("\n\n")
      : "None";

    const entryClusterText = entryClusters.length > 0
      ? entryClusters.map(c => `- Cluster of ${c.count} signals suggesting entries between ${c.min.toFixed(2)} and ${c.max.toFixed(2)} (width: ${(c.max - c.min).toFixed(2)})`).join("\n")
      : "No significant entry price clusters identified.";

    const slClusterText = slClusters.length > 0
      ? slClusters.map(c => `- Cluster of ${c.count} signals concentrating Stop Loss (SL) levels between ${c.min.toFixed(2)} and ${c.max.toFixed(2)} (width: ${(c.max - c.min).toFixed(2)})`).join("\n")
      : "No significant Stop Loss (SL) clusters identified.";

    const tpClusterText = tpClusters.length > 0
      ? tpClusters.map(c => `- Cluster of ${c.count} signals aligning Take Profit (TP) levels between ${c.min.toFixed(2)} and ${c.max.toFixed(2)} (width: ${(c.max - c.min).toFixed(2)})`).join("\n")
      : "No significant Take Profit (TP) clusters identified.";

    // Fetch and format Multi-Timeframe Context
    const mtfContext = getMultiTimeframeContext("XAUUSD");

    const formatMtfTimeframeBlock = (name, data) => {
      if (!data || data.status === "INSUFFICIENT_HISTORY") {
        return `• ${name} Timeframe:
  - Status: INSUFFICIENT_HISTORY
  - Insufficient historical data.`;
      }
      return `• ${name} Timeframe:
  - Status: ${data.status}
  - Current Price: ${data.currentPrice}
  - Highest Price: ${data.highestPrice}
  - Lowest Price: ${data.lowestPrice}
  - Trading Range: ${data.tradingRange}
  - ATR: ${data.ATR.toFixed(2)}
  - Trend Direction: ${data.trendDirection}
  - Trend Score: ${data.trendScore}
  - Trend Strength: ${data.trendStrength}
  - Momentum: ${data.momentum}
  - Momentum Score: ${data.momentumScore}
  - Volatility: ${data.volatility}
  - Volatility Value: ${data.volatilityValue.toFixed(4)}
  - Market Phase: ${data.marketPhase}
  - Market Phase Confidence: ${data.marketPhaseConfidence}
  - History Coverage: ${data.historyCoverage}%`;
    };

    const formattedMtfText = [
      formatMtfTimeframeBlock("1 Minute", mtfContext["1m"]),
      formatMtfTimeframeBlock("5 Minute", mtfContext["5m"]),
      formatMtfTimeframeBlock("15 Minute", mtfContext["15m"]),
      formatMtfTimeframeBlock("1 Hour", mtfContext["1h"]),
      formatMtfTimeframeBlock("4 Hour", mtfContext["4h"])
    ].join("\n\n");

    // ==================================================
    // CONFLUENCE INTELLIGENCE CALCULATIONS (Phase 5.3.3)
    // ==================================================
    const missingInputs = [];
    if (!priceInfo || priceInfo.price === null || priceInfo.price === undefined) {
      missingInputs.push("Current Price");
    }
    if (!priceHistory || priceHistory.length === 0) {
      missingInputs.push("Price History");
    }
    if (!signals || signals.length === 0) {
      missingInputs.push("Active Signals");
    }
    if (!newsContext || (!newsContext.highImpactEvents && !newsContext.goldNews)) {
      missingInputs.push("News Context");
    }

    // 1. Component Confluence Scores
    const signalConfluence = totalActive > 0 ? consensusStrength : null;

    let marketConfluence = null;
    if (entries.length > 0 || stopLosses.length > 0) {
      let alignmentScore = 50;
      if (marketAlignment === "Price inside Entry") alignmentScore = 100;
      else if (marketAlignment === "Price approaching Entry") alignmentScore = 80;
      else if (marketAlignment === "Price near TP") alignmentScore = 60;
      else if (marketAlignment === "Price near SL") alignmentScore = 40;
      else if (marketAlignment.includes("beyond") || marketAlignment.includes("below")) alignmentScore = 20;

      marketConfluence = Math.round((alignmentScore * 0.7) + (slConsistency * 0.3));
    }

    let timeframeConfluence = null;
    let validTfCount = 0;
    let tfSum = 0;
    const dominantDir = buyPercentage > sellPercentage ? "BUY" : (sellPercentage > buyPercentage ? "SELL" : null);

    ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
      const tfData = mtfContext[tf];
      if (tfData && tfData.status === "OK") {
        validTfCount++;
        if (dominantDir) {
          if (dominantDir === "BUY" && tfData.trendDirection === "Bullish") tfSum += 100;
          else if (dominantDir === "SELL" && tfData.trendDirection === "Bearish") tfSum += 100;
          else if (tfData.trendDirection === "Neutral") tfSum += 50;
        } else {
          if (tfData.trendDirection === "Neutral") tfSum += 100;
          else tfSum += 50;
        }
      }
    });
    if (validTfCount > 0) {
      timeframeConfluence = Math.round(tfSum / validTfCount);
    } else {
      missingInputs.push("Timeframe History");
    }

    let newsConfluence = 100;
    if (liveEvents.length > 0) newsConfluence -= 40;
    if (upcomingEvents.length > 0) newsConfluence -= 25;
    if (newsConfluence < 0) newsConfluence = 0;

    const decisionConfluence = Math.round((readinessScore * 0.6) + (decisionConfidence * 0.4));

    // 2. Overall Confluence Score (exclude null component scores from average calculation)
    const validScores = [];
    if (signalConfluence !== null) validScores.push(signalConfluence);
    if (marketConfluence !== null) validScores.push(marketConfluence);
    if (timeframeConfluence !== null) validScores.push(timeframeConfluence);
    if (newsConfluence !== null) validScores.push(newsConfluence);
    if (decisionConfluence !== null) validScores.push(decisionConfluence);

    const overallConfluence = validScores.length > 0
      ? Math.round(validScores.reduce((s, v) => s + v, 0) / validScores.length)
      : 50;

    // 3. Confluence Grade
    let confluenceGrade = "D";
    if (overallConfluence >= 85) confluenceGrade = "A+";
    else if (overallConfluence >= 70) confluenceGrade = "A";
    else if (overallConfluence >= 55) confluenceGrade = "B";
    else if (overallConfluence >= 40) confluenceGrade = "C";

    // 4. Hard Block & Timing Analysis
    let hasExtremeMtfConflict = false;
    if (dominantDir) {
      ["1h", "4h"].forEach(tf => {
        const tfData = mtfContext[tf];
        if (tfData && tfData.status === "OK") {
          if (dominantDir === "BUY" && tfData.trendDirection === "Bearish") {
            hasExtremeMtfConflict = true;
          } else if (dominantDir === "SELL" && tfData.trendDirection === "Bullish") {
            hasExtremeMtfConflict = true;
          }
        }
      });
    }

    const hasLiveNewsBlock = liveEvents.length > 0 && directionAgreement === "Neutral";
    const hasVeryLowScore = overallConfluence < 40;
    const hasVolConsensusBlock = volatilityLevel === "High" && consensusStrength < 50;

    const isHardBlocked = hasExtremeMtfConflict || hasLiveNewsBlock || hasVeryLowScore || hasVolConsensusBlock;

    let tradeFilter = "ALLOW";
    if (overallConfluence >= 75) tradeFilter = "ALLOW";
    else if (overallConfluence >= 50) tradeFilter = "WAIT";
    else tradeFilter = "AVOID";

    let tradeTiming = "NOW";
    if (overallConfluence < 50) tradeTiming = "NO TRADE";
    else if (liveEvents.length > 0 || upcomingEvents.length > 0) tradeTiming = "WAIT NEWS";
    else if (marketAlignment === "Price inside Entry") tradeTiming = "NOW";
    else if (marketAlignment === "Price approaching Entry") tradeTiming = "WAIT RETRACEMENT";
    else if (marketAlignment.includes("TP")) tradeTiming = "WAIT RETRACEMENT";
    else tradeTiming = "WAIT BREAKOUT";

    let expectedProbability = overallConfluence;

    let recommendedRisk = "NORMAL";
    if (overallConfluence >= 80 && volatilityLevel === "Low") {
      recommendedRisk = "NORMAL";
    }
    if (overallConfluence < 60 || volatilityLevel === "High" || liveEvents.length > 0 || tradeFilter === "AVOID") {
      recommendedRisk = "LOW";
    }

    // 5. Reasons lists
    const reasonsToTrade = [];
    if (consensusStrength >= 70) reasonsToTrade.push(`High signal consensus (${consensusStrength}%)`);
    if (readinessScore >= 70) reasonsToTrade.push("Market structure is highly ready for entry");
    if (volatilityLevel === "Low") reasonsToTrade.push("Intraday volatility is low and stable");
    if (marketAlignment === "Price inside Entry") reasonsToTrade.push("Price is currently inside the optimal entry zone");
    
    let tfCount = 0;
    ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
      if (mtfContext[tf] && mtfContext[tf].status === "OK" && mtfContext[tf].trendDirection === (dominantDir === "BUY" ? "Bullish" : "Bearish")) {
        tfCount++;
      }
    });
    if (tfCount >= 3) reasonsToTrade.push(`Aligned trends across ${tfCount} key timeframes`);
    if (reasonsToTrade.length === 0) reasonsToTrade.push("None identified.");

    const reasonsNotToTrade = [];
    if (volatilityLevel === "High") reasonsNotToTrade.push("High intraday volatility increases execution risk");
    if (liveEvents.length > 0 || upcomingEvents.length > 0) {
      reasonsNotToTrade.push("High-impact macroeconomic news release pending or live");
    }
    if (consensusStrength < 50 && totalActive > 0) reasonsNotToTrade.push("Weak active signal consensus");
    if (marketAlignment.includes("beyond") || marketAlignment.includes("below")) {
      reasonsNotToTrade.push("Price has already extended past ideal parameters");
    }
    
    let conflictTfs = [];
    ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
      if (mtfContext[tf] && mtfContext[tf].status === "OK" && mtfContext[tf].trendDirection && mtfContext[tf].trendDirection !== "Neutral" && mtfContext[tf].trendDirection !== (dominantDir === "BUY" ? "Bullish" : "Bearish")) {
        conflictTfs.push(tf);
      }
    });
    if (conflictTfs.length > 0) {
      reasonsNotToTrade.push(`Counter-trend timeframe conflicts present on: ${conflictTfs.join(", ")}`);
    }

    // Apply Hard Block Overrides
    if (isHardBlocked) {
      tradeFilter = "AVOID";
      tradeTiming = "NO TRADE";
      expectedProbability = null;
      recommendedRisk = "LOW";
      
      if (hasExtremeMtfConflict) {
        reasonsNotToTrade.push("Extreme higher-timeframe trend conflict");
      }
      if (hasLiveNewsBlock) {
        reasonsNotToTrade.push("Live high-impact news event with unclear signal direction");
      }
      if (hasVeryLowScore) {
        reasonsNotToTrade.push("Overall confluence score is extremely low");
      }
      if (hasVolConsensusBlock) {
        reasonsNotToTrade.push("High volatility combined with weak consensus");
      }
    }

    if (reasonsNotToTrade.length === 0) reasonsNotToTrade.push("No significant weaknesses detected.");

    // Conflict summary
    let marketConflictSummary = "No major market structure or timeframe conflicts identified.";
    const conflicts = [];
    if (conflictTfs.length > 0) {
      conflicts.push(`conflicting trend directions on timeframes: ${conflictTfs.join(", ")}`);
    }
    if (volatilityLevel === "High" && consensusStrength < 70) {
      conflicts.push("high volatility coupled with relatively weak signal agreement");
    }
    if ((liveEvents.length > 0 || upcomingEvents.length > 0) && totalActive > 0) {
      conflicts.push("active signals trading into a high-impact macroeconomic event");
    }
    if (isHardBlocked) {
      if (hasExtremeMtfConflict) conflicts.push("extreme higher-timeframe trend conflict");
      if (hasLiveNewsBlock) conflicts.push("live high-impact news with neutral signal direction");
      if (hasVeryLowScore) conflicts.push("insufficient confluence");
      if (hasVolConsensusBlock) conflicts.push("high volatility combined with weak consensus");
    }
    if (conflicts.length > 0) {
      marketConflictSummary = `Major market conflicts detected: ${conflicts.join("; ")}.`;
    }

    // 4. Build prompt incorporating structured indicator blocks in the approved sequence
    const prompt = `You are a professional financial trading advisor specializing in Gold (XAUUSD).
Analyze the market intelligence indicators, price clusters, active signals, recent high-impact macroeconomic events, gold market news, and multi-timeframe context to make a trading decision.

CRITICAL MULTI-TIMEFRAME TRADING RULES:
1. Compare all timeframes (1m, 5m, 15m, 1h, 4h).
2. Prefer trades aligned with higher timeframes.
3. Penalize trades fighting strong higher-timeframe trends.
4. Prefer trades where 5m, 15m and 1h agree.
5. Mention timeframe conflicts inside reasoning.
6. Lower confidence when timeframes disagree.
7. Never ignore higher timeframe structure.

CRITICAL CONFLUENCE & TRADE FILTERING RULES:
- The Confluence section is a synthesized decision-support layer.
- If Trade Filter = AVOID, the AI should strongly prefer a direction of "HOLD" unless overwhelming contradictory evidence exists.
- If Trade Filter = WAIT, the AI should recommend patience (e.g. direction of "HOLD" or highly conservative entry wait ranges) unless a very strong catalyst exists.
- Higher Overall Confluence Scores should increase your output confidence rating.
- Lower Overall Confluence Scores should reduce your output confidence rating.

CRITICAL AUTO-EXECUTION & DECISION QUALITY RULES:
- Your recommendations are automatically executed on a MetaTrader 5 DEMO account without manual confirmation.
- Every BUY or SELL recommendation should represent a trade you would personally be comfortable executing based on the available evidence.
- Produce BUY or SELL only when the overall market evidence, multi-timeframe structure, Telegram consensus, macro context, and risk-reward profile collectively support the trade.
- If the evidence is mixed, conflicting, or insufficient, return HOLD rather than forcing a trade.
- Prioritize recommendation quality, consistency, and disciplined risk management over recommendation frequency.
- Do not avoid good opportunities simply because execution is automatic. High-confidence, high-quality setups should still be recommended.
- Explain clearly in the reasoning why a BUY, SELL, or HOLD decision was reached.

CURRENT GOLD PRICE: ${currentPrice !== null ? currentPrice : "Unavailable"}

=========================================
SECTION 1: SIGNAL INTELLIGENCE SUMMARY
=========================================
- Total Active Signals: ${totalActive}
- BUY Signals Count: ${buyCount}
- SELL Signals Count: ${sellCount}
- BUY Percentage: ${buyPercentage.toFixed(1)}%
- SELL Percentage: ${sellPercentage.toFixed(1)}%
- Newest Signal Age: ${newestSignalAgeMin.toFixed(1)} minutes
- Oldest Signal Age: ${oldestSignalAgeMin.toFixed(1)} minutes
- Average Signal Age: ${averageSignalAgeMin.toFixed(1)} minutes

- Signal Time Distribution:
  - 0-5 min: ${timeDistribution["0-5 min"]}
  - 5-15 min: ${timeDistribution["5-15 min"]}
  - 15-30 min: ${timeDistribution["15-30 min"]}
  - 30-60 min: ${timeDistribution["30-60 min"]}
  - 60+ min: ${timeDistribution["60+ min"]}

- Signal Inflow Density:
  - Last 5 min: ${signalDensity["last 5 min"]} signals
  - Last 15 min: ${signalDensity["last 15 min"]} signals
  - Last 30 min: ${signalDensity["last 30 min"]} signals
  - Last 60 min: ${signalDensity["last 60 min"]} signals

- Direction Agreement: ${directionAgreement}
- Consensus Strength Score (0-100): ${consensusStrength}
- Signal Quality Summary: ${signalQualitySummary}

- Cluster Analysis & Price Concentrations:
  - Entry Price Clusters:
${entryClusterText}
    - Primary Entry Cluster Width: ${entryClusterWidth.toFixed(2)}
  - Stop Loss (SL) Price Clusters:
${slClusterText}
    - SL Spread (Max SL - Min SL): ${slSpread.toFixed(2)}
    - Average SL Distance (from Entry): ${averageSLDistance.toFixed(2)}
    - SL Consistency Rating: ${slConsistency}%
  - Take Profit (TP) Price Clusters:
${tpClusterText}
    - Primary TP Cluster Width: ${tpClusterWidth.toFixed(2)}

=========================================
SECTION 2: MARKET INTELLIGENCE LAYER
=========================================
- Price Action & Metrics:
  - Current Price: ${currentPrice !== null ? currentPrice : "Unavailable"}
  - 5-Min Price Change: ${change5m.toFixed(2)}
  - 15-Min Price Change: ${change15m.toFixed(2)}
  - 30-Min Price Change: ${change30m.toFixed(2)}
  - 60-Min Price Change: ${change60m.toFixed(2)}
  - Intraday Highest (60m): ${highestPrice60m.toFixed(2)}
  - Intraday Lowest (60m): ${lowestPrice60m.toFixed(2)}
  - 60-Min Trading Price Range: ${range60m.toFixed(2)}

- Intraday Momentum:
  - Momentum Direction: ${momentumDirection}
  - Momentum Strength: ${momentumStrength}

- Intraday Volatility:
  - Volatility Level: ${volatilityLevel}
  - Current 60-Min Volatility Range: ${range60m.toFixed(2)}

- Nearest Price Cluster Analysis:
  - Nearest Cluster Type: ${nearestClusterType}
  - Distance to Nearest Cluster: ${nearestClusterDistance === Infinity ? "N/A" : nearestClusterDistance.toFixed(2)}
  - Nearest Cluster Range Width: ${nearestClusterWidth.toFixed(2)}

- Market Alignment Status: ${marketAlignment}

=========================================
SECTION 3: MULTI-TIMEFRAME MARKET ANALYSIS
=========================================
${formattedMtfText}

=========================================
SECTION 4: CONFLUENCE INTELLIGENCE
=========================================
- Confluence Score Metrics:
  - Signal Confluence: ${signalConfluence !== null ? signalConfluence : "Excluded (No active signals)"}
  - Market Confluence: ${marketConfluence !== null ? marketConfluence : "Excluded (No active price clusters)"}
  - Timeframe Confluence: ${timeframeConfluence !== null ? timeframeConfluence : "Excluded (Insufficient timeframe history)"}
  - News Confluence: ${newsConfluence}
  - Decision Confluence: ${decisionConfluence}
  - Overall Confluence Score: ${overallConfluence}

- Synthesis & Grade:
  - Confluence Grade: ${confluenceGrade}
  - Expected Probability: ${expectedProbability !== null ? expectedProbability + "%" : "Unavailable (Trade Blocked)"}

- Execution Controls:
  - Trade Filter: ${tradeFilter}
  - Trade Timing: ${tradeTiming}
  - Recommended Risk: ${recommendedRisk}

- Reasons To Trade:
${reasonsToTrade.slice(0, 5).map(r => `  - ${r}`).join("\n")}

- Reasons NOT To Trade:
${reasonsNotToTrade.slice(0, 5).map(r => `  - ${r}`).join("\n")}

- Market Conflict Summary:
${marketConflictSummary}

- Missing Input Sources:
${missingInputs.length > 0 ? missingInputs.map(m => `  - ${m}`).join("\n") : "  - None (All data streams online)"}

=========================================
SECTION 5: DECISION INTELLIGENCE
=========================================
- Market Summary: ${decisionIntelligence.marketSummary}
- Trade Readiness:
  - Score (0-100): ${decisionIntelligence.readinessScore}
  - Rating: ${decisionIntelligence.readinessRating}
  - Readiness Reason: ${decisionIntelligence.readinessReason}
- Decision Confidence:
  - Confidence Rating (0-100): ${decisionIntelligence.decisionConfidence}
  - Confidence Reason: ${decisionIntelligence.confidenceReason}
- Opportunity Grade: ${decisionIntelligence.opportunityGrade}
- Risk Assessment:
  - Risk Level: ${decisionIntelligence.riskLevel}
  - Risk Reason: ${decisionIntelligence.riskReason}
- Entry Timing: ${decisionIntelligence.entryTiming}
- Conflict Analysis:
  - Conflict Severity: ${decisionIntelligence.conflictSeverity}
  - Active Conflicts: ${decisionIntelligence.conflicts.length > 0 ? decisionIntelligence.conflicts.map(c => "\n    - " + c).join("") : " None detected."}

- Synthesized Trade Outlook:
  - Strengths:
${strengths.map(s => `    - ${s}`).join("\n")}
  - Weaknesses:
${weaknesses.map(w => `    - ${w}`).join("\n")}
  - Action Plan Recommendation:
    - ${decisionIntelligence.recommendation}

=========================================
SECTION 6: AI EXPERIENCE
=========================================
- Learning Status: ${aiExperience.learningStatus}
- Recommendation History: ${aiExperience.recommendationHistory}
- Primary Confidence Sources:
${aiExperience.confidenceSource.map(src => `  - ${src}`).join("\n")}
- Experience Notes: ${aiExperience.experienceNotes}

=========================================
SECTION 7: ADVANCED MARKET CONTEXT
=========================================
- Nearest Support Level: ${nearestSupport}
- Nearest Resistance Level: ${nearestResistance}
- 24-hour High: ${high24h}
- 24-hour Low: ${low24h}
- Current Daily Range: ${dailyRange}
- Distance to Daily High: ${distToHigh}
- Distance to Daily Low: ${distToLow}
- ATR (Average True Range): ${atr}
- Current Spread: ${currentSpread}
- Market Liquidity Status: ${marketLiquidity}
- Trend Strength: ${trendStrength}
- Market Phase: ${marketPhase}
- Market Bias: ${marketBias}
- Distance to Entry Zone: ${distanceToEntry}

=========================================
SECTION 7.5: INSTITUTIONAL MARKET STRUCTURE
=========================================
- Previous Day High (PDH): ${pdh !== null ? pdh.toFixed(2) + " USD" : "N/A"}${pdh !== null && currentPrice !== null ? " (Distance: " + (pdh - currentPrice).toFixed(2) + " USD)" : ""}
- Previous Day Low (PDL): ${pdl !== null ? pdl.toFixed(2) + " USD" : "N/A"}${pdl !== null && currentPrice !== null ? " (Distance: " + (currentPrice - pdl).toFixed(2) + " USD)" : ""}
- Asian Session:
  - High: ${asianHigh !== null ? asianHigh.toFixed(2) + " USD" : "N/A"}
  - Low: ${asianLow !== null ? asianLow.toFixed(2) + " USD" : "N/A"}
  - Position: ${asianRelation}
- London Session:
  - High: ${londonHigh !== null ? londonHigh.toFixed(2) + " USD" : "N/A"}
  - Low: ${londonLow !== null ? londonLow.toFixed(2) + " USD" : "N/A"}
  - Position: ${londonRelation}
- New York Session:
  - High: ${nyHigh !== null ? nyHigh.toFixed(2) + " USD" : "N/A"}
  - Low: ${nyLow !== null ? nyLow.toFixed(2) + " USD" : "N/A"}
  - Position: ${nyRelation}
- Daily Midpoint (50%): ${midpoint !== null ? midpoint.toFixed(2) + " USD" : "N/A"}${distFromMidpoint !== null ? " (Distance: " + distFromMidpoint.toFixed(2) + " USD)" : ""}
- Premium / Discount Rating: ${premiumDiscount} (${percentThroughRange.toFixed(1)}% through today's range)

=========================================
SECTION 7.6: CROSS MARKET INTELLIGENCE
=========================================
- DXY (US Dollar Index):
  - Current Price: ${dxyStats !== null ? dxyStats.current.toFixed(2) : "Unavailable"}
  - Trend: ${dxyStats !== null ? dxyStats.trendDirection + " (" + dxyStats.trendStrength + ")" : "Unavailable"}
  - Momentum: ${dxyStats !== null ? dxyStats.momentumDirection + " (" + dxyStats.momentumStrength + ")" : "Unavailable"}
- US10Y (US 10-Year Treasury Yield):
  - Current Yield: ${us10yStats !== null ? us10yStats.current.toFixed(3) + "%" : "Unavailable"}
  - Trend: ${us10yStats !== null ? us10yStats.trendDirection + " (" + us10yStats.trendStrength + ")" : "Unavailable"}
  - Momentum: ${us10yStats !== null ? us10yStats.momentumDirection + " (" + us10yStats.momentumStrength + ")" : "Unavailable"}
- Macro Correlations & Alignments:
  - Gold vs DXY: ${dxyCorrelation}
  - Gold vs US10Y: ${yieldAlignment}
  - Overall Macro Alignment: ${macroAlignment}

=========================================
SECTION 8: MACROECONOMIC HIGH-IMPACT EVENTS & MARKET NEWS
=========================================
- Live Events (Scheduled within +/- 15 mins):
${formattedLiveEvents}

- Upcoming Events (Scheduled in > 15 mins):
${formattedUpcomingEvents}

- Recently Released Events (Scheduled in the past / < -15 mins):
${formattedRecentlyReleasedEvents}

- Market Headlines & Economic News:
${formattedNews}

=========================================
SECTION 9: RAW ACTIVE SIGNAL PARAMETERS
=========================================
${formattedSignals || "No active signals."}

=========================================
SECTION 10: TRADING DECISION OUTPUT
=========================================
Synthesize a consensus trade recommendation based on all the provided information.
Produce your output as a single valid JSON object matching this schema:
{
  "pair": "XAUUSD",
  "direction": "BUY" | "SELL" | "HOLD",
  "entryMin": number (minimum entry price, or current price if HOLD),
  "entryMax": number (maximum entry price, or current price if HOLD),
  "sl": number (stop loss price, or null if HOLD),
  "tp": number (low risk take profit price, or null if HOLD),
  "moderateTp": number (moderate risk take profit price, or null if HOLD),
  "highRiskTp": number (high risk take profit price, or null if HOLD),
  "tradeQuality": "Excellent" | "Good" | "Average" | "Poor",
  "confidence": number (0-100 strength score),
  "estimatedHoldingTime": "5-15 min" | "15-30 min" | "30-60 min" | "1-2 hr" | "2+ hr",
  "tradeStyle": "Scalp" | "Intraday" | "Swing",
  "reasoning": [
    "short bullet-style explanation 1",
    "short bullet-style explanation 2",
    "short bullet-style explanation 3"
  ]
}

Return JSON ONLY. Do NOT enclose the JSON in markdown code blocks like \`\`\`json. Do not include any explanations or other text outside the JSON.`;

    // 5. Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.geminiApiKey}`;
    
    logger.info("gemini_advisor.calling_api", { signalCount: signals.length, currentPrice });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (response.status === 429) {
      logger.warn("gemini_advisor.rate_limited");
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("gemini_advisor.api_error", { status: response.status, error: errorText });
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    const data = await response.json();
    let textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
      logger.error("gemini_advisor.empty_response", { data });
      return {
        status: "error",
        message: "Gemini recommendation unavailable"
      };
    }

    // Handle potential markdown wrapping
    textResponse = textResponse.trim();
    if (textResponse.startsWith("```")) {
      textResponse = textResponse.replace(/^```(?:json)?\n?|```$/g, "").trim();
    }

    // 6. Parse and Validate response
    const recommendation = JSON.parse(textResponse);

    // Strict schema check
    if (
      recommendation.pair === undefined ||
      recommendation.direction === undefined ||
      recommendation.entryMin === undefined ||
      recommendation.entryMax === undefined ||
      recommendation.sl === undefined ||
      recommendation.tp === undefined ||
      recommendation.moderateTp === undefined ||
      recommendation.highRiskTp === undefined ||
      recommendation.tradeQuality === undefined ||
      recommendation.confidence === undefined ||
      recommendation.estimatedHoldingTime === undefined ||
      recommendation.tradeStyle === undefined ||
      recommendation.reasoning === undefined
    ) {
      throw new Error("Missing required field in Gemini response");
    }

    if (
      recommendation.pair !== "XAUUSD" ||
      typeof recommendation.direction !== "string" ||
      !Array.isArray(recommendation.reasoning) ||
      recommendation.reasoning.some(r => typeof r !== "string")
    ) {
      throw new Error("Invalid response type or value in Gemini response");
    }

    const direction = recommendation.direction.toUpperCase();

    // Validate numeric values
    const entryMin = recommendation.entryMin !== null ? Number(recommendation.entryMin) : null;
    const entryMax = recommendation.entryMax !== null ? Number(recommendation.entryMax) : null;
    const sl = recommendation.sl !== null ? Number(recommendation.sl) : null;
    const tp = recommendation.tp !== null ? Number(recommendation.tp) : null;
    const moderateTp = recommendation.moderateTp !== null ? Number(recommendation.moderateTp) : null;
    const highRiskTp = recommendation.highRiskTp !== null ? Number(recommendation.highRiskTp) : null;

    if (
      entryMin === null || Number.isNaN(entryMin) ||
      entryMax === null || Number.isNaN(entryMax)
    ) {
      throw new Error("Invalid entry range in Gemini response");
    }

    if (direction !== "HOLD") {
      if (sl === null || Number.isNaN(sl) || tp === null || Number.isNaN(tp) ||
          moderateTp === null || Number.isNaN(moderateTp) || highRiskTp === null || Number.isNaN(highRiskTp)) {
        throw new Error("Missing or invalid TP/SL values for active trade direction");
      }
    }

    // Validate TP sequence order
    if (direction === "BUY") {
      if (!(tp < moderateTp && moderateTp < highRiskTp)) {
        throw new Error(`Invalid BUY TP sequence ordering: ${tp} should be < ${moderateTp} < ${highRiskTp}`);
      }
    } else if (direction === "SELL") {
      if (!(tp > moderateTp && moderateTp > highRiskTp)) {
        throw new Error(`Invalid SELL TP sequence ordering: ${tp} should be > ${moderateTp} > ${highRiskTp}`);
      }
    }

    // Validate Confidence (0-100)
    const confidence = Number(recommendation.confidence);
    if (Number.isNaN(confidence) || confidence < 0 || confidence > 100) {
      throw new Error(`Invalid confidence value: ${recommendation.confidence}. Must be between 0 and 100.`);
    }

    // Validate Trade Quality (Excellent, Good, Average, Poor)
    const tradeQuality = String(recommendation.tradeQuality);
    const validQualities = ["Excellent", "Good", "Average", "Poor"];
    if (!validQualities.includes(tradeQuality)) {
      throw new Error(`Invalid trade quality: ${tradeQuality}. Allowed: ${validQualities.join(", ")}`);
    }

    // Validate Holding Time
    const estimatedHoldingTime = String(recommendation.estimatedHoldingTime);
    const holdingTimeRegex = /^(5[-–]15 min|15[-–]30 min|30[-–]60 min|1[-–]2 hr|2\+ hr)$/;
    if (!holdingTimeRegex.test(estimatedHoldingTime)) {
      throw new Error(`Invalid estimated holding time: ${estimatedHoldingTime}`);
    }

    // Validate Trade Style
    const tradeStyle = String(recommendation.tradeStyle);
    const validStyles = ["Scalp", "Intraday", "Swing"];
    if (!validStyles.includes(tradeStyle)) {
      throw new Error(`Invalid trade style: ${tradeStyle}. Allowed: ${validStyles.join(", ")}`);
    }

    // Calculate Risk:Reward Ratios based on entry range midpoint
    let riskReward = { lowRisk: null, moderate: null, high: null };
    if (direction !== "HOLD") {
      const entryPrice = (entryMin + entryMax) / 2;
      const calculateRR = (targetPrice) => {
        if (!sl || !targetPrice || entryPrice === sl) return null;
        let rr = 0;
        if (direction === "BUY") {
          const risk = entryPrice - sl;
          const reward = targetPrice - entryPrice;
          if (risk > 0) rr = reward / risk;
        } else if (direction === "SELL") {
          const risk = sl - entryPrice;
          const reward = entryPrice - targetPrice;
          if (risk > 0) rr = reward / risk;
        }
        return rr > 0 ? Number(rr.toFixed(2)) : 0;
      };

      riskReward = {
        lowRisk: calculateRR(tp),
        moderate: calculateRR(moderateTp),
        high: calculateRR(highRiskTp)
      };
    }

    const generateHumanReadableId = () => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const min = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const randomHex = crypto.randomBytes(2).toString("hex").toUpperCase();
      return `AI-${yyyy}${mm}${dd}-${hh}${min}${ss}-${randomHex}`;
    };

    const generationTimeMs = Date.now() - startTime;

    const recResult = {
      recommendationId: generateHumanReadableId(),
      pair: "XAUUSD",
      direction,
      entryMin,
      entryMax,
      sl,
      tp,
      moderateTp,
      highRiskTp,
      tradeQuality,
      confidence,
      riskReward,
      estimatedHoldingTime,
      tradeStyle,
      reasoning: recommendation.reasoning.map(r => String(r)),
      triggerSource,
      generationTimeMs,
      // Confluence properties
      confluenceScore: overallConfluence,
      tradeFilter,
      overallConfluence
    };

    try {
      await saveNewAiRecommendationOutcome(recResult);
    } catch (saveErr) {
      logger.error("gemini_advisor.save_outcome_failed", { error: saveErr.message });
    }

    return recResult;

  } catch (err) {
    logger.error("gemini_advisor.execution_failed", { error: err.message });
    return {
      status: "error",
      message: "Gemini recommendation unavailable"
    };
  }
}
