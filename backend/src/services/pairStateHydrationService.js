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

    // Load active/partial signals within the active consensus age window
    const activeSignals = await ParsedSignal.find({
      signalState: { $in: ["ACTIVE", "PARTIAL"] },
      createdAt: { $gte: cutoffTime }
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
