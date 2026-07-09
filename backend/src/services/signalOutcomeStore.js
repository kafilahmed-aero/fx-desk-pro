import mongoose from "mongoose";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { DailyOutcomeSummary } from "../models/dailyOutcomeSummaryModel.js";
import { RawMessage } from "../models/rawMessageModel.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getSettingsSync } from "./automationSettingsService.js";
import { updateSnapshotOutcome } from "./recommendationAnalyticsService.js";


// Local in-memory fallback stores
const localOutcomes = new Map();
const localDailySummaries = new Map();
export const localAiRecommendationOutcomes = new Map();

/**
 * Adapter function to format an AI outcome document to match SignalOutcome schema interface.
 */
export function adaptAiToSignalOutcome(aiOutcome) {
  const settings = getSettingsSync();
  const automationEnabled = settings.automationEnabled || false;
  const tpMode = settings.tpMode || "LOW_RISK";
  const targets = [];
  const hitTargets = aiOutcome.hitTargets || [];

  if (automationEnabled) {
    if (tpMode === "LOW_RISK") {
      if (aiOutcome.lowRiskTp) {
        targets.push({
          targetNumber: 1,
          price: aiOutcome.lowRiskTp,
          isHit: hitTargets.includes(1) || aiOutcome.status === "FULL_TP" || aiOutcome.status === "PARTIAL_TP"
        });
      }
    } else if (tpMode === "MODERATE") {
      if (aiOutcome.moderateTp) {
        targets.push({
          targetNumber: 2,
          price: aiOutcome.moderateTp,
          isHit: hitTargets.includes(2) || aiOutcome.status === "FULL_TP"
        });
      }
    } else if (tpMode === "HIGH_RISK") {
      if (aiOutcome.highRiskTp) {
        targets.push({
          targetNumber: 3,
          price: aiOutcome.highRiskTp,
          isHit: hitTargets.includes(3) || aiOutcome.status === "FULL_TP"
        });
      }
    }
  } else {
    if (aiOutcome.lowRiskTp) {
      targets.push({
        targetNumber: 1,
        price: aiOutcome.lowRiskTp,
        isHit: hitTargets.includes(1) || aiOutcome.status === "FULL_TP" || aiOutcome.status === "PARTIAL_TP"
      });
    }
    if (aiOutcome.moderateTp) {
      targets.push({
        targetNumber: 2,
        price: aiOutcome.moderateTp,
        isHit: hitTargets.includes(2) || aiOutcome.status === "FULL_TP"
      });
    }
    if (aiOutcome.highRiskTp) {
      targets.push({
        targetNumber: 3,
        price: aiOutcome.highRiskTp,
        isHit: hitTargets.includes(3) || aiOutcome.status === "FULL_TP"
      });
    }
  }

  return {
    _id: aiOutcome._id,
    messageKey: `AI_REC:${aiOutcome.recommendationId}`,
    pair: aiOutcome.pair,
    action: aiOutcome.direction,
    entry: {
      entryType: "RANGE",
      entryLow: aiOutcome.entryMin,
      entryHigh: aiOutcome.entryMax,
      entryPrice: null
    },
    targets,
    stopLoss: aiOutcome.simulatedSL !== null && aiOutcome.simulatedSL !== undefined ? aiOutcome.simulatedSL : aiOutcome.sl,
    status: aiOutcome.status === "SL" ? "SL_HIT" : aiOutcome.status,
    hitTargets,
    maxTargetHit: hitTargets.length > 0 ? Math.max(...hitTargets) : 0,
    highestPriceSeen: aiOutcome.highestPriceSeen,
    lowestPriceSeen: aiOutcome.lowestPriceSeen,
    expiresAt: aiOutcome.expiresAt,
    lastCheckedAt: aiOutcome.lastCheckedAt,
    isAiOutcomeAdapter: true,
    rawAiOutcome: aiOutcome
  };
}

/**
 * Retrieves all active/pending AI outcomes for price monitor tracking.
 */
