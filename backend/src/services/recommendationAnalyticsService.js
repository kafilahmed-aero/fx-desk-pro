import mongoose from "mongoose";
import { AiRecommendationSnapshot } from "../models/aiRecommendationSnapshotModel.js";
import { logger } from "../utils/logger.js";

// In-memory fallback for testing or non-Mongo environments
export const localSnapshots = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Captures and saves an immutable snapshot of recommendation intelligence.
 * Wrapped in try/catch to guarantee safety (never disrupts main execution).
 */
export async function captureIntelligenceSnapshot(rec, context) {
  try {
    const snapshotData = {
      recommendationId: rec.recommendationId,
      schemaVersion: 1,
      timestamp: new Date(),
      direction: rec.direction,
      confidence: rec.confidence,
      entryMin: rec.entryMin,
      entryMax: rec.entryMax,
      sl: rec.sl,
      tp: rec.tp,
      moderateTp: rec.moderateTp,
      highRiskTp: rec.highRiskTp,
      telegramQuality: context.telegramQuality || null,
      telegramConsensus: context.telegramConsensus || null,
      weightedConsensus: context.weightedConsensus || null,
      channelReliability: context.channelReliability || null,
      marketRegime: context.marketRegime || null,
      regimeConfidence: context.regimeConfidence || null,
      institutionalBias: context.institutionalBias || null,
      macroAlignment: context.macroAlignment || null,
      macroConflictLevel: context.macroConflictLevel || null,
      premiumDiscount: context.premiumDiscount || null,
      nearestOrderBlock: context.nearestOrderBlock || null,
      nearestFairValueGap: context.nearestFairValueGap || null,
      liquidityStatus: context.liquidityStatus || null,
      dxyDirection: context.dxyDirection || null,
      us10yDirection: context.us10yDirection || null,
      silverDirection: context.silverDirection || null,
      overallConfluenceScore: context.overallConfluenceScore || null,
      tradeFilter: context.tradeFilter || null,
      tradingSession: context.tradingSession || null,
      emergencyMacroOverrideStatus: !!context.emergencyMacroOverrideStatus,
      promptMetadata: {
        promptVersion: context.promptVersion || "1.0",
        promptHash: context.promptHash || null,
        geminiModel: context.geminiModel || "gemini-2.5-flash",
        generationTimestamp: new Date()
      },
      outcome: {
        status: null,
        holdingTimeMs: null,
        maxFavorableExcursion: null,
        maxAdverseExcursion: null,
        profitAchievedBeforeReversal: null,
        lossBeforeRecovery: null,
        distanceTravelled: null,
        resolvedAt: null
      }
    };

    if (isMongoConnected()) {
      await AiRecommendationSnapshot.create(snapshotData);
    }
    // Always sync to memory store for unified access & fallback
    localSnapshots.set(rec.recommendationId, snapshotData);

    logger.info("analytics.snapshot_captured", { recommendationId: rec.recommendationId });
  } catch (err) {
    logger.error("analytics.capture_failed", { recommendationId: rec?.recommendationId, error: err.message });
  }
}

/**
 * Appends final trade outcome metrics to the immutable snapshot.
 * Wrapped in try/catch to guarantee safety.
 */
