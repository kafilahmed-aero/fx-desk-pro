import mongoose from "mongoose";
import crypto from "crypto";
import { config } from "../config/env.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getParsedSignals } from "./parsedSignalStore.js";
import { getCurrentPrice, getPriceHistory } from "./priceIngestionService.js";
import { getXauusdNewsContext } from "./xauusdNewsService.js";
import { saveNewAiRecommendationOutcome } from "./signalOutcomeStore.js";
import { getMultiTimeframeContext, buildCandles } from "./multiTimeframeIntelligenceService.js";
import { logger } from "../utils/logger.js";
import { captureIntelligenceSnapshot } from "./recommendationAnalyticsService.js";
import { hasEmergencyMacroEvent } from "./tradingSessionService.js";


// Persistent module-level state for market regime stability (Phase 1.6)
const regimeState = {
  confirmedRegime: "Range",
  regimeLogs: new Map(), // completedTimestamp -> rawRegime
  lastCheckedTimestamp: null
};

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
 * Calculates true swing pivot structures and confirms BOS/CHoCH conditions.
 */
function calculateMarketStructure(priceHistory, currentPrice, atr) {
  if (!priceHistory || priceHistory.length < 5 || currentPrice === null) {
    return null;
  }

  const points = priceHistory.map(h => h.price);
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < points.length - 2; i++) {
    const p = points[i];
    const prev1 = points[i - 1];
    const prev2 = points[i - 2];
    const next1 = points[i + 1];
    const next2 = points[i + 2];

    if (p > prev1 && p > prev2 && p > next1 && p > next2) {
      swingHighs.push({ price: p, index: i, timestamp: priceHistory[i].timestamp });
    }
    if (p < prev1 && p < prev2 && p < next1 && p < next2) {
      swingLows.push({ price: p, index: i, timestamp: priceHistory[i].timestamp });
    }
  }

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return null;
  }

  const latestHigh = swingHighs[swingHighs.length - 1].price;
  const prevHigh = swingHighs[swingHighs.length - 2].price;
  const latestLow = swingLows[swingLows.length - 1].price;
  const prevLow = swingLows[swingLows.length - 2].price;

  let currentStructure = "Range";
  const hh = latestHigh > prevHigh;
  const hl = latestLow > prevLow;
  const lh = latestHigh < prevHigh;
  const ll = latestLow < prevLow;

  if (hh && hl) {
    currentStructure = "Bullish Structure";
  } else if (lh && ll) {
    currentStructure = "Bearish Structure";
  } else if ((hh && ll) || (lh && hl)) {
    currentStructure = "Transition";
  }

  // Refined BOS/CHoCH with ATR threshold and candle close confirmation
  const atrVal = typeof atr === "number" ? atr : 2.0;
  const minBreakout = Math.max(0.10 * atrVal, 0.20);
  const lastClose = points[points.length - 1];

  let bos = "No confirmed BOS";
  let choch = "No CHoCH";

  if (lastClose > latestHigh + minBreakout) {
    if (currentStructure === "Bullish Structure") {
      bos = "Bullish Break of Structure (BOS)";
    } else if (currentStructure === "Bearish Structure") {
      choch = "Bullish CHoCH";
    }
  } else if (lastClose < latestLow - minBreakout) {
    if (currentStructure === "Bearish Structure") {
      bos = "Bearish Break of Structure (BOS)";
    } else if (currentStructure === "Bullish Structure") {
      choch = "Bearish CHoCH";
    }
  }

  let strength = "Weak";
  let trendCount = 0;
  
  for (let k = swingHighs.length - 1; k > 0; k--) {
    if (swingHighs[k].price > swingHighs[k-1].price && swingLows[k] && swingLows[k-1] && swingLows[k].price > swingLows[k-1].price) {
      trendCount++;
    } else if (swingHighs[k].price < swingHighs[k-1].price && swingLows[k] && swingLows[k-1] && swingLows[k].price < swingLows[k-1].price) {
      trendCount++;
    } else {
      break;
    }
  }

  const priceMove = Math.abs(latestHigh - latestLow);
  if (trendCount >= 3 && priceMove > 10) {
    strength = "Strong";
  } else if (trendCount >= 1 && priceMove > 4) {
    strength = "Moderate";
  } else {
    strength = "Weak";
  }

  return {
    latestHigh,
    latestLow,
    prevHigh,
    prevLow,
    currentStructure,
    strength,
    bos,
    choch
  };
}

/**
 * Compiles performance trends and reliability statistics for channels based on historical outcome documents.
 * Integrates smooth confidence factors based on trade count.
 */
