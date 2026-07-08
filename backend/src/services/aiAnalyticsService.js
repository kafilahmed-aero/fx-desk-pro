import mongoose from "mongoose";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { localAiRecommendationOutcomes } from "./signalOutcomeStore.js";
import { logger } from "../utils/logger.js";
import { formatBlockReason } from "./paperRiskManager.js";
import { getDashboardAndAnalytics } from "./recommendationAnalyticsService.js";


function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export async function getAiAnalytics() {
  let outcomes = [];
  if (isMongoConnected()) {
    try {
      outcomes = await AiRecommendationOutcome.find({}).lean();
    } catch (err) {
      logger.error("ai_analytics.db_query_failed", { error: err.message });
      outcomes = Array.from(localAiRecommendationOutcomes.values());
    }
  } else {
    outcomes = Array.from(localAiRecommendationOutcomes.values());
  }

  const totalRecommendations = outcomes.length;

  if (totalRecommendations === 0) {
    return {
      totalRecommendations: 0,
      activeTrades: 0,
      fullTp: 0,
      partialTp: 0,
      breakEven: 0,
      sl: 0,
      winRate: null,
      averageRiskReward: null,
      winningStreak: 0,
      losingStreak: 0,
      maxDrawdown: null,
      averageHoldingTime: null,
      averageConfidence: null,
      tradeQualityDistribution: {
        Excellent: { count: 0, percentage: null },
        Good: { count: 0, percentage: null },
        Average: { count: 0, percentage: null },
        Poor: { count: 0, percentage: null }
      },
      recsToday: 0,
      closedToday: 0,
      currentlyOpen: 0,
      avgTimeToTP1: null,
      avgTimeToFullTP: null,
      avgTimeToSL: null,
      lastRecommendationTime: null,
      automationReady: "NO",
      ...(await getDashboardAndAnalytics())
    };
  }

  // Active trades: PENDING, ACTIVE, PARTIAL_TP (which are not resolved/closed yet)
  // Wait, let's filter open vs resolved:
  // Resolved means: FULL_TP, SL, or closed at breakeven
  const isTradeResolved = (o) => ["FULL_TP", "SL"].includes(o.status) || o.exitType === "BREAK_EVEN" || o.closedAtBreakEven === true;

  const activeTrades = outcomes.filter(o => !isTradeResolved(o)).length;

  const fullTp = outcomes.filter(o => o.status === "FULL_TP").length;
  const partialTp = outcomes.filter(o => o.status === "PARTIAL_TP").length;
  const breakEven = outcomes.filter(o => o.exitType === "BREAK_EVEN" || o.closedAtBreakEven === true).length;
  const sl = outcomes.filter(o => o.status === "SL").length;

  // Win rate: (FULL_TP + PARTIAL_TP) / (FULL_TP + PARTIAL_TP + SL) * 100 (break-even exits must NOT reduce win rate)
  const wins = fullTp + partialTp;
  const winDenominator = wins + sl;
  const winRate = winDenominator > 0
    ? Number(((wins / winDenominator) * 100).toFixed(1))
    : null;

  // Average Risk:Reward
  const validRRs = outcomes
    .filter(o => o.riskReward && o.riskReward.lowRisk !== null && typeof o.riskReward.lowRisk === "number")
    .map(o => o.riskReward.lowRisk);
  const averageRiskReward = validRRs.length > 0
    ? Number((validRRs.reduce((s, v) => s + v, 0) / validRRs.length).toFixed(2))
    : null;

  // Streaks and drawdown on chronologically sorted resolved trades
  const resolved = outcomes
    .filter(isTradeResolved)
    .sort((a, b) => new Date(a.generatedTime || a.createdAt).getTime() - new Date(b.generatedTime || b.createdAt).getTime());

  let winningStreak = 0;
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (resolved[i].status === "FULL_TP" || resolved[i].status === "PARTIAL_TP") {
      winningStreak++;
    } else if (resolved[i].status === "SL" || resolved[i].exitType === "BREAK_EVEN" || resolved[i].closedAtBreakEven === true) {
      break;
    }
  }

  let losingStreak = 0;
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (resolved[i].status === "SL") {
      losingStreak++;
    } else if (resolved[i].status === "FULL_TP" || resolved[i].status === "PARTIAL_TP" || resolved[i].exitType === "BREAK_EVEN" || resolved[i].closedAtBreakEven === true) {
      break;
    }
  }

  // Drawdown calculation
  let maxDrawdown = null;
  if (resolved.length > 0) {
    let balance = 100;
    const balanceCurve = [balance];
    for (const trade of resolved) {
      if (trade.status === "FULL_TP" || trade.status === "PARTIAL_TP") {
        const reward = (trade.riskReward && typeof trade.riskReward.lowRisk === "number") ? trade.riskReward.lowRisk : 1.0;
        balance += reward;
      } else if (trade.status === "SL") {
        balance -= 1.0;
      }
      balanceCurve.push(balance);
    }

    let maxPeak = -Infinity;
    let maxDD = 0;
    for (const val of balanceCurve) {
      if (val > maxPeak) {
        maxPeak = val;
      }
      const dd = maxPeak - val;
      if (dd > maxDD) {
        maxDD = dd;
      }
    }
    maxDrawdown = Number(maxDD.toFixed(2));
  }

  // Average Holding Time (actual duration of completed trades)
  const holdingTimes = resolved
    .map(o => {
      if (!o.generatedTime || !o.updatedAt) return null;
      const durationMs = new Date(o.updatedAt).getTime() - new Date(o.generatedTime).getTime();
      return durationMs > 0 ? durationMs / 60000 : null; // in minutes
    })
    .filter(v => v !== null);

  const averageHoldingTime = holdingTimes.length > 0
    ? formatMinutesToHoldingTime(holdingTimes.reduce((sum, val) => sum + val, 0) / holdingTimes.length)
    : null;

  // Average Confidence
  const confidences = outcomes
    .map(o => o.confidence)
    .filter(c => c !== null && c !== undefined && !Number.isNaN(Number(c)));
  const averageConfidence = confidences.length > 0
    ? Number((confidences.reduce((s, v) => s + Number(v), 0) / confidences.length).toFixed(1))
    : null;

  // Trade Quality counts AND percentages
  const totalWithQuality = outcomes.filter(o => ["Excellent", "Good", "Average", "Poor"].includes(o.tradeQuality)).length;
  const getQualityStats = (quality) => {
    const count = outcomes.filter(o => o.tradeQuality === quality).length;
    const percentage = totalWithQuality > 0 ? Number(((count / totalWithQuality) * 100).toFixed(1)) : null;
    return { count, percentage };
  };

  const tradeQualityDistribution = {
    Excellent: getQualityStats("Excellent"),
    Good: getQualityStats("Good"),
    Average: getQualityStats("Average"),
    Poor: getQualityStats("Poor")
  };

  // Daily metrics: Today starts at 00:00 local time
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const recsToday = outcomes.filter(o => new Date(o.generatedTime || o.createdAt) >= startOfToday).length;

  const closedToday = outcomes.filter(o => {
    if (!isTradeResolved(o)) return false;
    const closedDate = new Date(o.updatedAt || o.lastCheckedAt || o.createdAt);
    return closedDate >= startOfToday;
  }).length;

  // AI Trades Currently Open (status: ACTIVE or PARTIAL_TP and not resolved/closed)
  const currentlyOpen = outcomes.filter(o => ["ACTIVE", "PARTIAL_TP"].includes(o.status) && !isTradeResolved(o)).length;

  // Average target hit durations
  const tp1Trades = outcomes.filter(o => (o.status === "FULL_TP" || o.status === "PARTIAL_TP" || (o.hitTargets && o.hitTargets.includes(1))) && o.updatedAt && o.generatedTime);
  const avgTimeToTP1 = tp1Trades.length > 0
    ? Number((tp1Trades.reduce((sum, o) => sum + (new Date(o.updatedAt) - new Date(o.generatedTime)) / 60000, 0) / tp1Trades.length).toFixed(1))
    : null;

  const fullTpTrades = outcomes.filter(o => o.status === "FULL_TP" && o.updatedAt && o.generatedTime);
  const avgTimeToFullTP = fullTpTrades.length > 0
    ? Number((fullTpTrades.reduce((sum, o) => sum + (new Date(o.updatedAt) - new Date(o.generatedTime)) / 60000, 0) / fullTpTrades.length).toFixed(1))
    : null;

  const slTrades = outcomes.filter(o => o.status === "SL" && o.updatedAt && o.generatedTime);
  const avgTimeToSL = slTrades.length > 0
    ? Number((slTrades.reduce((sum, o) => sum + (new Date(o.updatedAt) - new Date(o.generatedTime)) / 60000, 0) / slTrades.length).toFixed(1))
    : null;

  // Last Recommendation Age Time
  const sortedByTime = [...outcomes].sort((a, b) => new Date(b.generatedTime || b.createdAt).getTime() - new Date(a.generatedTime || a.createdAt).getTime());
  const lastRecommendationTime = sortedByTime[0] ? (sortedByTime[0].generatedTime || sortedByTime[0].createdAt) : null;

  // ==================================================
  // Paper Trading Simulation Metrics (Phase 5.4.1)
  // ==================================================
  const enteredTrades = outcomes.filter(o => o.simulatedEntryPrice !== null && o.simulatedEntryPrice !== undefined);

  const simulationTrades = enteredTrades.length;
  const simulationWins = enteredTrades.filter(o => o.status === "FULL_TP" || o.status === "PARTIAL_TP").length;
  const simulationLosses = enteredTrades.filter(o => o.status === "SL").length;
  const simulationBreakEven = enteredTrades.filter(o => o.status === "BREAK_EVEN" || o.exitType === "BREAK_EVEN" || o.closedAtBreakEven === true).length;

  const simWinRateDenom = simulationWins + simulationLosses;
  const simulationWinRate = simWinRateDenom > 0
    ? Number(((simulationWins / simWinRateDenom) * 100).toFixed(1))
    : null;

  // Profit Factor
  let grossProfit = 0;
  let grossLoss = 0;
  enteredTrades.forEach(o => {
    if (!o.simulatedEntryPrice || !o.outcomePrice) return;
    const entry = o.simulatedEntryPrice;
    const exit = o.outcomePrice;
    const isWin = o.status === "FULL_TP" || o.status === "PARTIAL_TP";
    const isLoss = o.status === "SL";
    
    if (o.direction === "BUY") {
      if (isWin) grossProfit += Math.max(0, exit - entry);
      else if (isLoss) grossLoss += Math.max(0, entry - exit);
    } else if (o.direction === "SELL") {
      if (isWin) grossProfit += Math.max(0, entry - exit);
      else if (isLoss) grossLoss += Math.max(0, exit - entry);
    }
  });
  const simulationProfitFactor = grossLoss > 0
    ? Number((grossProfit / grossLoss).toFixed(2))
    : (grossProfit > 0 ? null : null);

  // Average Holding Time
  const simHoldingTimes = enteredTrades
    .filter(o => o.simulatedEntryTime && o.outcomeTime)
    .map(o => {
      const diffMin = (new Date(o.outcomeTime).getTime() - new Date(o.simulatedEntryTime).getTime()) / 60000;
      return diffMin > 0 ? diffMin : null;
    })
    .filter(v => v !== null);
  const simulationAverageHoldingTime = simHoldingTimes.length > 0
    ? formatMinutesToHoldingTime(simHoldingTimes.reduce((s, v) => s + v, 0) / simHoldingTimes.length)
    : null;

  const simulationCurrentOpenTrades = enteredTrades.filter(o => ["ACTIVE", "PARTIAL_TP"].includes(o.status)).length;

  // Equity Curve & Max Drawdown
  const resolvedSim = enteredTrades
    .filter(o => o.outcomeTime && (["FULL_TP", "PARTIAL_TP", "SL", "BREAK_EVEN"].includes(o.status) || o.exitType === "BREAK_EVEN" || o.closedAtBreakEven === true))
    .sort((a, b) => new Date(a.outcomeTime).getTime() - new Date(b.outcomeTime).getTime());

  let currentSimBalance = 10000;
  const simEquityCurve = [currentSimBalance];
  
  resolvedSim.forEach(o => {
    const entry = o.simulatedEntryPrice;
    const exit = o.outcomePrice;
    if (entry && exit) {
      let pnl = 0;
      if (o.status === "BREAK_EVEN" || o.exitType === "BREAK_EVEN" || o.closedAtBreakEven === true) {
        pnl = 0;
      } else if (o.direction === "BUY") {
        pnl = exit - entry;
      } else if (o.direction === "SELL") {
        pnl = entry - exit;
      }
      currentSimBalance += pnl;
    }
    simEquityCurve.push(currentSimBalance);
  });

  let maxPeak = -Infinity;
  let maxDD = 0;
  for (const val of simEquityCurve) {
    if (val > maxPeak) {
      maxPeak = val;
    }
    const dd = maxPeak - val;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }
  const simulationMaxDrawdown = simEquityCurve.length > 1 ? Number(maxDD.toFixed(2)) : null;

  // ==================================================
  // Paper Trading Risk Manager (Phase 5.4.2)
  // ==================================================
  const blockedTrades = outcomes.filter(o => o.executionStatus === "BLOCKED").length;

  const blockedReasonDistribution = {
    "Maximum Open Trades": 0,
    "Daily Limit Reached": 0,
    "Daily Target Reached": 0,
    "Cooldown Active": 0,
    "Maximum Consecutive Losses": 0
  };
  outcomes.forEach(o => {
    if (o.executionStatus === "BLOCKED" && o.blockReason) {
      const reasonStr = formatBlockReason(o.blockReason);
      blockedReasonDistribution[reasonStr] = (blockedReasonDistribution[reasonStr] || 0) + 1;
    }
  });

  // avgDailyTrades
  const dailyTradesMap = new Map();
  enteredTrades.forEach(o => {
    if (o.simulatedEntryTime) {
      const dateStr = new Date(o.simulatedEntryTime).toISOString().slice(0, 10);
      dailyTradesMap.set(dateStr, (dailyTradesMap.get(dateStr) || 0) + 1);
    }
  });
  const avgDailyTrades = dailyTradesMap.size > 0
    ? Number((enteredTrades.length / dailyTradesMap.size).toFixed(1))
    : 0;

  // avgOpenTrades
  const daysRange = new Set();
  enteredTrades.forEach(o => {
    if (o.simulatedEntryTime) {
      const startDStr = new Date(o.simulatedEntryTime).toISOString().slice(0, 10);
      const endDStr = (o.outcomeTime ? new Date(o.outcomeTime) : new Date()).toISOString().slice(0, 10);
      
      let curr = new Date(startDStr + "T00:00:00.000Z");
      const end = new Date(endDStr + "T00:00:00.000Z");
      while (curr <= end) {
        daysRange.add(curr.toISOString().slice(0, 10));
        curr.setUTCDate(curr.getUTCDate() + 1);
      }
    }
  });

  let totalDailyOpenCount = 0;
  daysRange.forEach(dateStr => {
    const dayStart = new Date(dateStr + "T00:00:00.000Z").getTime();
    const dayEnd = new Date(dateStr + "T23:59:59.999Z").getTime();
    
    const overlapping = enteredTrades.filter(o => {
      if (!o.simulatedEntryTime) return false;
      const tStart = new Date(o.simulatedEntryTime).getTime();
      const tEnd = o.outcomeTime ? new Date(o.outcomeTime).getTime() : Date.now();
      return tStart <= dayEnd && tEnd >= dayStart;
    });
    totalDailyOpenCount += overlapping.length;
  });

  const avgOpenTrades = daysRange.size > 0
    ? Number((totalDailyOpenCount / daysRange.size).toFixed(1))
    : 0;

  // avgDailyRiskUsed
  const dailyRiskMap = new Map();
  enteredTrades.forEach(o => {
    if (o.simulatedEntryTime && o.simulatedEntryPrice) {
      const dateStr = new Date(o.simulatedEntryTime).toISOString().slice(0, 10);
      const sl = (o.simulatedSL !== null && o.simulatedSL !== undefined) ? o.simulatedSL : o.sl;
      if (sl !== null && sl !== undefined) {
        const riskPoints = Math.abs(o.simulatedEntryPrice - sl);
        dailyRiskMap.set(dateStr, (dailyRiskMap.get(dateStr) || 0) + riskPoints);
      }
    }
  });

  let totalRiskAcrossDays = 0;
  dailyRiskMap.forEach(val => {
    totalRiskAcrossDays += val;
  });

  const avgDailyRiskUsed = dailyRiskMap.size > 0
    ? Number((totalRiskAcrossDays / dailyRiskMap.size).toFixed(2))
    : 0;

  return {
    totalRecommendations,
    activeTrades,
    fullTp,
    partialTp,
    breakEven,
    sl,
    winRate,
    averageRiskReward,
    winningStreak,
    losingStreak,
    maxDrawdown,
    averageHoldingTime,
    averageConfidence,
    tradeQualityDistribution,
    recsToday,
    closedToday,
    currentlyOpen,
    avgTimeToTP1,
    avgTimeToFullTP,
    avgTimeToSL,
    lastRecommendationTime,
    automationReady: "NO",
    // Simulation engine keys
    simulationTrades,
    simulationWins,
    simulationLosses,
    simulationBreakEven,
    simulationWinRate,
    simulationProfitFactor,
    simulationAverageHoldingTime,
    simulationCurrentOpenTrades,
    simulationMaxDrawdown,
    simulationEquityCurve: simEquityCurve,
    // Risk Manager keys
    blockedTrades,
    blockedReasonDistribution,
    avgDailyTrades,
    avgOpenTrades,
    avgDailyRiskUsed,
    ...(await getDashboardAndAnalytics())
  };
}

function formatMinutesToHoldingTime(minutes) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  } else {
    const hrs = minutes / 60;
    return `${hrs.toFixed(1)} hr`;
  }
}