export async function updateSnapshotOutcome(recommendationId, terminalOutcome) {
  try {
    // 1. Fetch the existing snapshot
    let snapshot = null;
    if (isMongoConnected()) {
      snapshot = await AiRecommendationSnapshot.findOne({ recommendationId }).lean();
    } else {
      snapshot = localSnapshots.get(recommendationId) || null;
    }

    if (!snapshot) {
      logger.warn("analytics.update_snapshot_skipped_missing", { recommendationId });
      return;
    }

    // 2. Parse details
    const direction = snapshot.direction;
    const entryPrice = terminalOutcome.simulatedEntryPrice || (snapshot.entryMin + snapshot.entryMax) / 2;
    const exitPrice = terminalOutcome.outcomePrice;
    const entryTime = terminalOutcome.simulatedEntryTime ? new Date(terminalOutcome.simulatedEntryTime) : null;
    const exitTime = terminalOutcome.outcomeTime ? new Date(terminalOutcome.outcomeTime) : new Date();

    const highestPriceSeen = terminalOutcome.highestPriceSeen !== null && terminalOutcome.highestPriceSeen !== undefined ? Number(terminalOutcome.highestPriceSeen) : null;
    const lowestPriceSeen = terminalOutcome.lowestPriceSeen !== null && terminalOutcome.lowestPriceSeen !== undefined ? Number(terminalOutcome.lowestPriceSeen) : null;

    // 3. Compute metrics
    let holdingTimeMs = null;
    if (entryTime && exitTime) {
      holdingTimeMs = Math.max(0, exitTime.getTime() - entryTime.getTime());
    }

    let maxFavorableExcursion = null;
    let maxAdverseExcursion = null;
    let distanceTravelled = null;

    if (entryPrice && highestPriceSeen && lowestPriceSeen) {
      if (direction === "BUY") {
        maxFavorableExcursion = Math.max(0, highestPriceSeen - entryPrice);
        maxAdverseExcursion = Math.max(0, entryPrice - lowestPriceSeen);
      } else if (direction === "SELL") {
        maxFavorableExcursion = Math.max(0, entryPrice - lowestPriceSeen);
        maxAdverseExcursion = Math.max(0, highestPriceSeen - entryPrice);
      }
    }

    if (entryPrice && exitPrice) {
      if (direction === "BUY") {
        distanceTravelled = exitPrice - entryPrice;
      } else if (direction === "SELL") {
        distanceTravelled = entryPrice - exitPrice;
      }
    }

    const profitAchievedBeforeReversal = maxFavorableExcursion;
    const lossBeforeRecovery = maxAdverseExcursion;

    const outcomeUpdate = {
      status: terminalOutcome.status === "SL_HIT" ? "SL" : terminalOutcome.status,
      holdingTimeMs,
      maxFavorableExcursion: maxFavorableExcursion !== null ? Number(maxFavorableExcursion.toFixed(2)) : null,
      maxAdverseExcursion: maxAdverseExcursion !== null ? Number(maxAdverseExcursion.toFixed(2)) : null,
      profitAchievedBeforeReversal: profitAchievedBeforeReversal !== null ? Number(profitAchievedBeforeReversal.toFixed(2)) : null,
      lossBeforeRecovery: lossBeforeRecovery !== null ? Number(lossBeforeRecovery.toFixed(2)) : null,
      distanceTravelled: distanceTravelled !== null ? Number(distanceTravelled.toFixed(2)) : null,
      resolvedAt: exitTime
    };

    if (isMongoConnected()) {
      await AiRecommendationSnapshot.updateOne(
        { recommendationId },
        { $set: { outcome: outcomeUpdate } }
      );
    }

    // Always update local memory cache
    const cached = localSnapshots.get(recommendationId);
    if (cached) {
      cached.outcome = outcomeUpdate;
      localSnapshots.set(recommendationId, cached);
    }

    logger.info("analytics.snapshot_outcome_updated", { recommendationId, status: outcomeUpdate.status });
  } catch (err) {
    logger.error("analytics.update_outcome_failed", { recommendationId, error: err.message });
  }
}

/**
 * Calculates win rate, average RR, and trade counts for a subset of snapshots.
 */
function calculateStatsForGroup(snapshots) {
  const resolved = snapshots.filter(s => s.outcome && s.outcome.status);
  const total = resolved.length;
  
  const wins = resolved.filter(s => s.outcome.status === "FULL_TP" || s.outcome.status === "PARTIAL_TP").length;
  const losses = resolved.filter(s => s.outcome.status === "SL" || s.outcome.status === "SL_HIT").length;
  
  const winDenominator = wins + losses;
  const winRate = winDenominator > 0 ? Number(((wins / winDenominator) * 100).toFixed(1)) : null;

  // Calculate average Risk:Reward ratio
  const rrs = resolved
    .map(s => {
      // Use exitPrice vs entryPrice compared to stopLoss
      const entry = (s.entryMin + s.entryMax) / 2;
      const sl = s.sl;
      const status = s.outcome.status;
      if (!entry || !sl || entry === sl) return null;
      
      let target = s.tp;
      if (status === "FULL_TP" && s.highRiskTp) target = s.highRiskTp;
      else if (status === "PARTIAL_TP" && s.moderateTp) target = s.moderateTp;

      if (!target) return null;
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(target - entry);
      return risk > 0 ? reward / risk : null;
    })
    .filter(v => v !== null);

  const avgRR = rrs.length > 0 ? Number((rrs.reduce((a, b) => a + b, 0) / rrs.length).toFixed(2)) : null;

  return { total, winRate, avgRR };
}

/**
 * Compiles effectiveness stats, feature contribution, and dashboard aggregation.
 */
