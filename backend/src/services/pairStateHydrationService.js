// Startup hydration service for replaying active consensus signals from MongoDB on boot.
import mongoose from "mongoose";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { updatePairStateFromSignal, resetPairStateStore } from "./pairStateEngine.js";
import { getPairStates as getStoredPairStates } from "./pairStateStore.js";
import { getActiveOpportunities } from "./activeOpportunityService.js";
import { logger } from "../utils/logger.js";

/**
 * Hydrates the in-memory pairStates Map from MongoDB active signals.
 */
export async function hydratePairStatesFromDb() {
  const startedAt = Date.now();
  logger.info("consensus.hydration_started");

  try {
    if (mongoose.connection.readyState !== 1) {
      logger.warn("consensus.hydration_skipped", {
        reason: "database_not_connected",
      });
      return {
        success: false,
        reason: "Database not connected",
      };
    }

    const expirationMinutes = Number(process.env.SIGNAL_EXPIRATION_MINUTES) || 60;
    const cutoffTime = new Date(Date.now() - expirationMinutes * 60 * 1000);

    // Load active/partial signals within the active consensus age window that have Entry, TP, and SL
    const activeSignals = await ParsedSignal.find({
      signalState: { $in: ["ACTIVE", "PARTIAL"] },
      createdAt: { $gte: cutoffTime },
      entry: { $ne: null },
      $and: [
        {
          $or: [
            { "targets.0": { $exists: true } },
            { "pipTargets.0": { $exists: true } },
            { target: { $ne: null } }
          ]
        },
        {
          $or: [
            { stopLoss: { $ne: null } },
            { hiddenStopLoss: true },
            { effectiveStopLoss: { $ne: null } }
          ]
        }
      ]
    })
      .sort({ createdAt: 1 }) // replay in oldest -> newest order to reconstruct state correctly
      .lean();

    logger.info("consensus.hydration_signals_found", {
      activeSignalsFound: activeSignals.length,
      cutoffTime: cutoffTime.toISOString(),
    });

    // Reset the in-memory store before hydration to prevent duplicate states
    resetPairStateStore();

    let hydratedCount = 0;
    for (const signal of activeSignals) {
      updatePairStateFromSignal({
        ...signal,
        _id: signal._id.toString()
      });
      hydratedCount++;
    }

    const pairStatesCreated = getStoredPairStates().length;
    const activeOpportunitiesCreated = getActiveOpportunities().length;
    const durationMs = Date.now() - startedAt;

    logger.info("consensus.hydration_complete", {
      hydratedSignals: hydratedCount,
      pairStatesCreated,
      activeOpportunitiesCreated,
      durationMs,
    });

    return {
      success: true,
      hydratedSignals: hydratedCount,
      pairStatesCreated,
      activeOpportunitiesCreated,
      durationMs,
    };
  } catch (error) {
    logger.error("consensus.hydration_failed", {
      error: error.message,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

let lastSyncCheck = 0;

/**
 * Ensures in-memory pair states reflect the latest active signals from MongoDB Atlas.
 * Automatically re-hydrates if MongoDB has newer signals than in-memory state.
 */
export async function ensurePairStatesSynced() {
  const now = Date.now();
  if (now - lastSyncCheck < 2000) {
    return;
  }
  lastSyncCheck = now;

  try {
    if (mongoose.connection.readyState !== 1) return;

    const expirationMinutes = Number(process.env.SIGNAL_EXPIRATION_MINUTES) || 60;
    const cutoffTime = new Date(Date.now() - expirationMinutes * 60 * 1000);

    const latestSignal = await ParsedSignal.findOne({
      signalState: { $in: ["ACTIVE", "PARTIAL"] },
      createdAt: { $gte: cutoffTime },
      entry: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();

    const storedStates = getStoredPairStates();
    const newestInMemory = storedStates.reduce((max, ps) => {
      const t = ps.lastUpdated ? new Date(ps.lastUpdated).getTime() : 0;
      return t > max ? t : max;
    }, 0);

    const newestInDb = latestSignal?.createdAt ? new Date(latestSignal.createdAt).getTime() : 0;

    if (newestInDb > newestInMemory || storedStates.length === 0) {
      await hydratePairStatesFromDb();
    }
  } catch (err) {
    logger.error("consensus.sync_check_failed", { error: err.message });
  }
}
