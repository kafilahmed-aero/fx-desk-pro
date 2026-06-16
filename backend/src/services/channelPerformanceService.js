import mongoose from "mongoose";
import { ChannelPerformance } from "../models/channelPerformanceModel.js";
import { getOutcomes } from "./signalOutcomeStore.js";
import { logger } from "../utils/logger.js";

const MINIMUM_SIGNALS_FOR_RELIABILITY = 20;

// Local fallback in-memory store
const localPerformance = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Aggregates SignalOutcome records to recalculate statistics for all channels
 * @returns {Promise<Array<Object>>} List of updated performance documents
 */
export async function aggregateChannelPerformance() {
  try {
    // 1. Fetch all outcomes (supports fallback)
    const outcomes = await getOutcomes(10000);
    const groups = {};

    // Group signals by channel
    outcomes.forEach((o) => {
      const ch = o.channel;
      if (ch === "private-test-channel:3955968449") {
        return;
      }
      if (!groups[ch]) {
        groups[ch] = [];
      }
      groups[ch].push(o);
    });

    const results = [];

    // 2. Recalculate metrics for each channel group
    for (const channelName of Object.keys(groups)) {
      const channelOutcomes = groups[channelName];
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

      const expiryRate = totalSignals > 0 ? Number((expiredCount / totalSignals).toFixed(4)) : 0.0;

      // Duration average calculations
      const avgTpDurationMinutes =
        tpDurations.length > 0
          ? Number((tpDurations.reduce((sum, val) => sum + val, 0) / tpDurations.length).toFixed(2))
          : 0.0;

      const avgSlDurationMinutes =
        slDurations.length > 0
          ? Number((slDurations.reduce((sum, val) => sum + val, 0) / slDurations.length).toFixed(2))
          : 0.0;

      const isReliabilityEligible = completedSignals >= MINIMUM_SIGNALS_FOR_RELIABILITY;

      const perfData = {
        channel: channelName,
        totalSignals,
        pendingCount,
        activeCount,
        fullTpCount,
        partialTpCount,
        slHitCount,
        expiredCount,
        cancelledCount,
        completedSignals,
        winRate,
        targetAchievementRate,
        expiryRate,
        avgTpDurationMinutes,
        avgSlDurationMinutes,
        isReliabilityEligible,
        lastAggregatedAt: new Date(),
      };

      // 3. Persist data
      if (isMongoConnected()) {
        const doc = await ChannelPerformance.findByIdAndUpdate(
          channelName,
          { $set: perfData },
          { new: true, upsert: true, runValidators: true }
        );
        const plainDoc = doc.toObject();
        localPerformance.set(channelName, plainDoc);
        results.push(plainDoc);
      } else {
        const existing = localPerformance.get(channelName) || {};
        const updated = {
          ...existing,
          ...perfData,
          updatedAt: new Date(),
          createdAt: existing.createdAt || new Date(),
        };
        localPerformance.set(channelName, updated);
        results.push(updated);
      }
    }

    logger.info("performance.aggregation_completed", { channelsCount: results.length });
    return results;
  } catch (error) {
    logger.error("performance.aggregation_failed", { error: error.message });
    throw error;
  }
}

/**
 * Retrieves all aggregated channel performance records
 * @returns {Promise<Array<Object>>} Sorted list of channel performances
 */
export async function getChannelPerformances() {
  if (isMongoConnected()) {
    return ChannelPerformance.find({ channel: { $ne: "private-test-channel:3955968449" } }).sort({ channel: 1 }).lean();
  }

  return [...localPerformance.values()]
    .filter((p) => p.channel !== "private-test-channel:3955968449")
    .sort((left, right) =>
      left.channel.localeCompare(right.channel)
    );
}

/**
 * Resets the local store (used for unit tests)
 */
export function resetPerformanceStore() {
  localPerformance.clear();
}
