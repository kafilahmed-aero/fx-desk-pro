import mongoose from "mongoose";
import { PairPerformance } from "../models/pairPerformanceModel.js";
import { getOutcomes } from "./signalOutcomeStore.js";
import { normalizeTradingPair } from "../parsers/pairDetector.js";
import { logger } from "../utils/logger.js";

const MINIMUM_SIGNALS_REQUIRED = 20;

// Local fallback in-memory store
const localPairPerformance = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Aggregates SignalOutcome records to recalculate statistics for all (channel, pair) combinations
 * @returns {Promise<Array<Object>>} List of updated pair performance documents
 */
export async function aggregatePairPerformance() {
  try {
    // 1. Fetch all outcomes
    const outcomes = await getOutcomes(10000);
    const groups = {};

    // Group signals by channel and normalized pair
    outcomes.forEach((o) => {
      const ch = o.channel;
      if (ch === "private-test-channel:3955968449") {
        return;
      }
      const normalizedPair = normalizeTradingPair(o.pair);
      
      const key = `${ch}_${normalizedPair}`;
      if (!groups[key]) {
        groups[key] = {
          channel: ch,
          pair: normalizedPair,
          outcomes: []
        };
      }
      groups[key].outcomes.push(o);
    });

    const results = [];

    // 2. Recalculate metrics for each channel-pair group
    for (const key of Object.keys(groups)) {
      const group = groups[key];
      const channelOutcomes = group.outcomes;
      const totalSignals = channelOutcomes.length;

      let pendingCount = 0;
      let activeCount = 0;
      let fullTpCount = 0;
      let partialTpCount = 0;
      let slHitCount = 0;
      let expiredCount = 0;
      let cancelledCount = 0;

      const tpDurations = [];
      const slDurations = [];

      channelOutcomes.forEach((o) => {
        const status = o.status;
        const created = o.createdAt ? new Date(o.createdAt) : null;
        const ended = o.outcomeTime ? new Date(o.outcomeTime) : null;

        switch (status) {
          case "PENDING":
            pendingCount++;
            break;
          case "ACTIVE":
            activeCount++;
            break;
          case "FULL_TP":
            fullTpCount++;
            if (created && ended) {
              const diffMs = ended.getTime() - created.getTime();
              tpDurations.push(diffMs / (1000 * 60));
            }
            break;
          case "PARTIAL_TP":
            partialTpCount++;
            if (created && ended) {
              const diffMs = ended.getTime() - created.getTime();
              tpDurations.push(diffMs / (1000 * 60));
            }
            break;
          case "SL_HIT":
            slHitCount++;
            if (created && ended) {
              const diffMs = ended.getTime() - created.getTime();
              slDurations.push(diffMs / (1000 * 60));
            }
            break;
          case "EXPIRED":
            expiredCount++;
            break;
          case "CANCELLED":
            cancelledCount++;
            break;
        }
      });

      const completedSignals = fullTpCount + partialTpCount + slHitCount + expiredCount + cancelledCount;

      // Rate calculations with 0.0 division fallbacks
      const winRateDenom = fullTpCount + slHitCount;
      const winRate = winRateDenom > 0 ? Number((fullTpCount / winRateDenom).toFixed(4)) : 0.0;

      const targetAchievementRate = completedSignals > 0 ? Number(((fullTpCount + partialTpCount) / completedSignals).toFixed(4)) : 0.0;

      // Duration average calculations
      const avgTpDurationMinutes =
        tpDurations.length > 0
          ? Number((tpDurations.reduce((sum, val) => sum + val, 0) / tpDurations.length).toFixed(2))
          : 0.0;

      const avgSlDurationMinutes =
        slDurations.length > 0
          ? Number((slDurations.reduce((sum, val) => sum + val, 0) / slDurations.length).toFixed(2))
          : 0.0;

      const isEligible = completedSignals >= MINIMUM_SIGNALS_REQUIRED;

      const perfData = {
        channelPairKey: key,
        channel: group.channel,
        pair: group.pair,
        totalSignals,
        completedSignals,
        fullTpCount,
        partialTpCount,
        slHitCount,
        expiredCount,
        cancelledCount,
        winRate,
        targetAchievementRate,
        avgTpDurationMinutes,
        avgSlDurationMinutes,
        minimumSignalsRequired: MINIMUM_SIGNALS_REQUIRED,
        isEligible,
        lastAggregatedAt: new Date(),
      };

      // 3. Persist data
      if (isMongoConnected()) {
        const doc = await PairPerformance.findOneAndUpdate(
          { channelPairKey: key },
          { $set: perfData },
          { new: true, upsert: true, runValidators: true }
        );
        const plainDoc = doc.toObject();
        localPairPerformance.set(key, plainDoc);
        results.push(plainDoc);
      } else {
        const existing = localPairPerformance.get(key) || {};
        const updated = {
          ...existing,
          ...perfData,
          updatedAt: new Date(),
          createdAt: existing.createdAt || new Date(),
        };
        localPairPerformance.set(key, updated);
        results.push(updated);
      }
    }

    logger.info("pair_performance.aggregation_completed", { pairsCount: results.length });
    return results;
  } catch (error) {
    logger.error("pair_performance.aggregation_failed", { error: error.message });
    throw error;
  }
}

/**
 * Retrieves all aggregated pair performance records
 * @returns {Promise<Array<Object>>} Sorted list of pair performances
 */
export async function getPairPerformances() {
  if (isMongoConnected()) {
    return PairPerformance.find({ channel: { $ne: "private-test-channel:3955968449" } }).sort({ channel: 1, pair: 1 }).lean();
  }

  return [...localPairPerformance.values()]
    .filter((p) => p.channel !== "private-test-channel:3955968449")
    .sort((left, right) => {
      const channelCompare = left.channel.localeCompare(right.channel);
      if (channelCompare !== 0) return channelCompare;
      return left.pair.localeCompare(right.pair);
    });
}

/**
 * Resets the local store (used for unit tests)
 */
export function resetPairPerformanceStore() {
  localPairPerformance.clear();
}