export async function getActiveAndPendingAiOutcomes() {
  const statuses = ["PENDING", "ACTIVE", "PARTIAL_TP"];
  if (isMongoConnected()) {
    return AiRecommendationOutcome.find({ status: { $in: statuses } }).lean();
  }
  const results = [];
  for (const outcome of localAiRecommendationOutcomes.values()) {
    if (statuses.includes(outcome.status)) {
      results.push(outcome);
    }
  }
  return results;
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export async function saveOutcome(outcomeData) {
  if (outcomeData.isAiOutcomeAdapter) {
    const aiOutcome = outcomeData.rawAiOutcome;
    aiOutcome.status = outcomeData.status === "SL_HIT" ? "SL" : outcomeData.status;
    aiOutcome.highestPriceSeen = outcomeData.highestPriceSeen;
    aiOutcome.lowestPriceSeen = outcomeData.lowestPriceSeen;
    aiOutcome.lastCheckedAt = outcomeData.lastCheckedAt;
    aiOutcome.hitTargets = outcomeData.hitTargets || [];

    if (isMongoConnected()) {
      try {
        const updated = await AiRecommendationOutcome.findByIdAndUpdate(
          aiOutcome._id,
          {
            $set: {
              status: aiOutcome.status,
              highestPriceSeen: aiOutcome.highestPriceSeen,
              lowestPriceSeen: aiOutcome.lowestPriceSeen,
              lastCheckedAt: aiOutcome.lastCheckedAt,
              hitTargets: aiOutcome.hitTargets,
              simulatedEntryPrice: aiOutcome.simulatedEntryPrice,
              simulatedEntryTime: aiOutcome.simulatedEntryTime,
              simulatedSL: aiOutcome.simulatedSL,
              outcomePrice: aiOutcome.outcomePrice,
              outcomeTime: aiOutcome.outcomeTime,
              exitType: aiOutcome.exitType,
              closedAtBreakEven: aiOutcome.closedAtBreakEven,
              simulationNotes: aiOutcome.simulationNotes,
              executionStatus: aiOutcome.executionStatus,
              blockedAt: aiOutcome.blockedAt,
              plannedRiskR: aiOutcome.plannedRiskR,
              blockReason: aiOutcome.blockReason,
              riskRMultiple: aiOutcome.riskRMultiple
            }
          },
          { new: true }
        ).lean();
        if (updated) {
          localAiRecommendationOutcomes.set(updated.recommendationId, updated);
        }
      } catch (err) {
        logger.error("outcome_store.save_ai_failed", { recommendationId: aiOutcome.recommendationId, error: err.message });
      }
    } else {
      const existing = localAiRecommendationOutcomes.get(aiOutcome.recommendationId) || {};
      const updated = {
        ...existing,
        status: aiOutcome.status,
        highestPriceSeen: aiOutcome.highestPriceSeen,
        lowestPriceSeen: aiOutcome.lowestPriceSeen,
        lastCheckedAt: aiOutcome.lastCheckedAt,
        hitTargets: aiOutcome.hitTargets,
        simulatedEntryPrice: aiOutcome.simulatedEntryPrice,
        simulatedEntryTime: aiOutcome.simulatedEntryTime,
        simulatedSL: aiOutcome.simulatedSL,
        outcomePrice: aiOutcome.outcomePrice,
        outcomeTime: aiOutcome.outcomeTime,
        exitType: aiOutcome.exitType,
        closedAtBreakEven: aiOutcome.closedAtBreakEven,
        simulationNotes: aiOutcome.simulationNotes,
        executionStatus: aiOutcome.executionStatus,
        blockedAt: aiOutcome.blockedAt,
        plannedRiskR: aiOutcome.plannedRiskR,
        blockReason: aiOutcome.blockReason,
        riskRMultiple: aiOutcome.riskRMultiple,
        updatedAt: new Date()
      };
      localAiRecommendationOutcomes.set(aiOutcome.recommendationId, updated);
    }

    const isTerminal = ["FULL_TP", "SL", "SL_HIT", "EXPIRED", "CANCELLED", "SUPERSEDED", "BREAK_EVEN", "BREAK_EVEN_EXIT", "BREAK_EVEN_HIT", "BREAK_EVEN_CLOSE", "BREAK_EVEN_STOP", "BREAKEVEN"].includes(aiOutcome.status);
    if (isTerminal) {
      await updateSnapshotOutcome(aiOutcome.recommendationId, aiOutcome);
    }

    return outcomeData;
  }

  const messageKey = outcomeData.messageKey;
  if (!messageKey) {
    throw new Error("messageKey is required to save a signal outcome");
  }

  // Convert mongoose document if passed
  const plainData = outcomeData.toObject ? outcomeData.toObject() : outcomeData;

  if (isMongoConnected()) {
    try {
      const updatedDoc = await SignalOutcome.findOneAndUpdate(
        { messageKey },
        { $set: plainData },
        { new: true, upsert: true, runValidators: true }
      );
      const obj = updatedDoc.toObject();
      localOutcomes.set(messageKey, obj);
      return obj;
    } catch (error) {
      logger.error("outcome_store.save_failed", {
        messageKey,
        error: error.message,
      });
      throw error;
    }
  } else {
    // Memory fallback logic
    const existing = localOutcomes.get(messageKey) || {};
    const updated = {
      ...existing,
      ...plainData,
      updatedAt: plainData.updatedAt || new Date(),
      createdAt: existing.createdAt || plainData.createdAt || new Date(),
    };
    localOutcomes.set(messageKey, updated);
    return updated;
  }
}

export async function getOutcomeByMessageKey(messageKey) {
  if (isMongoConnected()) {
    return SignalOutcome.findOne({ messageKey }).lean();
  }
  return localOutcomes.get(messageKey) || null;
}

export async function getOutcomeBySignalId(signalId) {
  if (isMongoConnected()) {
    const id = typeof signalId === "string" ? new mongoose.Types.ObjectId(signalId) : signalId;
    return SignalOutcome.findOne({ signalId: id }).lean();
  }
  for (const outcome of localOutcomes.values()) {
    if (String(outcome.signalId) === String(signalId)) {
      return outcome;
    }
  }
  return null;
}

export async function getActiveAndPendingOutcomes(pair = null) {
  const statuses = ["PENDING", "ACTIVE", "PARTIAL_TP"];
  
  if (isMongoConnected()) {
    const query = { status: { $in: statuses } };
    if (pair) {
      query.pair = pair;
    }
    return SignalOutcome.find(query).lean();
  }

  const results = [];
  for (const outcome of localOutcomes.values()) {
    if (statuses.includes(outcome.status)) {
      if (!pair || outcome.pair === pair) {
        results.push(outcome);
      }
    }
  }
  return results;
}

export async function getOutcomes(limit = 100, filters = {}) {
  if (isMongoConnected()) {
    const query = {};
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.pair) {
      query.pair = filters.pair;
    }
    if (filters.channel) {
      query.channel = filters.channel;
    }
    return SignalOutcome.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  let results = [...localOutcomes.values()];
  if (filters.status) {
    results = results.filter((o) => o.status === filters.status);
  }
  if (filters.pair) {
    results = results.filter((o) => o.pair === filters.pair);
  }
  if (filters.channel) {
    results = results.filter((o) => o.channel === filters.channel);
  }
  return results.slice(0, limit);
}

export function resetOutcomeStore() {
  localOutcomes.clear();
  localDailySummaries.clear();
}

/**
 * Calculates risk-to-reward ratio for a single completed outcome record
 * Formula:
 * BUY:  (TargetPrice - EntryPrice) / (EntryPrice - StopLoss)
 * SELL: (EntryPrice - TargetPrice) / (StopLoss - EntryPrice)
 * @param {Object} outcome
 * @returns {number} The calculated Risk:Reward ratio
 */
function calculateOutcomeRR(outcome) {
  const entryPrice = outcome.entry?.entryPrice;
  const stopLoss = outcome.stopLoss;
  if (!entryPrice || !stopLoss || entryPrice === stopLoss) {
    return 0;
  }

  let targetPrice = null;
  const hitTargets = (outcome.targets || []).filter((t) => t.isHit);
  if (hitTargets.length > 0) {
    hitTargets.sort((a, b) => b.targetNumber - a.targetNumber);
    targetPrice = hitTargets[0].price;
  } else if (outcome.targets && outcome.targets.length > 0) {
    targetPrice = outcome.targets[0].price;
  }

  if (!targetPrice) {
    return 0;
  }

  let rr = 0;
  if (outcome.action === "BUY") {
    const risk = entryPrice - stopLoss;
    const reward = targetPrice - entryPrice;
    if (risk > 0) {
      rr = reward / risk;
    }
  } else if (outcome.action === "SELL") {
    const risk = stopLoss - entryPrice;
    const reward = entryPrice - targetPrice;
    if (risk > 0) {
      rr = reward / risk;
    }
  }

  return rr > 0 ? Number(rr.toFixed(2)) : 0;
}

/**
 * Compiles daily aggregate stats for completed outcomes, archives them,
 * and prunes individual outcomes, raw messages, and parsed signals based on
 * configurable retention rules.
 */
export async function purgeHistoricalOutcomes() {
  const outcomeDays = config.retention?.outcomeDays ?? 0;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - outcomeDays);
  cutoffDate.setHours(0, 0, 0, 0);

  const terminalStatuses = ["FULL_TP", "SL_HIT", "EXPIRED", "CANCELLED"];
  let outcomesToProcess = [];

  if (isMongoConnected()) {
    try {
      outcomesToProcess = await SignalOutcome.find({
        status: { $in: terminalStatuses },
        updatedAt: { $lt: cutoffDate }
      }).lean();
    } catch (err) {
      logger.error("outcome_store.fetch_for_purge_failed", { error: err.message });
      return;
    }
  } else {
    // In-memory fallback
    for (const outcome of localOutcomes.values()) {
      const outcomeTime = new Date(outcome.updatedAt || outcome.outcomeTime || Date.now());
      if (terminalStatuses.includes(outcome.status) && outcomeTime < cutoffDate) {
        outcomesToProcess.push(outcome);
      }
    }
  }

  if (outcomesToProcess.length > 0) {
    const grouped = {};
    for (const o of outcomesToProcess) {
      const dateObj = new Date(o.updatedAt || o.outcomeTime || Date.now());
      dateObj.setHours(0, 0, 0, 0);
      const dateStr = dateObj.toISOString();
      if (!grouped[dateStr]) {
        grouped[dateStr] = [];
      }
      grouped[dateStr].push(o);
    }

    for (const [dateStr, dayOutcomes] of Object.entries(grouped)) {
      const date = new Date(dateStr);
      const totalSignals = dayOutcomes.length;
      const fullTpCount = dayOutcomes.filter((o) => o.status === "FULL_TP").length;
      const partialTpCount = dayOutcomes.filter((o) => o.status === "PARTIAL_TP").length;
      const slHitCount = dayOutcomes.filter((o) => o.status === "SL_HIT").length;
      const expiredCount = dayOutcomes.filter((o) => o.status === "EXPIRED").length;
      const cancelledCount = dayOutcomes.filter((o) => o.status === "CANCELLED").length;

      const ratedOutcomes = fullTpCount + slHitCount;
      const winRate = ratedOutcomes > 0 ? fullTpCount / ratedOutcomes : 0;

      let totalRR = 0;
      let validRRCount = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let maxDrawdown = 0;
      let breakEvenCount = 0;

      for (const o of dayOutcomes) {
        const rr = calculateOutcomeRR(o);
        if (rr > 0) {
          totalRR += rr;
          validRRCount++;
        }

        // Calculate break-even trades
        if (
          o.status === "SL_HIT" &&
          o.stopLoss !== null &&
          o.entry?.entryPrice !== null &&
          o.stopLoss === o.entry.entryPrice
        ) {
          breakEvenCount++;
        }

        // Calculate profit and loss for profit factor / max drawdown
        const entry = o.entry?.entryPrice;
        const exit = o.outcomePrice;
        if (entry && exit) {
          if (o.status === "FULL_TP" || o.status === "PARTIAL_TP") {
            const profit = o.action === "BUY" ? (exit - entry) : (entry - exit);
            if (profit > 0) grossProfit += profit;
          } else if (o.status === "SL_HIT") {
            const loss = o.action === "BUY" ? (entry - exit) : (exit - entry);
            if (loss > 0) {
              grossLoss += loss;
              if (loss > maxDrawdown) {
                maxDrawdown = loss;
              }
            }
          }
        }
      }

      const averageRR = validRRCount > 0 ? totalRR / validRRCount : 0;
      const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.99 : 0;

      const statsPayload = {
        date,
        totalSignals,
        fullTpCount,
        partialTpCount,
        slHitCount,
        expiredCount,
        cancelledCount,
        winRate: Number(winRate.toFixed(4)),
        averageRR: Number(averageRR.toFixed(2)),
        breakEvenCount,
        maxDrawdown: Number(maxDrawdown.toFixed(5)),
        profitFactor
      };

      let archivingSuccessful = true;

      if (isMongoConnected()) {
        try {
          // Upsert aggregate summary stats for that day
          await DailyOutcomeSummary.findOneAndUpdate(
            { date },
            { $set: statsPayload },
            { upsert: true, new: true }
          );

          // Purge these specific completed outcomes from MongoDB
          const outcomeIds = dayOutcomes.map((o) => o._id);
          const delRes = await SignalOutcome.deleteMany({ _id: { $in: outcomeIds } });
          logger.info("outcome_store.daily_summary_archived_and_purged", {
            date: dateStr.split("T")[0],
            signalsSummarized: totalSignals,
            deletedCount: delRes.deletedCount
          });
        } catch (err) {
          logger.error("outcome_store.archive_and_purge_failed", {
            date: dateStr,
            error: err.message
          });
          archivingSuccessful = false;
        }
      } else {
        // In-memory fallback caching
        localDailySummaries.set(dateStr, statsPayload);
      }

      if (archivingSuccessful) {
        // Safe to remove from local outcomes memory cache fallback
        for (const o of dayOutcomes) {
          localOutcomes.delete(o.messageKey);
        }
      }
    }
  }

  // Database-only multi-collection retention rules execution
  if (isMongoConnected()) {
    // 1. RawMessages: Prune messages older than RAW_MESSAGE_RETENTION_DAYS
    try {
      const rawDays = config.retention?.rawMessageDays ?? 30;
      const rawCutoff = new Date();
      rawCutoff.setDate(rawCutoff.getDate() - rawDays);
      const rawResult = await RawMessage.deleteMany({ fetchedAt: { $lt: rawCutoff } });
      if (rawResult.deletedCount > 0) {
        logger.info("outcome_store.raw_messages_pruned", {
          deletedCount: rawResult.deletedCount,
          cutoff: rawCutoff
        });
      }
    } catch (err) {
      logger.error("outcome_store.raw_messages_prune_failed", { error: err.message });
    }

    // 2. ParsedSignals: Prune terminal signals (CLOSED, EXPIRED, CANCELLED states) older than PARSED_SIGNAL_RETENTION_DAYS
    try {
      const parsedDays = config.retention?.parsedSignalDays ?? 90;
      const parsedCutoff = new Date();
      parsedCutoff.setDate(parsedCutoff.getDate() - parsedDays);
      const parsedResult = await ParsedSignal.deleteMany({
        signalState: { $in: ["CLOSED", "EXPIRED", "CANCELLED"] },
        createdAt: { $lt: parsedCutoff }
      });
      if (parsedResult.deletedCount > 0) {
        logger.info("outcome_store.parsed_signals_pruned", {
          deletedCount: parsedResult.deletedCount,
          cutoff: parsedCutoff
        });
      }
    } catch (err) {
      logger.error("outcome_store.parsed_signals_prune_failed", { error: err.message });
    }
  }
}