function analyzeChannelReliability(outcomes) {
  const channelStats = {};
  if (!outcomes || outcomes.length === 0) {
    return channelStats;
  }
  
  const grouped = {};
  outcomes.forEach(o => {
    const ch = o.channel;
    if (!ch) return;
    if (!grouped[ch]) grouped[ch] = [];
    grouped[ch].push(o);
  });

  for (const ch in grouped) {
    const chOutcomes = grouped[ch];
    const total = chOutcomes.length;

    const completed = chOutcomes.filter(o => 
      ["FULL_TP", "PARTIAL_TP", "SL_HIT", "CANCELLED", "EXPIRED"].includes(o.status)
    ).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    const active = chOutcomes.filter(o => ["PENDING", "ACTIVE"].includes(o.status)).length;
    const fullTp = chOutcomes.filter(o => o.status === "FULL_TP").length;
    const partialTp = chOutcomes.filter(o => o.status === "PARTIAL_TP").length;
    const sl = chOutcomes.filter(o => o.status === "SL_HIT").length;
    const cancelled = chOutcomes.filter(o => ["CANCELLED", "EXPIRED"].includes(o.status)).length;

    let breakEven = 0;
    completed.forEach(o => {
      const entryPrice = o.entry?.entryPrice || ((o.entry?.entryLow + o.entry?.entryHigh) / 2);
      if (entryPrice && o.outcomePrice && Math.abs(o.outcomePrice - entryPrice) <= 0.10) {
        breakEven++;
      }
    });

    const completedCount = completed.length;
    
    // User-facing confidence categories (Very Low, Low, Medium, High, Very High)
    let confidenceLevel = "Very Low";
    if (completedCount < 5) confidenceLevel = "Very Low";
    else if (completedCount <= 15) confidenceLevel = "Low";
    else if (completedCount <= 30) confidenceLevel = "Medium";
    else if (completedCount <= 75) confidenceLevel = "High";
    else confidenceLevel = "Very High";

    // Smooth confidence factor formula: prevents abrupt weighting jumps when count increases slightly
    let confidenceFactor = 0.20;
    if (completedCount < 5) {
      confidenceFactor = 0.10 + (completedCount / 5) * 0.10;
    } else if (completedCount < 15) {
      confidenceFactor = 0.20 + ((completedCount - 5) / 10) * 0.20;
    } else if (completedCount < 30) {
      confidenceFactor = 0.40 + ((completedCount - 15) / 15) * 0.20;
    } else if (completedCount < 75) {
      confidenceFactor = 0.60 + ((completedCount - 30) / 45) * 0.20;
    } else {
      confidenceFactor = Math.min(1.00, 0.80 + ((completedCount - 75) / 75) * 0.20);
    }

    const winRate = completedCount > 0 ? ((fullTp + partialTp) / completedCount) * 100 : 50;
    const tpSuccessRate = (fullTp + partialTp + sl) > 0 ? ((fullTp + partialTp) / (fullTp + partialTp + sl)) * 100 : 0;

    let totalLifetime = 0;
    let lifetimeCount = 0;
    let totalRr = 0;
    let rrCount = 0;

    completed.forEach(o => {
      const created = new Date(o.createdAt || o.timestamp).getTime();
      const ended = new Date(o.outcomeTime || o.updatedAt || created).getTime();
      if (ended > created) {
        totalLifetime += (ended - created);
        lifetimeCount++;
      }

      const entryPrice = o.entry?.entryPrice || ((o.entry?.entryLow + o.entry?.entryHigh) / 2);
      const slPrice = o.stopLoss;
      const outPrice = o.outcomePrice;

      if (entryPrice && slPrice && outPrice && Math.abs(entryPrice - slPrice) > 0.01) {
        const diff = entryPrice - slPrice;
        let rr = 0;
        if (o.action === "BUY") {
          rr = (outPrice - entryPrice) / Math.abs(diff);
        } else {
          rr = (entryPrice - outPrice) / Math.abs(diff);
        }
        totalRr += rr;
        rrCount++;
      }
    });

    const avgLifetimeHours = lifetimeCount > 0 ? (totalLifetime / lifetimeCount) / 3600000 : 0;
    const avgHoldingTimeHours = avgLifetimeHours * 0.8;
    const avgRiskReward = rrCount > 0 ? totalRr / rrCount : 0;

    const recent30 = completed.slice(-30);
    const recentWins = recent30.filter(o => ["FULL_TP", "PARTIAL_TP"].includes(o.status)).length;
    const recentWinRate = (recentWins / recent30.length) * 100;

    let trend = "Stable";
    if (completed.length >= 6) {
      const half = Math.floor(completed.length / 2);
      const olderHalf = completed.slice(0, half);
      const newerHalf = completed.slice(half);

      const olderWins = olderHalf.filter(o => ["FULL_TP", "PARTIAL_TP"].includes(o.status)).length;
      const olderWinRate = (olderWins / olderHalf.length) * 100;
      const newerWins = newerHalf.filter(o => ["FULL_TP", "PARTIAL_TP"].includes(o.status)).length;
      const newerWinRate = (newerWins / newerHalf.length) * 100;

      if (newerWinRate > olderWinRate + 5) {
        trend = "Improving";
      } else if (newerWinRate < olderWinRate - 5) {
        trend = "Declining";
      }
    }

    channelStats[ch] = {
      insufficientHistory: completedCount < 5,
      completedTrades: completedCount,
      confidenceLevel,
      confidenceFactor,
      total,
      active,
      fullTp,
      partialTp,
      sl,
      breakEven,
      cancelled,
      winRate: Math.round(winRate),
      tpSuccessRate: Math.round(tpSuccessRate),
      avgLifetimeHours: Number(avgLifetimeHours.toFixed(1)),
      avgHoldingTimeHours: Number(avgHoldingTimeHours.toFixed(1)),
      avgRiskReward: Number(avgRiskReward.toFixed(2)),
      recent30WinRate: Math.round(recentWinRate),
      trend
    };
  }

  return channelStats;
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

    // Fetch Multi-Timeframe Context early (Phase 1.6)
    const mtfContext = getMultiTimeframeContext("XAUUSD");

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

    // ==================================================
    // TELEGRAM INTELLIGENCE CALCULATIONS (Phase 1.4)
    // ==================================================
    const buyChannelsCount = new Set(signals.filter(s => s.action === "BUY").map(s => s.channel || s.channelName || "Unknown")).size;
    const sellChannelsCount = new Set(signals.filter(s => s.action === "SELL").map(s => s.channel || s.channelName || "Unknown")).size;
    const uniqueChannelsCount = new Set(signals.map(s => s.channel || s.channelName || "Unknown")).size;

    const signalAgesMin = signalAgesMs.map(a => a / 60000);
    const sortedAges = [...signalAgesMin].sort((a, b) => a - b);
    let medianSignalAgeMin = 0;
    if (sortedAges.length > 0) {
      const mid = Math.floor(sortedAges.length / 2);
      medianSignalAgeMin = sortedAges.length % 2 !== 0 ? sortedAges[mid] : (sortedAges[mid - 1] + sortedAges[mid]) / 2;
    }

    const signalsLastHour = signals.filter(s => {
      const age = (now - new Date(s.timestamp || s.createdAt || now)) / 60000;
      return age >= 0 && age <= 60;
    });
    const signalArrivalRate = Number((signalsLastHour.length / 60).toFixed(3));

    const recentSigs = signals.filter(s => {
      const age = (now - new Date(s.timestamp || s.createdAt || now)) / 60000;
      return age >= 0 && age <= 15;
    });
    const olderSigs = signals.filter(s => {
      const age = (now - new Date(s.timestamp || s.createdAt || now)) / 60000;
      return age > 15 && age <= 60;
    });

    const getConsensus = (sigs) => {
      if (sigs.length === 0) return 0;
      const buys = sigs.filter(s => s.action === "BUY").length;
      const sells = sigs.filter(s => s.action === "SELL").length;
      return Math.abs(buys - sells) / sigs.length;
    };

    const recentCons = getConsensus(recentSigs);
    const olderCons = getConsensus(olderSigs);

    let consensusAcceleration = "Stable";
    if (recentCons > olderCons) {
      consensusAcceleration = "Increasing";
    } else if (recentCons < olderCons) {
      consensusAcceleration = "Decreasing";
    }

    const getTightness = (clusters) => {
      if (!clusters || clusters.length === 0) return "Unavailable";
      const ranges = clusters.map(c => c.max - c.min);
      const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      if (avgRange < 1.5) return "Very Tight";
      if (avgRange < 4.0) return "Moderate";
      return "Loose";
    };
    const entryClusterTightness = getTightness(entryClusters);
    const slClusterTightness = getTightness(slClusters);
    const tpClusterTightness = getTightness(tpClusters);

    const dominantCount = Math.max(buyChannelsCount, sellChannelsCount);
    const channelAgreementPct = uniqueChannelsCount > 0 ? Math.round((dominantCount / uniqueChannelsCount) * 100) : 100;
    const channelDisagreementPct = 100 - channelAgreementPct;

    const conflictingSignalsCount = Math.min(buyCount, sellCount);

    let duplicateSignalsCount = 0;
    const seenSignals = new Set();
    signals.forEach(s => {
      const key = `${s.action}-${s.entry}-${s.stopLoss}-${(s.targets || []).map(t => t.target).join(",")}-${s.channel || s.channelName}`;
      if (seenSignals.has(key)) {
        duplicateSignalsCount++;
      } else {
        seenSignals.add(key);
      }
    });

    let telegramSignalQuality = "Moderate";
    if (buyPercentage > 80 || sellPercentage > 80) {
      telegramSignalQuality = averageSignalAgeMin < 15 ? "High" : "Moderate";
    } else if (buyPercentage > 40 && buyPercentage < 60) {
      telegramSignalQuality = "Low";
    }

    let telegramConflictLevel = "Low";
    if (conflictingSignalsCount > 3) telegramConflictLevel = "High";
    else if (conflictingSignalsCount > 0) telegramConflictLevel = "Medium";

    let overallTelegramQuality = "Fair";
    if (telegramSignalQuality === "High" && telegramConflictLevel === "Low") overallTelegramQuality = "Excellent";
    else if (telegramSignalQuality === "High" || telegramConflictLevel === "Low") overallTelegramQuality = "Good";
    else if (telegramConflictLevel === "High") overallTelegramQuality = "Poor";

    // ==================================================
    // CHANNEL RELIABILITY INTELLIGENCE CALCULATIONS (Phase 1.5)
    // ==================================================
    const activeChannels = [...new Set(signals.map(s => s.channel || s.channelName || "Unknown"))];
    let historicalOutcomes = [];
    if (mongoose.connection.readyState === 1 && mongoose.connection.db && activeChannels.length > 0) {
      try {
        historicalOutcomes = await mongoose.model("SignalOutcome").find({
          channel: { $in: activeChannels }
        }).setOptions({ bufferCommands: false }).lean();
      } catch (err) {
        logger.error("gemini_advisor.fetch_historical_outcomes_failed", { error: err.message });
      }
    }

    const channelStats = analyzeChannelReliability(historicalOutcomes);

    // Compute raw vs weighted consensus
    const rawBuyPct = buyPercentage;
    const rawSellPct = sellPercentage;

    let weightedBuySum = 0;
    let weightedSellSum = 0;

    signals.forEach(s => {
      const ch = s.channel || s.channelName || "Unknown";
      const stats = channelStats[ch];
      let weight = 0.50; // Default weight
      if (stats) {
        weight = (stats.winRate / 100) * stats.confidenceFactor;
      } else {
        weight = 0.05; // No history at all - default to Very Low confidence weight (50% * 0.10)
      }
      if (s.action === "BUY") {
        weightedBuySum += weight;
      } else if (s.action === "SELL") {
        weightedSellSum += weight;
      }
    });

    const totalWeightSum = weightedBuySum + weightedSellSum;
    const weightedBuyPct = totalWeightSum > 0 ? (weightedBuySum / totalWeightSum) * 100 : 0;
    const weightedSellPct = totalWeightSum > 0 ? (weightedSellSum / totalWeightSum) * 100 : 0;

    const buyDiff = weightedBuyPct - rawBuyPct;
    const sellDiff = weightedSellPct - rawSellPct;

    let interpretation = "Stable consensus in alignment with historical performance";
    const dominantAction = buyPercentage >= sellPercentage ? "BUY" : "SELL";
    if (dominantAction === "BUY") {
      if (buyDiff > 5) {
        interpretation = "High-quality BUY consensus driven by high-performing channels";
      } else if (buyDiff < -5) {
        interpretation = "Weak consensus driven by low-performing channels";
      }
    } else {
      if (sellDiff > 5) {
        interpretation = "High-quality SELL consensus driven by high-performing channels";
      } else if (sellDiff < -5) {
        interpretation = "Weak consensus driven by low-performing channels";
      }
    }

    // Compile Leaderboards
    const topPerforming = [];
    const bottomPerforming = [];
    const mostActive = [];
    const insufficientHistoryChannels = [];
    const channelDetails = [];

    activeChannels.forEach(ch => {
      const stats = channelStats[ch];
      if (!stats || stats.insufficientHistory) {
        const count = stats ? stats.completedTrades : 0;
        insufficientHistoryChannels.push(`${ch} (${count} completed trades - Low Statistical Confidence)`);
      } else {
        if (stats.winRate >= 65) {
          topPerforming.push(`${ch} (${stats.winRate}% WR, ${stats.completedTrades} trades, ${stats.confidenceLevel} Confidence)`);
        } else if (stats.winRate < 45) {
          bottomPerforming.push(`${ch} (${stats.winRate}% WR, ${stats.completedTrades} trades, ${stats.confidenceLevel} Confidence)`);
        }
        if (stats.total >= 10) {
          mostActive.push(`${ch} (${stats.total} total)`);
        }
      }
      
      const completedCount = stats ? (stats.completedTrades || 0) : 0;
      const wr = stats ? (stats.winRate || 0) : 50;
      const confLevel = stats ? stats.confidenceLevel : "Very Low";
      const confFactor = stats ? stats.confidenceFactor : 0.10;
      const confText = completedCount < 5 ? "Low Statistical Confidence" : confLevel;
      const weight = ((wr / 100) * confFactor).toFixed(2);
      channelDetails.push(`- Channel: ${ch} | Completed Trades: ${completedCount} | Win Rate: ${wr}% | Confidence: ${confText} | Effective Weight: ${weight}`);
    });

    let trustLevel = "Medium";
    const insufficientPct = activeChannels.length > 0 ? (insufficientHistoryChannels.length / activeChannels.length) * 100 : 100;
    if (insufficientPct >= 60) {
      trustLevel = "Low (History Insufficient)";
    } else if (insufficientPct < 30 && Math.abs(buyDiff) < 10 && Math.abs(sellDiff) < 10) {
      trustLevel = "High";
    }

    let overallPerformanceTrend = "Stable";
    let improvingCount = 0;
    let decliningCount = 0;
    activeChannels.forEach(ch => {
      const stats = channelStats[ch];
      if (stats && !stats.insufficientHistory) {
        if (stats.trend === "Improving") improvingCount++;
        if (stats.trend === "Declining") decliningCount++;
      }
    });
    if (improvingCount > decliningCount) overallPerformanceTrend = "Improving";
    else if (decliningCount > improvingCount) overallPerformanceTrend = "Declining";

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

    // ==================================================
    // MARKET STRUCTURE CALCULATIONS (Phase 1.3)
    // ==================================================
    const structure = calculateMarketStructure(priceHistory, currentPrice, atr);

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

    // Format Multi-Timeframe Context (already fetched early)

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

    // Call Phase 1.6 Market Regime detection and scoring
    const regimeData = calculateMarketRegimeAndScores(
      priceHistory,
      currentPrice,
      atr,
      mtfContext,
      momentumScore,
      momentumDirection,
      volatilityLevel,
      trendStrength,
      marketPhase,
      directionAgreement,
      buyPercentage,
      sellPercentage,
      structure
    );

    // Call Phase 1.7 Institutional Order Flow Intelligence
    const orderFlow = calculateOrderFlowIntelligence(priceHistory, currentPrice, structure);

    // Call Phase 1.8 Multi-Asset Macro Intelligence
    const macroIntel = await calculateMacroIntelligence(priceHistory, currentPrice);

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
SECTION 7.7: MARKET STRUCTURE
=========================================
${structure !== null ? `- Latest Swing High: ${structure.latestHigh.toFixed(2)} USD
- Latest Swing Low: ${structure.latestLow.toFixed(2)} USD
- Previous Swing High: ${structure.prevHigh.toFixed(2)} USD
- Previous Swing Low: ${structure.prevLow.toFixed(2)} USD
- Current Structure: ${structure.currentStructure}
- Structure Strength: ${structure.strength}
- Break of Structure: ${structure.bos}
- Change of Character: ${structure.choch}
- Structure Summary: Price is in a ${structure.strength} ${structure.currentStructure} layout with ${structure.bos} and ${structure.choch}.` : `- Structure: Structure unavailable`}

====================================
MARKET REGIME
====================================
Current Regime: ${regimeData.overallRegime}
Regime Confidence: ${regimeData.regimeConfidence}%
Trend Quality: ${regimeData.trendQuality}
Volatility State: ${regimeData.volatilityState}
Momentum Quality: ${regimeData.momentumQuality}
Recommended Trading Environment: ${regimeData.recommendedEnv}

====================================
INSTITUTIONAL ORDER FLOW
====================================
${orderFlow !== null ? `Nearest Bullish Order Block: ${orderFlow.nearestBullishOB ? `${orderFlow.nearestBullishOB.top.toFixed(2)} - ${orderFlow.nearestBullishOB.bottom.toFixed(2)} (Strength: ${orderFlow.nearestBullishOB.strengthScore}, Freshness: ${orderFlow.nearestBullishOB.freshness} bars, Mitigated: ${orderFlow.nearestBullishOB.mitigated})` : "None"}
Nearest Bearish Order Block: ${orderFlow.nearestBearishOB ? `${orderFlow.nearestBearishOB.top.toFixed(2)} - ${orderFlow.nearestBearishOB.bottom.toFixed(2)} (Strength: ${orderFlow.nearestBearishOB.strengthScore}, Freshness: ${orderFlow.nearestBearishOB.freshness} bars, Mitigated: ${orderFlow.nearestBearishOB.mitigated})` : "None"}
Nearest Bullish FVG: ${orderFlow.nearestBullishFvg ? `Gap from ${orderFlow.nearestBullishFvg.bottom.toFixed(2)} to ${orderFlow.nearestBullishFvg.top.toFixed(2)} (Timeframe: ${orderFlow.nearestBullishFvg.timeframe}, Size: ${orderFlow.nearestBullishFvg.size.toFixed(2)}, Quality: ${orderFlow.nearestBullishFvg.qualityScore})` : "None"}
Nearest Bearish FVG: ${orderFlow.nearestBearishFvg ? `Gap from ${orderFlow.nearestBearishFvg.bottom.toFixed(2)} to ${orderFlow.nearestBearishFvg.top.toFixed(2)} (Timeframe: ${orderFlow.nearestBearishFvg.timeframe}, Size: ${orderFlow.nearestBearishFvg.size.toFixed(2)}, Quality: ${orderFlow.nearestBearishFvg.qualityScore})` : "None"}
Nearest Liquidity Pool: ${orderFlow.nearestPool ? `${orderFlow.nearestPool.price.toFixed(2)} (${orderFlow.nearestPool.type}, Priority: ${orderFlow.nearestPool.priority})` : "None"}
Liquidity Status: Equal Highs: ${orderFlow.liquidity.equalHighs ? orderFlow.liquidity.equalHighs.toFixed(2) : "None"} | Equal Lows: ${orderFlow.liquidity.equalLows ? orderFlow.liquidity.equalLows.toFixed(2) : "None"} | Last Sweep: ${orderFlow.liquidity.lastSweepType}
Institutional Bias: ${orderFlow.institutionalBias}
Recommended Interpretation: ${orderFlow.recommendedInterpretation}` : `- Institutional Structure: Institutional Structure Unavailable`}

====================================
MULTI-ASSET MACRO INTELLIGENCE
====================================
${macroIntel !== null ? `Macro Alignment Score: ${macroIntel.macroAlignment} (Bullish: ${macroIntel.bullishPct}%, Bearish: ${macroIntel.bearishPct}%)
Gold Macro Bias: ${macroIntel.goldMacroBias}
Correlation Confidence: ${macroIntel.correlationConfidence}
Macro Conflict Level: ${macroIntel.macroConflictLevel}
Highest Conviction Drivers: ${macroIntel.highestConvictionDrivers}
Weakest Drivers: ${macroIntel.weakestDrivers}
Primary Macro Reason: ${macroIntel.primaryMacroReason}
Recommended Interpretation: ${macroIntel.recommendedInterpretation}` : `- Macro Status: Macro Intelligence Unavailable`}

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
SECTION 9.5: TELEGRAM INTELLIGENCE
=========================================
- BUY Channels: ${buyChannelsCount}
- SELL Channels: ${sellChannelsCount}
- Unique Channels Count: ${uniqueChannelsCount}
- Consensus: ${channelAgreementPct}%
- Consensus Acceleration: ${consensusAcceleration}
- Signal Quality: ${telegramSignalQuality}
- Entry Cluster: ${entryClusterTightness}
- SL Cluster: ${slClusterTightness}
- TP Cluster: ${tpClusterTightness}
- Conflict Level: ${telegramConflictLevel}
- Duplicate Signals: ${duplicateSignalsCount}
- Conflicting Signals: ${conflictingSignalsCount}
- Average Signal Age: ${averageSignalAgeMin.toFixed(1)} mins
- Median Signal Age: ${medianSignalAgeMin.toFixed(1)} mins
- Newest Signal Age: ${newestSignalAgeMin.toFixed(1)} mins
- Oldest Signal Age: ${oldestSignalAgeMin.toFixed(1)} mins
- Signal Arrival Rate: ${signalArrivalRate} signals/min over the last hour
- Overall Telegram Quality: ${overallTelegramQuality}

=========================================
SECTION 9.6: CHANNEL RELIABILITY
=========================================
${historicalOutcomes.length === 0 || activeChannels.length === 0 ? `- Structure: History Insufficient` : `- Channel Details:
${channelDetails.join("\n")}
- Top Performing Channels: ${topPerforming.length > 0 ? topPerforming.join(", ") : "None in active list"}
- Bottom Performing Channels: ${bottomPerforming.length > 0 ? bottomPerforming.join(", ") : "None in active list"}
- Channels with Insufficient History: ${insufficientHistoryChannels.length > 0 ? insufficientHistoryChannels.join(", ") : "None"}
- Raw BUY Consensus: ${rawBuyPct.toFixed(1)}%
- Weighted BUY Consensus: ${weightedBuyPct.toFixed(1)}%
- Raw SELL Consensus: ${rawSellPct.toFixed(1)}%
- Weighted SELL Consensus: ${weightedSellPct.toFixed(1)}%
- Consensus Trust Level: ${trustLevel}
- Recommended Interpretation: ${interpretation}
- Overall Channel Performance Trend: ${overallPerformanceTrend}`}

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

    // Capture intelligence snapshot for Phase 1.9 (Guaranteed safety via internal try/catch)
    try {
      const currentHourUtc = now.getUTCHours();
      let tradingSession = "Sydney/Asian";
      if (currentHourUtc >= 8 && currentHourUtc < 13) {
        tradingSession = "London";
      } else if (currentHourUtc >= 13 && currentHourUtc < 16) {
        tradingSession = "London-New York Overlap";
      } else if (currentHourUtc >= 16 && currentHourUtc < 21) {
        tradingSession = "New York";
      } else {
        tradingSession = "Sydney/Asian";
      }

      const nearestObStr = orderFlow
        ? (orderFlow.nearestBullishOB || orderFlow.nearestBearishOB
          ? `Bullish: ${orderFlow.nearestBullishOB ? orderFlow.nearestBullishOB.high.toFixed(2) + "-" + orderFlow.nearestBullishOB.low.toFixed(2) : "None"} | Bearish: ${orderFlow.nearestBearishOB ? orderFlow.nearestBearishOB.high.toFixed(2) + "-" + orderFlow.nearestBearishOB.low.toFixed(2) : "None"}`
          : "None")
        : "None";

      const nearestFvgStr = orderFlow
        ? (orderFlow.nearestBullishFvg || orderFlow.nearestBearishFvg
          ? `Bullish: ${orderFlow.nearestBullishFvg ? orderFlow.nearestBullishFvg.gapLow.toFixed(2) + "-" + orderFlow.nearestBullishFvg.gapHigh.toFixed(2) : "None"} | Bearish: ${orderFlow.nearestBearishFvg ? orderFlow.nearestBearishFvg.gapLow.toFixed(2) + "-" + orderFlow.nearestBearishFvg.gapHigh.toFixed(2) : "None"}`
          : "None")
        : "None";

      const liqStatusStr = orderFlow && orderFlow.liquidity
        ? `Equal Highs: ${orderFlow.liquidity.eqHighPrice ? orderFlow.liquidity.eqHighPrice.toFixed(2) : "None"} | Equal Lows: ${orderFlow.liquidity.eqLowPrice ? orderFlow.liquidity.eqLowPrice.toFixed(2) : "None"} | Last Sweep: ${orderFlow.liquidity.lastSweepType || "None"}`
        : "None";

      const snapshotContext = {
        telegramQuality: overallTelegramQuality,
        telegramConsensus: consensusStrength,
        weightedConsensus: interpretation,
        channelReliability: trustLevel,
        marketRegime: regimeState.confirmedRegime,
        regimeConfidence: regimeData ? regimeData.regimeConfidence : 0,
        institutionalBias: orderFlow ? orderFlow.institutionalBias : "Neutral",
        macroAlignment: macroIntel ? macroIntel.macroAlignment : "Neutral",
        macroConflictLevel: macroIntel ? macroIntel.macroConflictLevel : "Low",
        premiumDiscount: premiumDiscount,
        nearestOrderBlock: nearestObStr,
        nearestFairValueGap: nearestFvgStr,
        liquidityStatus: liqStatusStr,
        dxyDirection: macroIntel && macroIntel.assetResults["DXY"] ? macroIntel.assetResults["DXY"].direction : "Unavailable",
        us10yDirection: macroIntel && macroIntel.assetResults["US10Y"] ? macroIntel.assetResults["US10Y"].direction : "Unavailable",
        silverDirection: macroIntel && macroIntel.assetResults["Silver"] ? macroIntel.assetResults["Silver"].direction : "Unavailable",
        overallConfluenceScore: overallConfluence,
        tradeFilter: tradeFilter,
        tradingSession,
        emergencyMacroOverrideStatus: hasEmergencyMacroEvent(newsContext, now),
        promptVersion: "1.0",
        promptHash: crypto.createHash("md5").update(prompt).digest("hex"),
        geminiModel: "gemini-2.5-flash"
      };

      await captureIntelligenceSnapshot(recResult, snapshotContext);
    } catch (analyticsErr) {
      logger.error("gemini_advisor.capture_snapshot_failed", { error: analyticsErr.message });
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



/**
 * Calculates Market Regime and Component Scores (Phase 1.6)
 */
function calculateMarketRegimeAndScores(
  priceHistory,
  currentPrice,
  atr,
  mtfContext,
  momentumScore,
  momentumDirection,
  volatilityLevel,
  trendStrength,
  marketPhase,
  directionAgreement,
  buyPercentage,
  sellPercentage,
  structure
) {
  // Check for insufficient information
  const hasInsufficientData = !priceHistory || priceHistory.length < 5 || currentPrice === null || !mtfContext;
  if (hasInsufficientData) {
    return {
      trendStrengthScore: 0,
      volatilityScore: 0,
      atrExpansionScore: 0,
      swingConsistencyScore: 0,
      marketStructureScore: 0,
      momentumScoreVal: 0,
      overallRegime: "Regime Unknown",
      regimeConfidence: 0,
      trendQuality: "Weak/Choppy",
      volatilityState: "Moderate",
      momentumQuality: "Weak/Neutral",
      recommendedEnv: "Caution / Stand Aside (Regime Unknown)"
    };
  }

  // 1. Trend Strength Score (0 to 100)
  const tfTrends = [];
  ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
    const data = mtfContext[tf];
    if (data && data.status === "OK" && data.trendScore !== null) {
      tfTrends.push(Math.abs(data.trendScore));
    }
  });
  const avgTfTrendScore = tfTrends.length > 0 ? Math.round(tfTrends.reduce((s, v) => s + v, 0) / tfTrends.length) : 0;

  // 2. Volatility Score (0 to 100)
  const tfVols = [];
  ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
    const data = mtfContext[tf];
    if (data && data.status === "OK") {
      if (data.volatility === "High") tfVols.push(100);
      else if (data.volatility === "Medium") tfVols.push(50);
      else tfVols.push(10);
    }
  });
  const avgTfVolatilityScore = tfVols.length > 0 ? Math.round(tfVols.reduce((s, v) => s + v, 0) / tfVols.length) : 50;

  // 3. ATR Expansion Score (0 to 100)
  const tfAtrExpansions = [];
  ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
    const data = mtfContext[tf];
    if (data && data.status === "OK" && data.ATR > 0 && data.volatilityValue !== null) {
      const ratio = data.volatilityValue / data.ATR; // typical is ~0.8-1.0
      const score = Math.max(0, Math.min(100, Math.round(ratio * 60)));
      tfAtrExpansions.push(score);
    }
  });
  const atrExpansionScore = tfAtrExpansions.length > 0 ? Math.round(tfAtrExpansions.reduce((s, v) => s + v, 0) / tfAtrExpansions.length) : 50;

  // 4. Swing Consistency Score (0 to 100)
  let swingConsistencyScore = 50;
  if (structure) {
    let baseScore = 50;
    if (structure.strength === "Strong") baseScore = 90;
    else if (structure.strength === "Moderate") baseScore = 65;
    else baseScore = 35;

    if (structure.currentStructure === "Bullish Structure" || structure.currentStructure === "Bearish Structure") {
      baseScore += 10;
    } else if (structure.currentStructure === "Transition") {
      baseScore -= 15;
    }
    if (structure.bos && structure.bos !== "No confirmed BOS") {
      baseScore += 10;
    }
    swingConsistencyScore = Math.max(10, Math.min(100, baseScore));
  }

  // 5. Market Structure Score (0 to 100)
  let marketStructureScore = 50;
  if (structure) {
    let score = 50;
    if (structure.currentStructure === "Bullish Structure" || structure.currentStructure === "Bearish Structure") {
      score = 80;
    } else if (structure.currentStructure === "Range") {
      score = 40;
    } else if (structure.currentStructure === "Transition") {
      score = 30;
    }

    if (structure.strength === "Strong") score += 15;
    else if (structure.strength === "Moderate") score += 5;
    else score -= 10;

    if (structure.bos && structure.bos !== "No confirmed BOS") score += 10;
    if (structure.choch && structure.choch !== "No CHoCH") score -= 5;

    marketStructureScore = Math.max(10, Math.min(100, score));
  }

  // 6. Momentum Score (0 to 100)
  const tfMoms = [];
  ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
    const data = mtfContext[tf];
    if (data && data.status === "OK" && data.momentumScore !== null) {
      tfMoms.push(Math.abs(data.momentumScore));
    }
  });
  const mainMomScore = Math.min(100, Math.round((Math.abs(momentumScore || 0) / 3.0) * 100));
  const avgTfMomScore = tfMoms.length > 0 ? (tfMoms.reduce((s, v) => s + v, 0) / tfMoms.length) : 50;
  const finalMomentumScore = Math.round((mainMomScore + avgTfMomScore) / 2);

  // === REGIME CLASSIFICATION ALGORITHM ===
  let rawRegime = "Range";
  
  const isBreakout = (structure && structure.bos && structure.bos !== "No confirmed BOS") || 
                     (mtfContext["5m"]?.marketPhase === "Breakout" || mtfContext["15m"]?.marketPhase === "Breakout");
                     
  const isReversal = (structure && structure.choch && structure.choch !== "No CHoCH") ||
                     (mtfContext["5m"]?.marketPhase === "Reversal" || mtfContext["15m"]?.marketPhase === "Reversal");
                     
  const isPullback = (mtfContext["5m"]?.marketPhase === "Pullback" || mtfContext["15m"]?.marketPhase === "Pullback");

  const isCompression = volatilityLevel === "Low" || (avgTfVolatilityScore < 30 && atrExpansionScore < 35);
  
  const isExpansion = volatilityLevel === "High" && atrExpansionScore > 70;
  
  const isStrongTrend = avgTfTrendScore > 70 && trendStrength === "Strong";
  
  const isWeakTrend = trendStrength === "Weak" && momentumDirection !== "Neutral";
  
  const isTrending = trendStrength === "Moderate" || (avgTfTrendScore > 40 && momentumDirection !== "Neutral");

  const isHighVolatilityRange = (marketPhase === "Ranging" || avgTfTrendScore < 35) && volatilityLevel === "High";

  if (isBreakout) {
    rawRegime = "Breakout";
  } else if (isReversal) {
    rawRegime = "Reversal Candidate";
  } else if (isPullback) {
    rawRegime = "Pullback";
  } else if (isStrongTrend) {
    rawRegime = "Strong Trend";
  } else if (isCompression) {
    rawRegime = "Compression";
  } else if (isExpansion) {
    rawRegime = "Expansion";
  } else if (isHighVolatilityRange) {
    rawRegime = "High Volatility Range";
  } else if (isTrending) {
    rawRegime = "Trending";
  } else if (isWeakTrend) {
    rawRegime = "Weak Trend";
  } else {
    rawRegime = "Range";
  }

  // === REGIME STABILITY LOGIC ===
  // Identify completed 1-minute candle to drive stability transition
  const ticks = getPriceHistory("XAUUSD");
  const candles1m = buildCandles(ticks, 1);
  const completedTimestamp = candles1m.length >= 2 ? candles1m[candles1m.length - 2].timestamp : null;

  let overallRegime = rawRegime;

  if (rawRegime === "Regime Unknown") {
    regimeState.confirmedRegime = "Regime Unknown";
    overallRegime = "Regime Unknown";
  } else if (completedTimestamp) {
    // Record current rawRegime for this completed candle timestamp
    if (regimeState.lastCheckedTimestamp !== completedTimestamp) {
      regimeState.regimeLogs.set(completedTimestamp, rawRegime);
      regimeState.lastCheckedTimestamp = completedTimestamp;
      
      // Keep only last 20 logs to avoid unbounded growth
      if (regimeState.regimeLogs.size > 20) {
        const sortedKeys = Array.from(regimeState.regimeLogs.keys()).sort((a, b) => a - b);
        while (regimeState.regimeLogs.size > 20) {
          regimeState.regimeLogs.delete(sortedKeys.shift());
        }
      }
    } else {
      // Overwrite the rawRegime value with the latest calculated rawRegime for the same candle
      regimeState.regimeLogs.set(completedTimestamp, rawRegime);
    }
    
    // Fetch logs of last 3 completed candles
    const logs = Array.from(regimeState.regimeLogs.entries())
      .sort((a, b) => b[0] - a[0]) // newest first
      .slice(0, 3);
      
    if (logs.length >= 3) {
      const firstRegimeVal = logs[0][1];
      const allSame = logs.every(log => log[1] === firstRegimeVal);
      if (allSame) {
        regimeState.confirmedRegime = firstRegimeVal;
      }
      overallRegime = regimeState.confirmedRegime;
    } else {
      // Not enough candles recorded yet, allow rawRegime to pass through
      regimeState.confirmedRegime = rawRegime;
      overallRegime = rawRegime;
    }
  } else {
    // If candles are missing, fall back directly
    regimeState.confirmedRegime = rawRegime;
    overallRegime = rawRegime;
  }

  // Calculate Regime Confidence (0 to 100) using normalized weighted components:
  // Components:
  // - Trend Strength: avgTfTrendScore (0-100)
  // - Volatility: avgTfVolatilityScore (0-100)
  // - ATR Expansion: atrExpansionScore (0-100)
  // - Swing Consistency: swingConsistencyScore (0-100)
  // - Market Structure: marketStructureScore (0-100)
  // - Momentum Score: finalMomentumScore (0-100)
  // - Momentum Alignment: 100 if trend/momentum agree, 10 if conflicting, 50 if neutral
  let momAlignmentScore = 50;
  if (momentumDirection !== "Neutral") {
    if (directionAgreement.includes(momentumDirection)) {
      momAlignmentScore = 100;
    } else if (directionAgreement !== "Neutral") {
      momAlignmentScore = 10; // conflicting
    }
  }
  
  // - Multi-Timeframe Agreement Score (0-100)
  let tfAgreementCount = 0;
  const dominantDir = buyPercentage > sellPercentage ? "Bullish" : (sellPercentage > buyPercentage ? "Bearish" : "Neutral");
  ["1m", "5m", "15m", "1h", "4h"].forEach(tf => {
    const data = mtfContext[tf];
    if (data && data.status === "OK") {
      if (dominantDir !== "Neutral" && data.trendDirection === dominantDir) {
        tfAgreementCount++;
      } else if (dominantDir === "Neutral" && data.trendDirection === "Neutral") {
        tfAgreementCount++;
      }
    }
  });
  const mtfAgreementScore = Math.round((tfAgreementCount / 5) * 100);

  const weightedSum =
    (avgTfTrendScore * 0.15) +
    (finalMomentumScore * 0.15) +
    (momAlignmentScore * 0.15) +
    (marketStructureScore * 0.15) +
    (swingConsistencyScore * 0.10) +
    (atrExpansionScore * 0.10) +
    (avgTfVolatilityScore * 0.10) +
    (mtfAgreementScore * 0.10);

  const regimeConfidence = Math.max(0, Math.min(100, Math.round(weightedSum)));

  // Trend Quality text
  let trendQuality = "Choppy/Neutral";
  if (avgTfTrendScore >= 75) {
    trendQuality = `Strong ${momentumDirection !== "Neutral" ? momentumDirection : "Directional"}`;
  } else if (avgTfTrendScore >= 40) {
    trendQuality = `Moderate ${momentumDirection !== "Neutral" ? momentumDirection : "Directional"}`;
  } else {
    trendQuality = "Weak/Choppy";
  }

  // Volatility State text
  let volatilityState = "Moderate";
  if (volatilityLevel === "High") {
    volatilityState = "High (Expansion)";
  } else if (volatilityLevel === "Low") {
    volatilityState = "Low (Compression)";
  } else {
    volatilityState = "Moderate (Stable)";
  }

  // Momentum Quality text
  let momentumQuality = "Weak/Neutral";
  if (finalMomentumScore >= 75) {
    momentumQuality = `Strong ${momentumDirection}`;
  } else if (finalMomentumScore >= 40) {
    momentumQuality = `Moderate ${momentumDirection}`;
  } else {
    momentumQuality = "Weak/Neutral";
  }

  // Recommended Trading Environment text
  let recommendedEnv = "Conservative Trading Mode";
  if (overallRegime === "Strong Trend") {
    recommendedEnv = "Excellent Trend Following Conditions";
  } else if (overallRegime === "Trending") {
    recommendedEnv = "Good Trend Following Conditions";
  } else if (overallRegime === "Weak Trend") {
    recommendedEnv = "Selective Scalping / Tight Targets";
  } else if (overallRegime === "Range") {
    recommendedEnv = "High Probability Range Trading";
  } else if (overallRegime === "High Volatility Range") {
    recommendedEnv = "Wide Range Trading / Volatility Scalping";
  } else if (overallRegime === "Compression") {
    recommendedEnv = "Poor Breakout Conditions / Compression";
  } else if (overallRegime === "Expansion") {
    recommendedEnv = "Momentum Acceleration / Breakout Riding";
  } else if (overallRegime === "Breakout") {
    recommendedEnv = "High Probability Breakout Conditions";
  } else if (overallRegime === "Pullback") {
    recommendedEnv = "Discount/Premium Pullback Buy/Sell";
  } else if (overallRegime === "Reversal Candidate") {
    recommendedEnv = "Potential Trend Reversal / Reversal Scaling";
  } else if (overallRegime === "Regime Unknown") {
    recommendedEnv = "Caution / Stand Aside (Regime Unknown)";
  }

  return {
    trendStrengthScore: avgTfTrendScore,
    volatilityScore: avgTfVolatilityScore,
    atrExpansionScore,
    swingConsistencyScore,
    marketStructureScore,
    momentumScoreVal: finalMomentumScore,
    overallRegime,
    regimeConfidence,
    trendQuality,
    volatilityState,
    momentumQuality,
    recommendedEnv
  };
}