export async function getDashboardAndAnalytics() {
  let snapshots = [];
  if (isMongoConnected()) {
    try {
      snapshots = await AiRecommendationSnapshot.find({}).lean();
    } catch (err) {
      logger.error("analytics.query_snapshots_failed", { error: err.message });
      snapshots = Array.from(localSnapshots.values());
    }
  } else {
    snapshots = Array.from(localSnapshots.values());
  }

  const resolved = snapshots.filter(s => s.outcome && s.outcome.status);

  // 1. Compute Overall Stats
  const overall = calculateStatsForGroup(snapshots);
  
  const holdingTimes = resolved
    .map(s => s.outcome.holdingTimeMs)
    .filter(t => t !== null && t > 0);
  const avgHoldingTimeMs = holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : 0;
  const avgHoldingTimeMin = avgHoldingTimeMs > 0 ? Number((avgHoldingTimeMs / 60000).toFixed(1)) : null;

  // 2. Intelligence Effectiveness
  const effectiveness = {
    marketRegime: {},
    macroAlignment: {},
    telegramQuality: {},
    institutionalBias: {},
    orderBlock: { Present: { total: 0, winRate: null, avgRR: null }, Absent: { total: 0, winRate: null, avgRR: null } },
    fvg: { Present: { total: 0, winRate: null, avgRR: null }, Absent: { total: 0, winRate: null, avgRR: null } },
    liquiditySweep: { Present: { total: 0, winRate: null, avgRR: null }, Absent: { total: 0, winRate: null, avgRR: null } }
  };

  const regimes = ["Strong Trend", "Compression", "Trending", "Range", "Breakout", "Pullback", "Reversal Candidate", "Expansion", "High Volatility Range", "Weak Trend", "Regime Unknown"];
  regimes.forEach(r => {
    const subset = snapshots.filter(s => s.marketRegime === r);
    effectiveness.marketRegime[r] = calculateStatsForGroup(subset);
  });

  const macros = ["Perfect Bullish", "Strong Bullish", "Mixed", "Strong Bearish", "Perfect Bearish", "Neutral"];
  macros.forEach(m => {
    const subset = snapshots.filter(s => s.macroAlignment && s.macroAlignment.includes(m));
    effectiveness.macroAlignment[m] = calculateStatsForGroup(subset);
  });

  const qualities = ["Excellent", "High", "Good", "Medium", "Fair", "Low", "Poor"];
  qualities.forEach(q => {
    const subset = snapshots.filter(s => s.telegramQuality === q);
    effectiveness.telegramQuality[q] = calculateStatsForGroup(subset);
  });

  const biases = ["Bullish", "Bearish", "Neutral"];
  biases.forEach(b => {
    const subset = snapshots.filter(s => s.institutionalBias === b);
    effectiveness.institutionalBias[b] = calculateStatsForGroup(subset);
  });

  // Order Block
  const obPresent = snapshots.filter(s => s.nearestOrderBlock && s.nearestOrderBlock !== "None");
  effectiveness.orderBlock.Present = calculateStatsForGroup(obPresent);
  const obAbsent = snapshots.filter(s => !s.nearestOrderBlock || s.nearestOrderBlock === "None");
  effectiveness.orderBlock.Absent = calculateStatsForGroup(obAbsent);

  // FVG
  const fvgPresent = snapshots.filter(s => s.nearestFairValueGap && s.nearestFairValueGap !== "None");
  effectiveness.fvg.Present = calculateStatsForGroup(fvgPresent);
  const fvgAbsent = snapshots.filter(s => !s.nearestFairValueGap || s.nearestFairValueGap === "None");
  effectiveness.fvg.Absent = calculateStatsForGroup(fvgAbsent);

  // Liquidity Sweep
  const sweepPresent = snapshots.filter(s => s.liquidityStatus && s.liquidityStatus.includes("Last Sweep:") && !s.liquidityStatus.includes("Last Sweep: None"));
  effectiveness.liquiditySweep.Present = calculateStatsForGroup(sweepPresent);
  const sweepAbsent = snapshots.filter(s => !s.liquidityStatus || s.liquidityStatus.includes("Last Sweep: None") || !s.liquidityStatus.includes("Last Sweep:"));
  effectiveness.liquiditySweep.Absent = calculateStatsForGroup(sweepAbsent);

  // 3. Feature Contribution Rankings
  const getFeatureList = (s) => {
    const list = [];
    if (s.marketRegime) list.push(`Regime:${s.marketRegime}`);
    if (s.macroAlignment) {
      macros.forEach(m => {
        if (s.macroAlignment.includes(m)) list.push(`Macro:${m}`);
      });
    }
    if (s.telegramQuality) list.push(`TelQuality:${s.telegramQuality}`);
    if (s.institutionalBias) list.push(`Bias:${s.institutionalBias}`);
    if (s.nearestOrderBlock && s.nearestOrderBlock !== "None") list.push("OB:Present");
    if (s.nearestFairValueGap && s.nearestFairValueGap !== "None") list.push("FVG:Present");
    if (s.liquidityStatus && s.liquidityStatus.includes("Last Sweep:") && !s.liquidityStatus.includes("Last Sweep: None")) list.push("Sweep:Present");
    if (s.tradingSession) list.push(`Session:${s.tradingSession}`);
    return list;
  };

  const wins = resolved.filter(s => s.outcome.status === "FULL_TP" || s.outcome.status === "PARTIAL_TP");
  const losses = resolved.filter(s => s.outcome.status === "SL" || s.outcome.status === "SL_HIT");
  const partials = resolved.filter(s => s.outcome.status === "PARTIAL_TP");
  const cancelled = resolved.filter(s => s.outcome.status === "CANCELLED");

  const buildFrequencyRanking = (snapshotsList) => {
    const freqs = {};
    snapshotsList.forEach(s => {
      getFeatureList(s).forEach(feat => {
        freqs[feat] = (freqs[feat] || 0) + 1;
      });
    });
    return Object.entries(freqs)
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count);
  };

  const featureContribution = {
    winningTrades: buildFrequencyRanking(wins),
    losingTrades: buildFrequencyRanking(losses),
    partialTpTrades: buildFrequencyRanking(partials),
    cancelledTrades: buildFrequencyRanking(cancelled)
  };

  // 4. Performance Dashboard Calculations
  const getExtreme = (dict, keyName, type) => {
    let bestVal = type === "best" ? -Infinity : Infinity;
    let extremeItem = null;
    let extremeTrades = 0;

    Object.entries(dict).forEach(([name, stats]) => {
      if (stats.total > 0 && stats.winRate !== null) {
        const isBetter = type === "best" ? (stats.winRate > bestVal || (stats.winRate === bestVal && stats.total > extremeTrades))
                                        : (stats.winRate < bestVal || (stats.winRate === bestVal && stats.total > extremeTrades));
        if (isBetter) {
          bestVal = stats.winRate;
          extremeItem = name;
          extremeTrades = stats.total;
        }
      }
    });

    return extremeItem ? { [keyName]: extremeItem, winRate: bestVal, trades: extremeTrades } : null;
  };

  const sessions = ["Sydney/Asian", "London", "London-New York Overlap", "New York"];
  const sessionStats = {};
  sessions.forEach(sess => {
    const subset = snapshots.filter(s => s.tradingSession === sess);
    sessionStats[sess] = calculateStatsForGroup(subset);
  });

  // Calculate most / least successful combination (Regime + Macro + Bias)
  const combinationStats = {};
  resolved.forEach(s => {
    if (s.marketRegime && s.macroAlignment && s.institutionalBias) {
      let macroName = "Mixed";
      macros.forEach(m => {
        if (s.macroAlignment.includes(m)) macroName = m;
      });
      const comb = `${s.marketRegime} | ${macroName} | ${s.institutionalBias}`;
      if (!combinationStats[comb]) {
        combinationStats[comb] = { wins: 0, total: 0 };
      }
      combinationStats[comb].total++;
      if (s.outcome.status === "FULL_TP" || s.outcome.status === "PARTIAL_TP") {
        combinationStats[comb].wins++;
      }
    }
  });

  const combos = Object.entries(combinationStats).map(([comb, data]) => {
    const winRate = Number(((data.wins / data.total) * 100).toFixed(1));
    return { combination: comb, winRate, trades: data.total };
  });

  const bestCombo = combos.length > 0 ? [...combos].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades)[0] : null;
  const worstCombo = combos.length > 0 ? [...combos].sort((a, b) => a.winRate - b.winRate || b.trades - a.trades)[0] : null;

  const performanceDashboard = {
    overallWinRate: overall.winRate,
    averageRR: overall.avgRR,
    averageHoldingTimeMin: avgHoldingTimeMin,
    bestMarketRegime: getExtreme(effectiveness.marketRegime, "regime", "best"),
    worstMarketRegime: getExtreme(effectiveness.marketRegime, "regime", "worst"),
    bestMacroAlignment: getExtreme(effectiveness.macroAlignment, "alignment", "best"),
    worstMacroAlignment: getExtreme(effectiveness.macroAlignment, "alignment", "worst"),
    bestTelegramQuality: getExtreme(effectiveness.telegramQuality, "quality", "best"),
    worstTelegramQuality: getExtreme(effectiveness.telegramQuality, "quality", "worst"),
    bestTradingSession: getExtreme(sessionStats, "session", "best"),
    worstTradingSession: getExtreme(sessionStats, "session", "worst"),
    mostSuccessfulCombination: bestCombo,
    leastSuccessfulCombination: worstCombo
  };

  return {
    intelligenceEffectiveness: effectiveness,
    featureContribution,
    performanceDashboard
  };
}