/**
 * Returns archived daily statistics summaries
 */
export async function getDailySummaries(limit = 100) {
  if (isMongoConnected()) {
    return DailyOutcomeSummary.find().sort({ date: -1 }).limit(limit).lean();
  }
  const results = [...localDailySummaries.values()];
  results.sort((a, b) => b.date.getTime() - a.date.getTime());
  return results.slice(0, limit);
}

/**
 * Retrieves the latest active (non-terminal) AI recommendation outcome.
 */
export async function getLatestActiveAiRecommendation(pair = "XAUUSD") {
  if (isMongoConnected()) {
    return AiRecommendationOutcome.findOne({
      pair,
      status: { $in: ["PENDING", "ACTIVE", "PARTIAL_TP"] }
    })
    .sort({ generatedTime: -1 })
    .lean();
  }
  // Memory fallback query
  let active = null;
  for (const doc of localAiRecommendationOutcomes.values()) {
    if (doc.pair === pair && ["PENDING", "ACTIVE", "PARTIAL_TP"].includes(doc.status)) {
      if (!active || doc.generatedTime.getTime() > active.generatedTime.getTime()) {
        active = doc;
      }
    }
  }
  return active;
}

export async function getActiveAiRecommendations(pair = "XAUUSD") {
  if (isMongoConnected()) {
    return AiRecommendationOutcome.find({
      pair,
      status: { $in: ["PENDING", "ACTIVE", "PARTIAL_TP"] }
    }).lean();
  }
  const results = [];
  for (const doc of localAiRecommendationOutcomes.values()) {
    if (doc.pair === pair && ["PENDING", "ACTIVE", "PARTIAL_TP"].includes(doc.status)) {
      results.push(doc);
    }
  }
  return results;
}