/**
 * Detects Fair Value Gaps (FVGs) on a candle set for a timeframe
 */
/**
 * Detects Fair Value Gaps (FVGs) on a candle set for a timeframe
 */
function detectFVGs(candles, currentPrice, timeframeName, structure) {
  const fvgs = [];
  if (candles.length < 3) return fvgs;

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    // Bullish FVG
    if (c3.low > c1.high) {
      const size = c3.low - c1.high;
      if (size > 0.1) {
        let filled = false;
        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].low <= c1.high) {
            filled = true;
            break;
          }
        }
        
        const isInside = currentPrice >= c1.high && currentPrice <= c3.low;
        const distance = currentPrice > c3.low ? currentPrice - c3.low : (currentPrice < c1.high ? c1.high - currentPrice : 0);

        // Calculate FVG Quality Score (0-100)
        let qualityScore = 20; // base score
        if (structure && structure.bos !== "No confirmed BOS" && structure.bos.includes("Bullish")) {
          qualityScore += 25; // BOS confirmation
        }
        qualityScore += Math.min(25, Math.round(size * 10)); // displacement factor
        if (!filled) qualityScore += 30; // unfilled bonus
        const age = candles.length - 1 - (i - 1);
        qualityScore += Math.max(0, 20 - Math.floor(age / 2)); // freshness bonus

        fvgs.push({
          timeframe: timeframeName,
          type: "Bullish",
          top: c3.low,
          bottom: c1.high,
          size,
          filled,
          isInside,
          distance,
          qualityScore: Math.min(100, qualityScore),
          timestamp: c2.timestamp
        });
      }
    }

    // Bearish FVG
    if (c3.high < c1.low) {
      const size = c1.low - c3.high;
      if (size > 0.1) {
        let filled = false;
        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].high >= c1.low) {
            filled = true;
            break;
          }
        }
        
        const isInside = currentPrice >= c3.high && currentPrice <= c1.low;
        const distance = currentPrice > c1.low ? currentPrice - c1.low : (currentPrice < c3.high ? c3.high - currentPrice : 0);

        // Calculate FVG Quality Score (0-100)
        let qualityScore = 20; // base score
        if (structure && structure.bos !== "No confirmed BOS" && structure.bos.includes("Bearish")) {
          qualityScore += 25;
        }
        qualityScore += Math.min(25, Math.round(size * 10));
        if (!filled) qualityScore += 30;
        const age = candles.length - 1 - (i - 1);
        qualityScore += Math.max(0, 20 - Math.floor(age / 2));

        fvgs.push({
          timeframe: timeframeName,
          type: "Bearish",
          top: c1.low,
          bottom: c3.high,
          size,
          filled,
          isInside,
          distance,
          qualityScore: Math.min(100, qualityScore),
          timestamp: c2.timestamp
        });
      }
    }
  }

  return fvgs;
}

