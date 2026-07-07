import { localAiRecommendationOutcomes } from "./signalOutcomeStore.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { config } from "../config/env.js";
import { getSettings } from "./automationSettingsService.js";
import mongoose from "mongoose";

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

// Helper to check calendar date match
function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

export async function canOpenTrade(pair, nowOverride = new Date(), currentRecId = null) {
  const settings = await getSettings();
  const limits = {
    maxOpenTrades: settings.maximumOpenTrades,
    maxDailyTrades: config.paperRisk?.maxDailyTrades || 10,
    maxConsecutiveLosses: config.paperRisk?.maxConsecutiveLosses || 3,
    dailyLossLimitR: config.paperRisk?.dailyLossLimitR || 3,
    dailyProfitTargetR: config.paperRisk?.dailyProfitTargetR || 6,
    slCooldownMinutes: config.paperRisk?.slCooldownMinutes || 30
  };

  // 1. Fetch latest recommendations (account-level)
  let outcomes = [];
  if (isMongoConnected()) {
    outcomes = await AiRecommendationOutcome.find({}).lean();
  } else {
    outcomes = Array.from(localAiRecommendationOutcomes.values());
  }

  // 2. Rule: Maximum Open Trades (Atomic Duplicate Execution)
  const requiredSlots = settings.duplicateTradesPerRecommendation || 1;
  const maxOpen = settings.maximumOpenTrades;

  const baseId = currentRecId ? currentRecId.split("_DUP_")[0] : "";
  const currentlyOpenTrades = outcomes.filter(o => {
    if (o.simulatedEntryPrice === null || !["ACTIVE", "PARTIAL_TP"].includes(o.status)) {
      return false;
    }
    if (baseId && o.recommendationId.startsWith(baseId)) {
      return false;
    }
    return true;
  }).length;

  const availableSlots = maxOpen - currentlyOpenTrades;

  if (requiredSlots > availableSlots) {
    return { allowed: false, reason: "MAX_OPEN_TRADES" };
  }

  const now = nowOverride;

  // 3. Rule: Maximum Trades Per Day
  // Total trades that became active/simulated today
  const todayTrades = outcomes.filter(o => o.simulatedEntryTime && isSameDay(new Date(o.simulatedEntryTime), now));
  if (todayTrades.length >= limits.maxDailyTrades) {
    return { allowed: false, reason: "DAILY_LIMIT_REACHED" };
  }

  // 4. Rule: Daily Loss Limit (3R) & Daily Profit Target (6R)
  const closedTodayTrades = todayTrades.filter(o => o.outcomeTime && ["FULL_TP", "PARTIAL_TP", "SL", "BREAK_EVEN"].includes(o.status));
  let dailyAccumulatedR = 0;
  closedTodayTrades.forEach(o => {
    if (o.riskRMultiple !== undefined && o.riskRMultiple !== null) {
      dailyAccumulatedR += o.riskRMultiple;
    } else {
      const entry = o.simulatedEntryPrice;
      const exit = o.outcomePrice;
      const sl = o.simulatedSL !== null ? o.simulatedSL : o.sl;
      const plannedRiskR = o.plannedRiskR || 1;
      if (entry && exit && sl && entry !== sl) {
        const riskPoints = Math.abs(entry - sl);
        if (riskPoints > 0) {
          let r = 0;
          if (o.status === "BREAK_EVEN" || o.exitType === "BREAK_EVEN" || o.closedAtBreakEven === true) {
            r = 0;
          } else if (o.direction === "BUY") {
            r = ((exit - entry) / riskPoints) * plannedRiskR;
          } else if (o.direction === "SELL") {
            r = ((entry - exit) / riskPoints) * plannedRiskR;
          }
          dailyAccumulatedR += r;
        }
      }
    }
  });

  if (dailyAccumulatedR <= -limits.dailyLossLimitR) {
    return { allowed: false, reason: "DAILY_LIMIT_REACHED" };
  }

  if (dailyAccumulatedR >= limits.dailyProfitTargetR) {
    return { allowed: false, reason: "DAILY_TARGET_REACHED" };
  }

  // 5. Rule: Maximum Consecutive Losses (3)
  const closedTradesSorted = outcomes
    .filter(o => o.outcomeTime && ["FULL_TP", "PARTIAL_TP", "SL", "BREAK_EVEN"].includes(o.status))
    .sort((a, b) => new Date(b.outcomeTime).getTime() - new Date(a.outcomeTime).getTime());

  if (closedTradesSorted.length >= limits.maxConsecutiveLosses) {
    const lastN = closedTradesSorted.slice(0, limits.maxConsecutiveLosses);
    const allLosses = lastN.every(o => o.status === "SL");
    if (allLosses) {
      return { allowed: false, reason: "MAX_CONSECUTIVE_LOSSES" };
    }
  }

  // 6. Rule: Cooldown After SL (30 minutes)
  if (closedTradesSorted.length > 0) {
    const lastClosed = closedTradesSorted[0];
    if (lastClosed.status === "SL") {
      const msSinceClosed = now.getTime() - new Date(lastClosed.outcomeTime).getTime();
      const cooldownMs = limits.slCooldownMinutes * 60 * 1000;
      if (msSinceClosed < cooldownMs) {
        return { allowed: false, reason: "COOLDOWN_ACTIVE" };
      }
    }
  }

  return { allowed: true, reason: null };
}

export function formatBlockReason(reason) {
  switch (reason) {
    case "MAX_OPEN_TRADES":
      return "Maximum Open Trades";
    case "DAILY_LIMIT_REACHED":
      return "Daily Limit Reached";
    case "DAILY_TARGET_REACHED":
      return "Daily Target Reached";
    case "COOLDOWN_ACTIVE":
      return "Cooldown Active";
    case "MAX_CONSECUTIVE_LOSSES":
      return "Maximum Consecutive Losses";
    default:
      return "Unknown Reason";
  }
}