/**
 * Saves a newly generated AI trade recommendation or updates/supersedes the existing active one(s).
 */
export async function saveNewAiRecommendationOutcome(rec) {
  if (!rec || rec.status === "error") {
    return;
  }

  const pair = rec.pair || "XAUUSD";

  if (rec.direction === "HOLD") {
    const activeRecs = await getActiveAiRecommendations(pair);
    for (const item of activeRecs) {
      item.status = "SUPERSEDED";
      item.simulationNotes = item.simulationNotes || [];
      if (!item.simulationNotes.includes("Superseded")) {
        item.simulationNotes.push("Superseded");
      }
      if (isMongoConnected()) {
        await AiRecommendationOutcome.findByIdAndUpdate(item._id, { $set: { status: "SUPERSEDED", simulationNotes: item.simulationNotes } });
      } else {
        item.updatedAt = new Date();
        localAiRecommendationOutcomes.set(item.recommendationId, item);
      }
      logger.info("ai_outcome.superseded_by_hold", { recommendationId: item.recommendationId });
    }
    return;
  }

  const activeRecs = await getActiveAiRecommendations(pair);

  if (activeRecs.length > 0) {
    const activeRec = activeRecs[0];
    // Compare parameters
    const isSameDirection = activeRec.direction === rec.direction;
    const isSameEntry = Math.abs((activeRec.entryMin || 0) - (rec.entryMin || 0)) < 0.01 &&
                         Math.abs((activeRec.entryMax || 0) - (rec.entryMax || 0)) < 0.01;
    const isSameSL = (activeRec.sl === null && rec.sl === null) ||
                     (activeRec.sl !== null && rec.sl !== null && Math.abs(activeRec.sl - rec.sl) < 0.01);
    const isSameTP = (activeRec.lowRiskTp === null && rec.tp === null) ||
                     (activeRec.lowRiskTp !== null && rec.tp !== null && Math.abs(activeRec.lowRiskTp - rec.tp) < 0.01);

    if (isSameDirection && isSameEntry && isSameSL && isSameTP) {
      logger.info("ai_outcome.reused_existing", { recommendationId: activeRec.recommendationId });
      rec.recommendationId = activeRec.recommendationId.split("_DUP_")[0]; // Reuse the ID
      return;
    }

    if (isSameDirection) {
      // Version update all active duplicates
      for (const item of activeRecs) {
        const nextVersion = (item.recommendationVersion || 1) + 1;
        if (isMongoConnected()) {
          try {
            const updated = await AiRecommendationOutcome.findByIdAndUpdate(
              item._id,
              {
                $set: {
                  entryMin: rec.entryMin,
                  entryMax: rec.entryMax,
                  sl: rec.sl,
                  lowRiskTp: rec.tp,
                  moderateTp: rec.moderateTp,
                  highRiskTp: rec.highRiskTp,
                  tradeQuality: rec.tradeQuality,
                  confidence: rec.confidence,
                  riskReward: rec.riskReward,
                  estimatedHoldingTime: rec.estimatedHoldingTime,
                  tradeStyle: rec.tradeStyle,
                  recommendationVersion: nextVersion,
                  triggerSource: rec.triggerSource || null,
                  generationTimeMs: rec.generationTimeMs || null,
                  lastCheckedAt: new Date()
                }
              },
              { new: true }
            ).lean();
            if (updated) {
              localAiRecommendationOutcomes.set(item.recommendationId, updated);
            }
          } catch (err) {
            logger.error("ai_outcome.update_failed", { recommendationId: item.recommendationId, error: err.message });
          }
        } else {
          item.entryMin = rec.entryMin;
          item.entryMax = rec.entryMax;
          item.sl = rec.sl;
          item.lowRiskTp = rec.tp;
          item.moderateTp = rec.moderateTp;
          item.highRiskTp = rec.highRiskTp;
          item.tradeQuality = rec.tradeQuality;
          item.confidence = rec.confidence;
          item.riskReward = rec.riskReward;
          item.estimatedHoldingTime = rec.estimatedHoldingTime;
          item.tradeStyle = rec.tradeStyle;
          item.recommendationVersion = nextVersion;
          item.triggerSource = rec.triggerSource || null;
          item.generationTimeMs = rec.generationTimeMs || null;
          item.updatedAt = new Date();
          localAiRecommendationOutcomes.set(item.recommendationId, item);
        }
      }
      logger.info("ai_outcome.version_incremented_duplicates", {
        baseRecommendationId: activeRec.recommendationId.split("_DUP_")[0],
        count: activeRecs.length
      });
      rec.recommendationId = activeRec.recommendationId.split("_DUP_")[0]; // Reuse the ID
      return;
    } else {
      // Superseded because of direction change
      for (const item of activeRecs) {
        item.status = "SUPERSEDED";
        item.simulationNotes = item.simulationNotes || [];
        if (!item.simulationNotes.includes("Superseded")) {
          item.simulationNotes.push("Superseded");
        }
        if (isMongoConnected()) {
          await AiRecommendationOutcome.findByIdAndUpdate(item._id, { $set: { status: "SUPERSEDED", simulationNotes: item.simulationNotes } });
        } else {
          item.updatedAt = new Date();
          localAiRecommendationOutcomes.set(item.recommendationId, item);
        }
        logger.info("ai_outcome.superseded", {
          oldRecommendationId: item.recommendationId,
          newDirection: rec.direction
        });
      }
    }
  }

  // Create new active recommendation(s)
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const settings = getSettingsSync();
  const dupCount = settings.duplicateTradesPerRecommendation || 1;

  const outcomeDataTemplate = {
    recommendationVersion: 1,
    generatedTime: new Date(),
    pair,
    direction: rec.direction,
    entryMin: rec.entryMin,
    entryMax: rec.entryMax,
    sl: rec.sl,
    lowRiskTp: rec.tp,
    moderateTp: rec.moderateTp,
    highRiskTp: rec.highRiskTp,
    tradeQuality: rec.tradeQuality,
    confidence: rec.confidence,
    riskReward: rec.riskReward,
    estimatedHoldingTime: rec.estimatedHoldingTime,
    tradeStyle: rec.tradeStyle,
    status: rec.status || "PENDING",
    hitTargets: [],
    triggerSource: rec.triggerSource || null,
    generationTimeMs: rec.generationTimeMs || null,
    expiresAt,
    // Simulation additions
    simulationMode: rec.simulationMode || "PAPER",
    aiSnapshot: {
      confidence: rec.confidence || null,
      tradeQuality: rec.tradeQuality || null,
      confluenceScore: rec.confluenceScore || null,
      tradeFilter: rec.tradeFilter || null,
      overallConfluence: rec.overallConfluence || null
    },
    simulationNotes: [],
    // Risk Manager additions
    executionStatus: "WAITING",
    blockedAt: null,
    plannedRiskR: 1,
    blockReason: null,
    riskRMultiple: null
  };

  if (dupCount > 1) {
    for (let i = 1; i <= dupCount; i++) {
      const recId = `${rec.recommendationId}_DUP_${i}`;
      const outcomeData = {
        ...outcomeDataTemplate,
        recommendationId: recId
      };
      if (isMongoConnected()) {
        try {
          const created = await AiRecommendationOutcome.create(outcomeData);
          localAiRecommendationOutcomes.set(recId, created.toObject());
          logger.info("ai_outcome.created", { recommendationId: recId });
        } catch (err) {
          logger.error("ai_outcome.creation_failed", { error: err.message });
          throw err;
        }
      } else {
        localAiRecommendationOutcomes.set(recId, {
          _id: new mongoose.Types.ObjectId(),
          ...outcomeData,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }
  } else {
    const outcomeData = {
      ...outcomeDataTemplate,
      recommendationId: rec.recommendationId
    };
    if (isMongoConnected()) {
      try {
        const created = await AiRecommendationOutcome.create(outcomeData);
        localAiRecommendationOutcomes.set(rec.recommendationId, created.toObject());
        logger.info("ai_outcome.created", { recommendationId: rec.recommendationId });
      } catch (err) {
        logger.error("ai_outcome.creation_failed", { error: err.message });
        throw err;
      }
    } else {
      localAiRecommendationOutcomes.set(rec.recommendationId, {
        _id: new mongoose.Types.ObjectId(),
        ...outcomeData,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
  }
}