/**
 * Detects Order Blocks (OBs) on a candle set for a timeframe
 */
/**
 * Detects Order Blocks (OBs) on a candle set for a timeframe
 */
function detectOrderBlocks(candles, currentPrice, structure, timeframeName) {
  const obs = [];
  if (candles.length < 5) return obs;

  const getTfMultiplier = (tf) => {
    if (tf === "1h") return 1.5;
    if (tf === "15m") return 1.2;
    return 1.0;
  };

  for (let i = 1; i < candles.length - 2; i++) {
    const c = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];

    // Bullish OB
    if (c.close < c.open) {
      const isBullishExpansion = next1.close > next1.open && 
                                 next2.close > next2.open && 
                                 (next2.close - c.high) > 0.5;

      if (isBullishExpansion) {
        let mitigated = false;
        let broken = false;
        let retests = 0;

        for (let j = i + 3; j < candles.length; j++) {
          if (candles[j].low <= c.low) {
            broken = true;
            break;
          }
          if (candles[j].low <= c.high) {
            mitigated = true;
            retests++;
          }
        }

        if (!broken) {
          if (currentPrice <= c.low) broken = true;
          else if (currentPrice <= c.high) mitigated = true;
        }

        const freshness = candles.length - 1 - i;
        const disp = next2.close - c.low;

        // Calculate OB Strength Score (0-100)
        let strength = 30; // base score
        strength += Math.min(30, Math.round(disp * 10)); // displacement factor
        
        if (structure && structure.bos !== "No confirmed BOS" && structure.bos.includes("Bullish")) {
          strength += 25; // BOS confirmation
        }
        if (!mitigated) {
          strength += 20; // unmitigated bonus
        } else {
          strength += 5; // mitigated
          strength += Math.min(15, retests * 5); // retests bonus
        }
        strength += Math.max(0, 10 - Math.floor(freshness / 5)); // freshness age bonus

        const finalScore = Math.min(100, Math.round(strength * getTfMultiplier(timeframeName)));

        obs.push({
          timeframe: timeframeName,
          type: "Bullish",
          top: c.high,
          bottom: c.low,
          mitigated,
          broken,
          freshness,
          strengthScore: finalScore,
          timestamp: c.timestamp
        });
      }
    }

    // Bearish OB
    if (c.close > c.open) {
      const isBearishExpansion = next1.close < next1.open && 
                                 next2.close < next2.open && 
                                 (c.low - next2.close) > 0.5;

      if (isBearishExpansion) {
        let mitigated = false;
        let broken = false;
        let retests = 0;

        for (let j = i + 3; j < candles.length; j++) {
          if (candles[j].high >= c.high) {
            broken = true;
            break;
          }
          if (candles[j].high >= c.low) {
            mitigated = true;
            retests++;
          }
        }

        if (!broken) {
          if (currentPrice >= c.high) broken = true;
          else if (currentPrice >= c.low) mitigated = true;
        }

        const freshness = candles.length - 1 - i;
        const disp = c.high - next2.close;

        let strength = 30;
        strength += Math.min(30, Math.round(disp * 10));
        
        if (structure && structure.bos !== "No confirmed BOS" && structure.bos.includes("Bearish")) {
          strength += 25;
        }
        if (!mitigated) {
          strength += 20;
        } else {
          strength += 5;
          strength += Math.min(15, retests * 5);
        }
        strength += Math.max(0, 10 - Math.floor(freshness / 5));

        const finalScore = Math.min(100, Math.round(strength * getTfMultiplier(timeframeName)));

        obs.push({
          timeframe: timeframeName,
          type: "Bearish",
          top: c.high,
          bottom: c.low,
          mitigated,
          broken,
          freshness,
          strengthScore: finalScore,
          timestamp: c.timestamp
        });
      }
    }
  }

  return obs;
}

