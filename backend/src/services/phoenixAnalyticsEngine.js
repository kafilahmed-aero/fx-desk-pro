import { getTradeHistory } from "./phoenixMemoryService.js";
import { getTradeFeatures, phoenixDeepFreeze } from "./phoenixFeatureEngine.js";

// ==========================================
// Centralized Statistical Utilities
// ==========================================

export function calcMedian(arr) {
  if (!arr || arr.length === 0) return 0.0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2.0).toFixed(4));
}

export function calcStandardDeviation(arr) {
  if (!arr || arr.length <= 1) return 0.0;
  const avg = arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (arr.length - 1);
  return Number(Math.sqrt(variance).toFixed(4));
}

export function calcPercentiles(arr) {
  if (!arr || arr.length === 0) {
    return { p25: 0.0, p50: 0.0, p75: 0.0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const getPercentile = (p) => {
    const idx = (sorted.length - 1) * p;
    const base = Math.floor(idx);
    const rest = idx - base;
    if (sorted[base + 1] !== undefined) {
      return Number((sorted[base] + rest * (sorted[base + 1] - sorted[base])).toFixed(4));
    }
    return Number(sorted[base].toFixed(4));
  };
  return {
    p25: getPercentile(0.25),
    p50: getPercentile(0.50),
    p75: getPercentile(0.75)
  };
}

export function calcConfidenceLevel(sampleSize) {
  if (sampleSize <= 5) return "LOW";
  if (sampleSize <= 15) return "MEDIUM";
  if (sampleSize <= 50) return "HIGH";
  return "VERY HIGH";
}

/**
 * Computes performance trend by comparing win rate of newer trades vs older trades.
 */
export function calcTrend(olderTrades, newerTrades) {
  if (olderTrades.length === 0 || newerTrades.length === 0) {
    return "Stable";
  }
  const getWinRate = (list) => {
    const wins = list.filter(t => {
      const outcome = String(t.result?.outcome || "").toUpperCase();
      return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
    }).length;
    return wins / list.length;
  };

  const oldWinRate = getWinRate(olderTrades);
  const newWinRate = getWinRate(newerTrades);

  const diff = newWinRate - oldWinRate;
  if (diff > 0.05) return "Improving";
  if (diff < -0.05) return "Declining";
  return "Stable";
}

// ==========================================
// Timeframe Filtering Logic
// ==========================================

export function filterByTimeframe(trades, timeframe = "allTime", startDate = null, endDate = null) {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  
  const now = new Date();
  const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const endOfDay = (date) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  };

  let startLimit = null;
  let endLimit = null;

  switch (timeframe) {
    case "today":
      startLimit = startOfDay(now);
      endLimit = endOfDay(now);
      break;
    case "yesterday":
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      startLimit = startOfDay(yesterday);
      endLimit = endOfDay(yesterday);
      break;
    case "last7Days":
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      startLimit = sevenDaysAgo;
      endLimit = now;
      break;
    case "last30Days":
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      startLimit = thirtyDaysAgo;
      endLimit = now;
      break;
    case "currentMonth":
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startLimit = startOfDay(firstOfMonth);
      endLimit = now;
      break;
    case "custom":
      if (startDate) startLimit = new Date(startDate);
      if (endDate) endLimit = new Date(endDate);
      break;
    case "allTime":
    default:
      return trades;
  }

  return trades.filter(t => {
    // Utilize trade closeTime (or fallback to createdAt or timeline timestamp)
    const rawTime = t.result?.closeTime || t.createdAt || t.environment?.timestamp;
    if (!rawTime) return true;
    const time = new Date(rawTime);
    if (startLimit && time < startLimit) return false;
    if (endLimit && time > endLimit) return false;
    return true;
  });
}

// ==========================================
// Primary Report Generation API
// ==========================================

export async function generateAnalyticsReport(filters = {}) {
  // 1. Fetch trade memory history and features
  const allRawTrades = await getTradeHistory({}, { sort: { "result.closeTime": 1 } });
  const allRawFeatures = await getTradeFeatures({});

  // 2. Filter historical trade memory datasets by timeframe
  const filteredRawTrades = filterByTimeframe(allRawTrades, filters.timeframe, filters.startDate, filters.endDate);
  
  // Create matching mapping map by tradeId
  const featureMap = new Map();
  allRawFeatures.forEach(f => {
    featureMap.set(f.tradeId, f);
  });

  const dataset = filteredRawTrades.map(t => {
    return {
      raw: t,
      features: featureMap.get(t.tradeId)?.features || null
    };
  });

  // Safe structures if empty dataset
  if (dataset.length === 0) {
    return createEmptyReport();
  }

  // Helper arrays for aggregations
  const totalTrades = dataset.length;
  const netProfits = dataset.map(d => Number(d.raw.result?.netProfit || 0));
  const durations = dataset.map(d => Number(d.raw.result?.durationMs || 0) / 1000.0);
  const rrs = dataset.map(d => Number(d.raw.result?.rMultiple || d.raw.result?.rrAchieved || 0));
  const confidences = dataset.map(d => Number(d.raw.signalInfo?.confidence || d.raw.decisionEngine?.finalScore || 0));

  // Partition dataset to compute overall trend indicators
  const half = Math.floor(totalTrades / 2);
  const olderRaw = filteredRawTrades.slice(0, half);
  const newerRaw = filteredRawTrades.slice(half);
  const systemTrend = calcTrend(olderRaw, newerRaw);

  const winsList = dataset.filter(d => {
    const outcome = String(d.raw.result?.outcome || "").toUpperCase();
    return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (d.raw.result?.netProfit > 0);
  });
  const lossesList = dataset.filter(d => {
    const outcome = String(d.raw.result?.outcome || "").toUpperCase();
    return outcome === "SL" || (d.raw.result?.netProfit < 0);
  });

  const winCount = winsList.length;
  const lossCount = lossesList.length;
  const winRate = Number((winCount / totalTrades).toFixed(4));
  const lossRate = Number((lossCount / totalTrades).toFixed(4));

  const netProfit = Number(netProfits.reduce((sum, v) => sum + v, 0).toFixed(2));
  const averageRR = rrs.length > 0 ? Number((rrs.reduce((sum, v) => sum + v, 0) / rrs.length).toFixed(4)) : 0.0;
  const averageTradeDuration = durations.length > 0 ? Number((durations.reduce((sum, v) => sum + v, 0) / durations.length).toFixed(4)) : 0.0;

  // Expectancy & Profit Factor calculation
  const grossProfit = winsList.reduce((sum, d) => sum + Number(d.raw.result?.netProfit || 0), 0);
  const grossLoss = Math.abs(lossesList.reduce((sum, d) => sum + Number(d.raw.result?.netProfit || 0), 0));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : Number(grossProfit.toFixed(4));
  const expectancy = Number((netProfit / totalTrades).toFixed(4));

  // Max Drawdown calculation
  const drawdowns = dataset.map(d => Number(d.raw.result?.drawdown || 0));
  const maxDrawdown = drawdowns.length > 0 ? Math.max(...drawdowns) : 0.0;

  // Statistical distribution for Net Profit
  const profitDistribution = {
    median: calcMedian(netProfits),
    min: netProfits.length > 0 ? Math.min(...netProfits) : 0.0,
    max: netProfits.length > 0 ? Math.max(...netProfits) : 0.0,
    stdDev: calcStandardDeviation(netProfits),
    ...calcPercentiles(netProfits)
  };

  // ==========================================
  // 1. Channel Performance Aggregation
  // ==========================================
  const channelDataMap = new Map();
  dataset.forEach(d => {
    const channels = d.raw.signalInfo?.channels || ["Unknown Channel"];
    channels.forEach(ch => {
      if (!channelDataMap.has(ch)) {
        channelDataMap.set(ch, { rawTrades: [], featuresList: [] });
      }
      channelDataMap.get(ch).rawTrades.push(d.raw);
      if (d.features) channelDataMap.get(ch).featuresList.push(d.features);
    });
  });

  const channelPerformance = {};
  channelDataMap.forEach((val, ch) => {
    const chTrades = val.rawTrades;
    const count = chTrades.length;
    const wins = chTrades.filter(t => {
      const outcome = String(t.result?.outcome || "").toUpperCase();
      return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
    }).length;
    
    const chWinRate = count > 0 ? Number((wins / count).toFixed(4)) : 0.0;
    const chProfits = chTrades.map(t => Number(t.result?.netProfit || 0));
    const chRrs = chTrades.map(t => Number(t.result?.rMultiple || t.result?.rrAchieved || 0));
    const chDrawdowns = chTrades.map(t => Number(t.result?.drawdown || 0));

    const avgRR = chRrs.length > 0 ? Number((chRrs.reduce((sum, v) => sum + v, 0) / chRrs.length).toFixed(4)) : 0.0;
    const avgProfit = chProfits.length > 0 ? Number((chProfits.reduce((sum, v) => sum + v, 0) / chProfits.length).toFixed(2)) : 0.0;
    const avgDrawdown = chDrawdowns.length > 0 ? Number((chDrawdowns.reduce((sum, v) => sum + v, 0) / chDrawdowns.length).toFixed(4)) : 0.0;

    // Calculate reliability score (winRate weight 60%, risk-reward weight 40%)
    const reliabilityScore = count > 0 ? Number(((chWinRate * 0.6 + Math.min(1.0, avgRR / 3.0) * 0.4) * 100).toFixed(2)) : 0.0;
    const confidence = calcConfidenceLevel(count);

    // Trend detection for channel
    const chHalf = Math.floor(count / 2);
    const chTrend = calcTrend(chTrades.slice(0, chHalf), chTrades.slice(chHalf));

    channelPerformance[ch] = {
      tradeCount: count,
      winRate: chWinRate,
      averageRR: avgRR,
      averageProfit: avgProfit,
      averageDrawdown: avgDrawdown,
      reliabilityScore,
      confidence,
      trend: chTrend,
      minSampleThreshold: 5
    };
  });

  // ==========================================
  // 2. Session Performance Aggregation
  // ==========================================
  const sessions = ["London", "New York", "London/NY Overlap", "Asian", "Holiday"];
  const sessionPerformance = {};
  sessions.forEach(s => {
    const sTrades = dataset.filter(d => {
      const currentSession = d.raw.environment?.session || d.raw.marketContext?.session?.currentSession;
      return String(currentSession).toUpperCase() === s.toUpperCase() ||
             (s === "New York" && String(currentSession).toUpperCase() === "NEWYORK");
    }).map(d => d.raw);

    const count = sTrades.length;
    const wins = sTrades.filter(t => {
      const outcome = String(t.result?.outcome || "").toUpperCase();
      return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
    }).length;

    const sWinRate = count > 0 ? Number((wins / count).toFixed(4)) : 0.0;
    const sProfit = Number(sTrades.reduce((sum, t) => sum + Number(t.result?.netProfit || 0), 0).toFixed(2));
    const sConfs = sTrades.map(t => Number(t.signalInfo?.confidence || t.decisionEngine?.finalScore || 0));
    const avgConfidence = sConfs.length > 0 ? Number((sConfs.reduce((sum, v) => sum + v, 0) / sConfs.length).toFixed(2)) : 0.0;

    const sHalf = Math.floor(count / 2);
    const sTrend = calcTrend(sTrades.slice(0, sHalf), sTrades.slice(sHalf));

    sessionPerformance[s] = {
      tradeCount: count,
      winRate: sWinRate,
      profit: sProfit,
      averageConfidence: avgConfidence,
      confidence: calcConfidenceLevel(count),
      trend: sTrend,
      minSampleThreshold: 5
    };
  });

  // ==========================================
  // 3. Decision Engine Aggregation
  // ==========================================
  const grades = ["GRADE A", "GRADE B", "GRADE C", "REJECT"];
  const decisionEnginePerformance = {};
  grades.forEach(g => {
    const gTrades = dataset.filter(d => {
      return String(d.raw.decisionEngine?.grade || "").toUpperCase() === g;
    }).map(d => d.raw);

    const count = gTrades.length;
    const wins = gTrades.filter(t => {
      const outcome = String(t.result?.outcome || "").toUpperCase();
      return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
    }).length;

    const gWinRate = count > 0 ? Number((wins / count).toFixed(4)) : 0.0;
    const gProfit = Number(gTrades.reduce((sum, t) => sum + Number(t.result?.netProfit || 0), 0).toFixed(2));
    
    const gHalf = Math.floor(count / 2);
    const gTrend = calcTrend(gTrades.slice(0, gHalf), gTrades.slice(gHalf));

    decisionEnginePerformance[g] = {
      tradeCount: count,
      winRate: gWinRate,
      profit: gProfit,
      confidence: calcConfidenceLevel(count),
      trend: gTrend,
      minSampleThreshold: 5
    };
  });

  // ==========================================
  // 4. Market Intelligence Aggregation
  // ==========================================
  const getSubsystemStats = (keyExtractor) => {
    const scores = dataset.map(d => keyExtractor(d)).filter(v => v !== null && v !== undefined);
    const count = scores.length;
    const averageScore = count > 0 ? Number((scores.reduce((sum, v) => sum + v, 0) / count).toFixed(2)) : 0.0;
    
    // Group into ranges: High (>=80), Mid (50-79), Low (<50)
    const groupStats = (min, max) => {
      const groupTrades = dataset.filter(d => {
        const score = keyExtractor(d);
        return score !== null && score !== undefined && score >= min && score <= max;
      }).map(d => d.raw);
      const groupCount = groupTrades.length;
      const groupWins = groupTrades.filter(t => {
        const outcome = String(t.result?.outcome || "").toUpperCase();
        return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
      }).length;
      return {
        tradeCount: groupCount,
        winRate: groupCount > 0 ? Number((groupWins / groupCount).toFixed(4)) : 0.0,
        profit: Number(groupTrades.reduce((sum, t) => sum + Number(t.result?.netProfit || 0), 0).toFixed(2))
      };
    };

    return {
      averageScore,
      ranges: {
        high: groupStats(80, 100),
        medium: groupStats(50, 79),
        low: groupStats(0, 49)
      }
    };
  };

  const marketIntelligencePerformance = {
    trend: getSubsystemStats(d => d.raw.marketContext?.trend?.score || d.raw.marketContext?.subsystemScores?.trend),
    structure: getSubsystemStats(d => d.raw.marketContext?.structure?.score || d.raw.marketContext?.subsystemScores?.structure),
    spread: getSubsystemStats(d => d.raw.marketContext?.spread?.score || d.raw.marketContext?.subsystemScores?.spread),
    volatility: getSubsystemStats(d => d.raw.marketContext?.volatility?.score || d.raw.marketContext?.subsystemScores?.volatility),
    session: getSubsystemStats(d => d.raw.marketContext?.session?.score || d.raw.marketContext?.subsystemScores?.session),
    overall: getSubsystemStats(d => d.raw.marketContext?.overallScore)
  };

  // ==========================================
  // 5. Smart Entry Aggregation
  // ==========================================
  const strategies = ["MARKET", "LIMIT", "STOP", "WAIT"];
  const smartEntryPerformance = {};
  strategies.forEach(strat => {
    const sTrades = dataset.filter(d => {
      return String(d.raw.smartEntry?.recommendedStrategy || "").toUpperCase() === strat;
    }).map(d => d.raw);

    const count = sTrades.length;
    const wins = sTrades.filter(t => {
      const outcome = String(t.result?.outcome || "").toUpperCase();
      return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
    }).length;

    const sWinRate = count > 0 ? Number((wins / count).toFixed(4)) : 0.0;
    const sProfit = Number(sTrades.reduce((sum, t) => sum + Number(t.result?.netProfit || 0), 0).toFixed(2));
    
    const sRrs = sTrades.map(t => Number(t.result?.rMultiple || t.result?.rrAchieved || 0));
    const avgRR = sRrs.length > 0 ? Number((sRrs.reduce((sum, v) => sum + v, 0) / sRrs.length).toFixed(4)) : 0.0;

    const sDurations = sTrades.map(t => Number(t.result?.durationMs || 0) / 1000.0);
    const avgHoldingTime = sDurations.length > 0 ? Number((sDurations.reduce((sum, v) => sum + v, 0) / sDurations.length).toFixed(4)) : 0.0;

    const sHalf = Math.floor(count / 2);
    const sTrend = calcTrend(sTrades.slice(0, sHalf), sTrades.slice(sHalf));

    smartEntryPerformance[strat] = {
      tradeCount: count,
      winRate: sWinRate,
      averageRR: avgRR,
      profit: sProfit,
      averageHoldingTime: avgHoldingTime,
      confidence: calcConfidenceLevel(count),
      trend: sTrend,
      minSampleThreshold: 5
    };
  });

  // ==========================================
  // 6. Lifecycle Aggregation
  // ==========================================
  const checkLifecycleFeature = (timelineChecker, outcomeChecker) => {
    const matchingTrades = dataset.filter(d => {
      const matchTimeline = timelineChecker ? timelineChecker(d.raw.lifecycleTimeline || []) : true;
      const matchOutcome = outcomeChecker ? outcomeChecker(String(d.raw.result?.outcome || "").toUpperCase()) : true;
      return matchTimeline && matchOutcome;
    }).map(d => d.raw);

    const count = matchingTrades.length;
    const wins = matchingTrades.filter(t => {
      const outcome = String(t.result?.outcome || "").toUpperCase();
      return outcome === "FULL_TP" || outcome === "PARTIAL_TP" || (t.result?.netProfit > 0);
    }).length;

    return {
      tradeCount: count,
      winRate: count > 0 ? Number((wins / count).toFixed(4)) : 0.0,
      profit: Number(matchingTrades.reduce((sum, t) => sum + Number(t.result?.netProfit || 0), 0).toFixed(2))
    };
  };

  const lifecyclePerformance = {
    breakEven: checkLifecycleFeature(
      (tl) => tl.some(e => String(e.event).toUpperCase().includes("BREAK_EVEN") || String(e.event).toUpperCase().includes("BREAKEVEN") || String(e.event).toUpperCase().includes("BREAK EVEN")),
      null
    ),
    trailingStop: checkLifecycleFeature(
      (tl) => tl.some(e => String(e.event).toUpperCase().includes("TRAILING") || String(e.event).toUpperCase().includes("TRAIL")),
      null
    ),
    partialTP: checkLifecycleFeature(
      (tl) => tl.some(e => String(e.event).toUpperCase().includes("PARTIAL_TP") || String(e.event).toUpperCase().includes("PARTIAL TP")),
      null
    ),
    timeExit: checkLifecycleFeature(
      null,
      (outcome) => outcome === "TIME_EXIT"
    ),
    marketExit: checkLifecycleFeature(
      null,
      (outcome) => outcome === "MARKET_EXIT"
    )
  };

  // ==========================================
  // 7. Dashboard Metrics & Explanations (API Ready)
  // ==========================================
  
  // Helper to find best/worst rank
  const findMetricRank = (perfObject, ratingExtractor, findMax = true) => {
    let targetKey = "N/A";
    let targetVal = findMax ? -Infinity : Infinity;
    Object.keys(perfObject).forEach(key => {
      const val = ratingExtractor(perfObject[key]);
      if (perfObject[key].tradeCount > 0) {
        if (findMax && val > targetVal) {
          targetVal = val;
          targetKey = key;
        } else if (!findMax && val < targetVal) {
          targetVal = val;
          targetKey = key;
        }
      }
    });
    return targetKey;
  };

  const topPerformingChannel = findMetricRank(channelPerformance, (p) => p.averageProfit);
  const worstChannel = findMetricRank(channelPerformance, (p) => p.averageProfit, false);
  const bestSession = findMetricRank(sessionPerformance, (p) => p.profit);
  const worstSession = findMetricRank(sessionPerformance, (p) => p.profit, false);
  const bestEntryType = findMetricRank(smartEntryPerformance, (p) => p.winRate);
  const bestRR = findMetricRank(smartEntryPerformance, (p) => p.averageRR);
  const mostReliableGrade = findMetricRank(decisionEnginePerformance, (p) => p.winRate);
  const mostProfitableStrategy = findMetricRank(smartEntryPerformance, (p) => p.profit);

  // Generate explainability descriptors
  const generateExplanation = (category, winnerKey, perfObject, metricName) => {
    if (winnerKey === "N/A" || !perfObject[winnerKey]) {
      return "Insufficient sample data to generate rank explanation.";
    }
    const item = perfObject[winnerKey];
    return `Ranked best in ${category} as ${winnerKey} due to highest ${metricName} of ${metricName === "win rate" ? (item.winRate * 100).toFixed(1) + "%" : item.averageRR || item.profit} across a sample size of ${item.tradeCount} trades (Confidence: ${item.confidence}).`;
  };

  const explanations = {
    topPerformingChannel: generateExplanation("channel profit", topPerformingChannel, channelPerformance, "profit"),
    bestSession: generateExplanation("session performance", bestSession, sessionPerformance, "profit"),
    bestEntryType: generateExplanation("entry strategy win rate", bestEntryType, smartEntryPerformance, "win rate"),
    mostProfitableStrategy: generateExplanation("entry strategy profit", mostProfitableStrategy, smartEntryPerformance, "profit")
  };

  const dashboardMetrics = {
    topPerformingChannel,
    worstChannel,
    bestSession,
    worstSession,
    bestEntryType,
    bestRR,
    mostReliableGrade,
    mostProfitableStrategy,
    explanations
  };

  return phoenixDeepFreeze({
    overall: {
      totalTrades,
      winRate,
      lossRate,
      netProfit,
      averageRR,
      averageTradeDuration,
      profitFactor,
      expectancy,
      maxDrawdown,
      trend: systemTrend,
      profitDistribution
    },
    channels: channelPerformance,
    sessions: sessionPerformance,
    decisionEngine: decisionEnginePerformance,
    marketIntelligence: marketIntelligencePerformance,
    smartEntry: smartEntryPerformance,
    lifecycle: lifecyclePerformance,
    dashboard: dashboardMetrics
  });
}

function createEmptyReport() {
  const emptySubsystem = {
    averageScore: 0.0,
    ranges: {
      high: { tradeCount: 0, winRate: 0.0, profit: 0.0 },
      medium: { tradeCount: 0, winRate: 0.0, profit: 0.0 },
      low: { tradeCount: 0, winRate: 0.0, profit: 0.0 }
    }
  };

  return phoenixDeepFreeze({
    overall: {
      totalTrades: 0,
      winRate: 0.0,
      lossRate: 0.0,
      netProfit: 0.0,
      averageRR: 0.0,
      averageTradeDuration: 0.0,
      profitFactor: 0.0,
      expectancy: 0.0,
      maxDrawdown: 0.0,
      trend: "Stable",
      profitDistribution: {
        median: 0.0,
        min: 0.0,
        max: 0.0,
        stdDev: 0.0,
        p25: 0.0,
        p50: 0.0,
        p75: 0.0
      }
    },
    channels: {},
    sessions: {
      London: { tradeCount: 0, winRate: 0.0, profit: 0.0, averageConfidence: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      "New York": { tradeCount: 0, winRate: 0.0, profit: 0.0, averageConfidence: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      "London/NY Overlap": { tradeCount: 0, winRate: 0.0, profit: 0.0, averageConfidence: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      Asian: { tradeCount: 0, winRate: 0.0, profit: 0.0, averageConfidence: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      Holiday: { tradeCount: 0, winRate: 0.0, profit: 0.0, averageConfidence: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 }
    },
    decisionEngine: {
      "GRADE A": { tradeCount: 0, winRate: 0.0, profit: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      "GRADE B": { tradeCount: 0, winRate: 0.0, profit: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      "GRADE C": { tradeCount: 0, winRate: 0.0, profit: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      "REJECT": { tradeCount: 0, winRate: 0.0, profit: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 }
    },
    marketIntelligence: {
      trend: emptySubsystem,
      structure: emptySubsystem,
      spread: emptySubsystem,
      volatility: emptySubsystem,
      session: emptySubsystem,
      overall: emptySubsystem
    },
    smartEntry: {
      MARKET: { tradeCount: 0, winRate: 0.0, averageRR: 0.0, profit: 0.0, averageHoldingTime: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      LIMIT: { tradeCount: 0, winRate: 0.0, averageRR: 0.0, profit: 0.0, averageHoldingTime: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      STOP: { tradeCount: 0, winRate: 0.0, averageRR: 0.0, profit: 0.0, averageHoldingTime: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 },
      WAIT: { tradeCount: 0, winRate: 0.0, averageRR: 0.0, profit: 0.0, averageHoldingTime: 0.0, confidence: "LOW", trend: "Stable", minSampleThreshold: 5 }
    },
    lifecycle: {
      breakEven: { tradeCount: 0, winRate: 0.0, profit: 0.0 },
      trailingStop: { tradeCount: 0, winRate: 0.0, profit: 0.0 },
      partialTP: { tradeCount: 0, winRate: 0.0, profit: 0.0 },
      timeExit: { tradeCount: 0, winRate: 0.0, profit: 0.0 },
      marketExit: { tradeCount: 0, winRate: 0.0, profit: 0.0 }
    },
    dashboard: {
      topPerformingChannel: "N/A",
      worstChannel: "N/A",
      bestSession: "N/A",
      worstSession: "N/A",
      bestEntryType: "N/A",
      bestRR: "N/A",
      mostReliableGrade: "N/A",
      mostProfitableStrategy: "N/A",
      explanations: {
        topPerformingChannel: "Insufficient sample data to generate rank explanation.",
        bestSession: "Insufficient sample data to generate rank explanation.",
        bestEntryType: "Insufficient sample data to generate rank explanation.",
        mostProfitableStrategy: "Insufficient sample data to generate rank explanation."
      }
    }
  });
}
