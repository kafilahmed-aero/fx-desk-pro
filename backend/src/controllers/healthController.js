import { getLiveStabilitySnapshot } from "../services/liveStabilityService.js";
import { logger } from "../utils/logger.js";
import { getRawMessages } from "../services/rawMessageStore.js";
import { getParsedSignals } from "../services/parsedSignalStore.js";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getPairStates as getStoredPairStates } from "../services/pairStateStore.js";
import { getActiveOpportunities } from "../services/activeOpportunityService.js";

// controllers contain request handlers.
// Keeping handlers here prevents route files from growing too large.
export function getHealth(_request, response) {
  response.json({
    status: "Backend running",
  });
}

export function getLiveStability(_request, response) {
  logger.debug("api.live_stability_requested");

  response.json({
    stability: getLiveStabilitySnapshot(),
  });
}

export async function getDebugSignals(_request, response) {
  try {
    const raw = await getRawMessages(5);
    const parsed = await getParsedSignals(5);
    response.json({ raw, parsed });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}

export async function getDbAudit(request, response) {
  try {
    const statuses = ["PENDING", "ACTIVE", "PARTIAL_TP", "FULL_TP", "SL_HIT", "EXPIRED", "CANCELLED"];
    
    const statusCounts = {};
    for (const status of statuses) {
      statusCounts[status] = await SignalOutcome.countDocuments({ status });
    }
    
    const totalParsedSignals = await ParsedSignal.countDocuments();
    const totalSignalOutcomes = await SignalOutcome.countDocuments();
    
    const inMemoryPairStatesCount = getStoredPairStates().length;
    const inMemoryActiveOpportunitiesCount = getActiveOpportunities().length;
    const inMemoryOpportunities = getActiveOpportunities();

    const activeParsedSignals = await ParsedSignal.find({
      signalState: { $in: ["ACTIVE", "PARTIAL"] }
    }).select("_id pair signalState entryRange stopLoss targets effectiveStopLoss remainingTargets lifecycleStage channel messageId");

    const cutoffTime = new Date(Date.now() - 180 * 60 * 1000);
    const recentActiveSignals = await ParsedSignal.find({
      signalState: { $in: ["ACTIVE", "PARTIAL"] },
      createdAt: { $gte: cutoffTime }
    }).select("_id pair signalState entryRange stopLoss targets effectiveStopLoss remainingTargets lifecycleStage channel messageId createdAt");

    response.json({
      statusCounts,
      totalParsedSignals,
      totalSignalOutcomes,
      inMemoryPairStatesCount,
      inMemoryActiveOpportunitiesCount,
      inMemoryOpportunities,
      activeParsedSignals,
      recentActiveSignals
    });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}