/**
 * Detects and Prioritizes Liquidity Pools & Sweeps
 */
function detectLiquidity(candles, currentPrice) {
  const swingHighs = [];
  const swingLows = [];
  const tolerance = 0.5; // gold tolerance for equal highs/lows

  // 1. Find swings
  for (let i = 2; i < candles.length - 2; i++) {
    const p = candles[i];
    if (p.high > candles[i-1].high && p.high > candles[i-2].high && p.high > candles[i+1].high && p.high > candles[i+2].high) {
      swingHighs.push({ price: p.high, timestamp: p.timestamp, index: i });
    }
    if (p.low < candles[i-1].low && p.low < candles[i-2].low && p.low < candles[i+1].low && p.low < candles[i+2].low) {
      swingLows.push({ price: p.low, timestamp: p.timestamp, index: i });
    }
  }

  // 2. EQH / EQL detection
  let equalHighs = null;
  let equalLows = null;

  for (let i = 0; i < swingHighs.length; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= tolerance) {
        equalHighs = { price: (swingHighs[i].price + swingHighs[j].price) / 2, type: "EQH" };
      }
    }
  }

  for (let i = 0; i < swingLows.length; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      if (Math.abs(swingLows[i].price - swingLows[j].price) <= tolerance) {
        equalLows = { price: (swingLows[i].price + swingLows[j].price) / 2, type: "EQL" };
      }
    }
  }

  // 3. Score and prioritize liquidity pools
  const getPoolPriority = (price, isBSL, isEqual) => {
    let score = 40; // base score
    if (isEqual) score += 30; // EQH/EQL bonus

    const distance = Math.abs(price - currentPrice);
    const distanceBonus = Math.max(0, 20 - distance * 2);
    score += distanceBonus;

    // Recency (check if swing is recent)
    let age = 50;
    const matchingSwing = isBSL 
      ? swingHighs.find(h => Math.abs(h.price - price) <= 0.01)
      : swingLows.find(l => Math.abs(l.price - price) <= 0.01);
    
    if (matchingSwing) {
      age = candles.length - 1 - matchingSwing.index;
    }
    score += Math.max(0, 10 - Math.floor(age / 5));

    return Math.min(100, Math.round(score));
  };

  const prioritizedBSL = [];
  const prioritizedSSL = [];

  swingHighs.forEach(h => {
    prioritizedBSL.push({
      price: h.price,
      type: "Buy-side (Swing High)",
      priority: getPoolPriority(h.price, true, false)
    });
  });
  if (equalHighs) {
    prioritizedBSL.push({
      price: equalHighs.price,
      type: "Buy-side (Equal Highs)",
      priority: getPoolPriority(equalHighs.price, true, true)
    });
  }

  swingLows.forEach(l => {
    prioritizedSSL.push({
      price: l.price,
      type: "Sell-side (Swing Low)",
      priority: getPoolPriority(l.price, false, false)
    });
  });
  if (equalLows) {
    prioritizedSSL.push({
      price: equalLows.price,
      type: "Sell-side (Equal Lows)",
      priority: getPoolPriority(equalLows.price, false, true)
    });
  }

  // Sort BSL and SSL by priority descending
  prioritizedBSL.sort((a, b) => b.priority - a.priority);
  prioritizedSSL.sort((a, b) => b.priority - a.priority);

  const highestPriorityBSL = prioritizedBSL[0] || null;
  const highestPrioritySSL = prioritizedSSL[0] || null;

  // 4. Sweeps check
  let lastSweepType = "None";
  let lastSweepTimestamp = null;

  if (candles.length > 2) {
    const lastCandle = candles[candles.length - 1];
    const lookbackHighs = swingHighs.filter(h => h.index < candles.length - 2 && h.index >= candles.length - 12);
    const lookbackLows = swingLows.filter(l => l.index < candles.length - 2 && l.index >= candles.length - 12);

    lookbackHighs.forEach(h => {
      if (lastCandle.high > h.price && lastCandle.close < h.price) {
        lastSweepType = "Bearish Sweep (Buy-side Liquidity Swept)";
        lastSweepTimestamp = lastCandle.timestamp;
      }
    });

    lookbackLows.forEach(l => {
      if (lastCandle.low < l.price && lastCandle.close > l.price) {
        lastSweepType = "Bullish Sweep (Sell-side Liquidity Swept)";
        lastSweepTimestamp = lastCandle.timestamp;
      }
    });
  }

  return {
    equalHighs: equalHighs ? equalHighs.price : null,
    equalLows: equalLows ? equalLows.price : null,
    highestPriorityBSL,
    highestPrioritySSL,
    lastSweepType,
    lastSweepTimestamp
  };
}

/**
 * Main Institutional Order Flow Analysis Orchestrator (Phase 1.7)
 */
function calculateOrderFlowIntelligence(priceHistory, currentPrice, structure) {
  if (!priceHistory || priceHistory.length < 15 || currentPrice === null) {
    return null;
  }

  // 1. Reconstruct candles on multiple timeframes: 5-minute, 15-minute, 1-hour
  const candles5m = buildCandles(priceHistory, 5);
  const candles15m = buildCandles(priceHistory, 15);
  const candles1h = buildCandles(priceHistory, 60);

  // Check if we have enough historical candles to run analysis
  if (candles5m.length < 5) {
    return null;
  }

  // 2. Detect FVGs across timeframes
  const fvgs5m = detectFVGs(candles5m, currentPrice, "5m", structure);
  const fvgs15m = detectFVGs(candles15m, currentPrice, "15m", structure);
  const fvgs1h = detectFVGs(candles1h, currentPrice, "1h", structure);
  
  const allFvgs = [...fvgs5m, ...fvgs15m, ...fvgs1h];

  // Rank FVGs by relevance: relevance = (timeframeWeight * 10) / (distance + 1.0)
  const getFvgWeight = (tf) => {
    if (tf === "1h") return 30;
    if (tf === "15m") return 20;
    return 10;
  };

  const rankedFvgs = allFvgs.map(f => {
    const tfWeight = getFvgWeight(f.timeframe);
    const relevance = (tfWeight * 10) / (f.distance + 1.0);
    return { ...f, relevance };
  });

  // Highest Quality Bullish FVG (unfilled, below current price or inside)
  const unfilledBullish = rankedFvgs.filter(f => f.type === "Bullish" && !f.filled && f.bottom < currentPrice);
  unfilledBullish.sort((a, b) => b.qualityScore - a.qualityScore || b.relevance - a.relevance);
  const nearestBullishFvg = unfilledBullish[0] || null;

  // Highest Quality Bearish FVG (unfilled, above current price or inside)
  const unfilledBearish = rankedFvgs.filter(f => f.type === "Bearish" && !f.filled && f.top > currentPrice);
  unfilledBearish.sort((a, b) => b.qualityScore - a.qualityScore || b.relevance - a.relevance);
  const nearestBearishFvg = unfilledBearish[0] || null;

  // 3. Order Blocks (merged across 5m, 15m, 1h)
  const obs5m = detectOrderBlocks(candles5m, currentPrice, structure, "5m");
  const obs15m = detectOrderBlocks(candles15m, currentPrice, structure, "15m");
  const obs1h = detectOrderBlocks(candles1h, currentPrice, structure, "1h");
  const obs = [...obs5m, ...obs15m, ...obs1h];
  
  // Nearest Bullish OB (active/unbroken, below or testing current price)
  const activeBullishObs = obs.filter(o => o.type === "Bullish" && !o.broken && o.bottom <= currentPrice);
  activeBullishObs.sort((a, b) => b.top - a.top);
  const nearestBullishOB = activeBullishObs[0] || null;

  // Nearest Bearish OB (active/unbroken, above or testing current price)
  const activeBearishObs = obs.filter(o => o.type === "Bearish" && !o.broken && o.top >= currentPrice);
  activeBearishObs.sort((a, b) => a.bottom - b.bottom);
  const nearestBearishOB = activeBearishObs[0] || null;

  // 4. Liquidity Pools & Sweeps (using 15m candles)
  const liquidity = detectLiquidity(candles15m, currentPrice);

  // Highest priority pool
  let nearestPool = null;
  if (liquidity.highestPriorityBSL && liquidity.highestPrioritySSL) {
    nearestPool = liquidity.highestPriorityBSL.priority >= liquidity.highestPrioritySSL.priority
      ? { price: liquidity.highestPriorityBSL.price, type: "Buy-side", priority: liquidity.highestPriorityBSL.priority }
      : { price: liquidity.highestPrioritySSL.price, type: "Sell-side", priority: liquidity.highestPrioritySSL.priority };
  } else if (liquidity.highestPriorityBSL) {
    nearestPool = { price: liquidity.highestPriorityBSL.price, type: "Buy-side", priority: liquidity.highestPriorityBSL.priority };
  } else if (liquidity.highestPrioritySSL) {
    nearestPool = { price: liquidity.highestPrioritySSL.price, type: "Sell-side", priority: liquidity.highestPrioritySSL.priority };
  }

  // 5. Institutional Bias & Recommended Interpretation
  let bullishScore = 0;
  let bearishScore = 0;

  if (nearestBullishOB) bullishScore += 2 * (nearestBullishOB.strengthScore / 100);
  if (nearestBearishOB) bearishScore += 2 * (nearestBearishOB.strengthScore / 100);
  if (nearestBullishFvg) bullishScore += 1 * (nearestBullishFvg.qualityScore / 100);
  if (nearestBearishFvg) bearishScore += 1 * (nearestBearishFvg.qualityScore / 100);

  if (liquidity.lastSweepType.includes("Bullish Sweep")) bullishScore += 1.5;
  if (liquidity.lastSweepType.includes("Bearish Sweep")) bearishScore += 1.5;

  let institutionalBias = "Neutral";
  if (bullishScore > bearishScore + 0.5) institutionalBias = "Bullish";
  else if (bearishScore > bullishScore + 0.5) institutionalBias = "Bearish";

  let recommendedInterpretation = "Wait for clear order flow patterns.";
  if (institutionalBias === "Bullish") {
    recommendedInterpretation = nearestBullishOB
      ? `Institutional bias is Bullish. Look for buys near Bullish Order Block at ${nearestBullishOB.top.toFixed(2)} USD (Strength: ${nearestBullishOB.strengthScore}, Freshness: ${nearestBullishOB.freshness} bars).`
      : "Bullish order flow bias. Watch for long entries on retracements.";
  } else if (institutionalBias === "Bearish") {
    recommendedInterpretation = nearestBearishOB
      ? `Institutional bias is Bearish. Look for sells near Bearish Order Block at ${nearestBearishOB.bottom.toFixed(2)} USD (Strength: ${nearestBearishOB.strengthScore}, Freshness: ${nearestBearishOB.freshness} bars).`
      : "Bearish order flow bias. Watch for short entries on pullbacks.";
  }

  return {
    nearestBullishOB,
    nearestBearishOB,
    nearestBullishFvg,
    nearestBearishFvg,
    liquidity,
    nearestPool,
    institutionalBias,
    recommendedInterpretation
  };
}

/**
 * Calculates Multi-Asset Macro Intelligence (Phase 1.8)
 */
async function calculateMacroIntelligence(priceHistory, currentPrice) {
  if (!priceHistory || priceHistory.length === 0) {
    return null;
  }

  // 1. Build Gold 15m candles
  const candlesGold = buildCandles(priceHistory, 15);

  const assets = [
    { name: "DXY", queryKey: "DXY", correlation: "negative", tier: 1, weight: 3.0 },
    { name: "US10Y", queryKey: "US10Y", correlation: "negative", tier: 1, weight: 3.0 },
    { name: "VIX", queryKey: "^VIX", correlation: "positive", tier: 2, weight: 2.0 },
    { name: "Silver", queryKey: "XAGUSD", correlation: "positive", tier: 2, weight: 2.0 },
    { name: "EURUSD", queryKey: "EURUSD", correlation: "positive", tier: 3, weight: 1.0 },
    { name: "USDJPY", queryKey: "USDJPY", correlation: "negative", tier: 3, weight: 1.0 },
    { name: "S&P 500", queryKey: "SPX500", correlation: "neutral", tier: 3, weight: 1.0 },
    { name: "BTCUSD", queryKey: "BTCUSD", correlation: "neutral", tier: 3, weight: 1.0 }
  ];

  const assetResults = {};

  for (const asset of assets) {
    let priceInfo = null;
    try {
      priceInfo = await getCurrentPrice(asset.queryKey);
    } catch (e) {
      // ignore
    }

    const hist = getPriceHistory(asset.queryKey);
    if (!priceInfo && hist.length === 0) {
      assetResults[asset.name] = { status: "Unavailable" };
      continue;
    }

    const currentAssetPrice = priceInfo ? priceInfo.price : (hist.length > 0 ? hist[hist.length - 1].price : null);

    let trend = "Neutral";
    let momentum = "Neutral";
    let direction = "SIDEWAYS";
    let r = null;
    let correlationText = "Correlation Unavailable";
    let confidence = "Correlation Unavailable";
    let influence = "Neutral";

    if (hist.length >= 3) {
      const prices = hist.map(h => h.price);
      const first = prices[0];
      const last = prices[prices.length - 1];
      const change = last - first;

      direction = change > 0.0001 ? "UP" : (change < -0.0001 ? "DOWN" : "SIDEWAYS");
      trend = change > 0.0001 ? "Bullish" : (change < -0.0001 ? "Bearish" : "Neutral");

      const half = Math.floor(prices.length / 2);
      const recentPrices = prices.slice(half);
      const recentChange = recentPrices[recentPrices.length - 1] - recentPrices[0];
      momentum = recentChange > 0.0001 ? "Bullish" : (recentChange < -0.0001 ? "Bearish" : "Neutral");

      // Calculate Pearson correlation dynamically using 15m candles
      const candlesAsset = buildCandles(hist, 15);
      r = alignCandlesAndCalculateCorrelation(candlesGold, candlesAsset);

      if (r !== null) {
        const absR = Math.abs(r);
        const signText = r >= 0 ? "Positive" : "Negative";
        const strengthText = absR >= 0.7 ? "Strong" : (absR >= 0.4 ? "Moderate" : "Weak");
        correlationText = `${strengthText} ${signText} (r: ${r.toFixed(2)})`;

        // Confidence
        const overlapCount = candlesGold.filter(cg => candlesAsset.some(ca => ca.timestamp === cg.timestamp)).length;
        if (overlapCount >= 15) confidence = "High";
        else if (overlapCount >= 10) confidence = "Medium";
        else if (overlapCount >= 5) confidence = "Low";
        else confidence = "Correlation Unavailable";

        // Determine influence dynamically based on correlation and price direction
        if (absR >= 0.3 && direction !== "SIDEWAYS") {
          if (r > 0) {
            influence = direction === "UP" ? "Bullish" : "Bearish";
          } else {
            influence = direction === "UP" ? "Bearish" : "Bullish";
          }
        }
      }
    } else if (currentAssetPrice !== null) {
      trend = "Neutral/Mixed";
      momentum = "Neutral/Mixed";
      direction = "SIDEWAYS";
    }

    assetResults[asset.name] = {
      status: "Available",
      price: currentAssetPrice,
      trend,
      momentum,
      direction,
      r,
      correlationText,
      confidence,
      influence,
      weight: asset.weight
    };
  }

  // 2. Weighted macro alignment calculations
  let totalBullishWeight = 0;
  let totalBearishWeight = 0;
  let totalTrackedWeight = 0;

  Object.values(assetResults).forEach(asset => {
    if (asset.status === "Available") {
      totalTrackedWeight += asset.weight;
      if (asset.influence === "Bullish") {
        totalBullishWeight += asset.weight;
      } else if (asset.influence === "Bearish") {
        totalBearishWeight += asset.weight;
      }
    }
  });

  let macroAlignment = "Mixed";
  let bullishPct = 0;
  let bearishPct = 0;

  if (totalTrackedWeight > 0) {
    bullishPct = Math.round((totalBullishWeight / totalTrackedWeight) * 100);
    bearishPct = Math.round((totalBearishWeight / totalTrackedWeight) * 100);

    if (bullishPct >= 90 && totalBullishWeight >= 5.0) {
      macroAlignment = "Perfect Bullish Alignment";
    } else if (bullishPct >= 70) {
      macroAlignment = "Strong Bullish Alignment";
    } else if (bearishPct >= 90 && totalBearishWeight >= 5.0) {
      macroAlignment = "Perfect Bearish Alignment";
    } else if (bearishPct >= 70) {
      macroAlignment = "Strong Bearish Alignment";
    }
  }

  const goldMacroBias = bullishPct > bearishPct ? "Bullish" : (bearishPct > bullishPct ? "Bearish" : "Neutral");

  // 3. Conflict Detection
  let conflictPoints = 0;
  
  // DXY vs US10Y (Tier 1 drivers) opposing
  if (assetResults["DXY"]?.status === "Available" && assetResults["US10Y"]?.status === "Available") {
    if (assetResults["DXY"].influence !== "Neutral" && assetResults["US10Y"].influence !== "Neutral" &&
        assetResults["DXY"].influence !== assetResults["US10Y"].influence) {
      conflictPoints += 40;
    }
  }

  // DXY vs Silver opposing
  if (assetResults["DXY"]?.status === "Available" && assetResults["Silver"]?.status === "Available") {
    if (assetResults["DXY"].influence !== "Neutral" && assetResults["Silver"].influence !== "Neutral" &&
        assetResults["DXY"].influence !== assetResults["Silver"].influence) {
      conflictPoints += 40;
    }
  }

  // VIX vs S&P 500: VIX bullish (risk off) but S&P 500 also bullish/up (risk on)
  if (assetResults["VIX"]?.status === "Available" && assetResults["S&P 500"]?.status === "Available") {
    if (assetResults["VIX"].influence !== "Neutral" && assetResults["S&P 500"].influence !== "Neutral" &&
        assetResults["VIX"].influence === assetResults["S&P 500"].influence) {
      conflictPoints += 20;
    }
  }

  const macroConflictLevel = conflictPoints >= 60 ? "High" : (conflictPoints >= 30 ? "Moderate" : "Low");

  // 4. Drivers ranking
  const convictionDrivers = [];
  const weakestDrivers = [];

  Object.keys(assetResults).forEach(name => {
    const asset = assetResults[name];
    if (asset.status === "Available") {
      const absR = asset.r !== null ? Math.abs(asset.r) : 0;
      if (asset.r !== null && absR >= 0.5) {
        convictionDrivers.push(`${name} (r: ${asset.r.toFixed(2)}, ${asset.confidence} Conf)`);
      } else {
        weakestDrivers.push(`${name} (r: ${asset.r !== null ? asset.r.toFixed(2) : "N/A"}, ${asset.confidence})`);
      }
    } else {
      weakestDrivers.push(`${name} (Unavailable)`);
    }
  });

  const highestConvictionDrivers = convictionDrivers.length > 0 ? convictionDrivers.join(", ") : "None";
  const finalWeakestDrivers = weakestDrivers.join(", ");

  // 5. Correlation confidence based on driver confidence
  let overallConf = "Low";
  let highConfCount = 0;
  Object.values(assetResults).forEach(asset => {
    if (asset.status === "Available" && asset.influence === goldMacroBias && asset.confidence === "High") {
      highConfCount++;
    }
  });
  if (highConfCount >= 2) overallConf = "High";
  else if (highConfCount >= 1) overallConf = "Medium";
  else if (goldMacroBias !== "Neutral") overallConf = "Low";
  else overallConf = "N/A (Bias Neutral)";

  // Primary Macro Reason dynamic text
  let primaryMacroReason = "No significant macro bias identified.";
  if (goldMacroBias === "Bullish") {
    primaryMacroReason = `Macro alignment is Bullish (${bullishPct}%) driven by supportive moves in ${highestConvictionDrivers !== "None" ? highestConvictionDrivers.split(",")[0] : "uncorrelated assets"}.`;
  } else if (goldMacroBias === "Bearish") {
    primaryMacroReason = `Macro alignment is Bearish (${bearishPct}%) driven by pressure in ${highestConvictionDrivers !== "None" ? highestConvictionDrivers.split(",")[0] : "uncorrelated assets"}.`;
  }

  // Recommended Interpretation
  let recommendedInterpretation = "Wait for macro alignment.";
  if (goldMacroBias === "Bullish" && macroConflictLevel !== "High") {
    recommendedInterpretation = "Macro environment is highly supportive of longs. Focus on buying retracements near key support levels.";
  } else if (goldMacroBias === "Bearish" && macroConflictLevel !== "High") {
    recommendedInterpretation = "Macro environment is highly supportive of shorts. Focus on selling pullbacks near key resistance levels.";
  } else if (macroConflictLevel === "High") {
    recommendedInterpretation = "High macro conflicts present. Exercise extreme caution; consider standing aside or lowering risk parameters.";
  }

  return {
    assetResults,
    macroAlignment,
    bullishPct,
    bearishPct,
    goldMacroBias,
    correlationConfidence: overallConf,
    macroConflictLevel,
    highestConvictionDrivers,
    weakestDrivers: finalWeakestDrivers,
    primaryMacroReason,
    recommendedInterpretation
  };
}

/**
 * Aligns two candle sets and calculates Pearson correlation
 */
function alignCandlesAndCalculateCorrelation(candlesXau, candlesAsset) {
  const mapAsset = new Map();
  candlesAsset.forEach(c => {
    mapAsset.set(c.timestamp, c.close);
  });

  const alignedX = [];
  const alignedY = [];

  candlesXau.forEach(c => {
    if (mapAsset.has(c.timestamp)) {
      alignedX.push(c.close);
      alignedY.push(mapAsset.get(c.timestamp));
    }
  });

  if (alignedX.length < 5) return null;
  return calculateCorrelation(alignedX, alignedY);
}

/**
 * Calculates Pearson Correlation Coefficient
 */
function calculateCorrelation(x, y) {
  const n = x.length;
  if (n < 5 || n !== y.length) return null;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    num += diffX * diffY;
    denX += diffX * diffX;
    denY += diffY * diffY;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}
