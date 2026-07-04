import mongoose from "mongoose";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { enrichPossibleDuplicate } from "./duplicateSignalDetection.js";
import { updatePairStateFromSignal } from "./pairStateEngine.js";
import { isExpiredTestSignal } from "./testSignalExpiry.js";
import { logger } from "../utils/logger.js";

const parsedSignals = [];
const signalKeys = new Set();

// Parsed signal storage is separate from raw message storage by design.
// Parser quality can improve without losing the original Telegram message.
export async function storeParsedSignal(signal) {
  if (signal.effectiveStopLoss === undefined) {
    signal.effectiveStopLoss = signal.stopLoss;
  }
  if (signal.remainingTargets === undefined) {
    signal.remainingTargets = signal.targets || [];
  }
  if (signal.lifecycleStage === undefined) {
    signal.lifecycleStage = 0;
  }

  const key = createSignalKey(signal.channel, signal.messageId);

  if (signalKeys.has(key)) {
    return {
      stored: false,
      duplicate: true,
      signal,
    };
  }

  signalKeys.add(key);
  const signalWithDuplicateMetadata = await addDuplicateMetadata(signal);

  if (isMongoConnected()) {
    try {
      const savedSignal = await ParsedSignal.create(signalWithDuplicateMetadata);
      parsedSignals.unshift(savedSignal.toObject());
    } catch (error) {
      if (error.code === 11000) {
        return {
          stored: false,
          duplicate: true,
          signal,
        };
      }

      throw error;
    }
  } else {
    parsedSignals.unshift(signalWithDuplicateMetadata);
  }

  updatePairStateFromSignal(signalWithDuplicateMetadata);

  if (
    signalWithDuplicateMetadata.pair === "XAUUSD" &&
    signalWithDuplicateMetadata.classification === "NEW_SIGNAL" &&
    signalWithDuplicateMetadata.signalState === "ACTIVE"
  ) {
    import("./aiRecommendationStateService.js").then((mod) => {
      mod.generateRecommendationIfNeeded("NEW_SIGNAL", signalWithDuplicateMetadata).catch(() => {});
    }).catch(() => {});
  }

  return {
    stored: true,
    duplicate: false,
    signal: signalWithDuplicateMetadata,
  };
}

export async function updateParsedSignalState(signalId, newState) {
  if (isMongoConnected()) {
    try {
      const result = await ParsedSignal.updateOne(
        { _id: signalId, signalState: { $ne: newState } },
        { $set: { signalState: newState } }
      );
      
      // Update in-memory copy of this signal in parsedSignals array if present
      const localIdx = parsedSignals.findIndex((s) => String(s._id) === String(signalId));
      if (localIdx !== -1) {
        parsedSignals[localIdx].signalState = newState;
      }

      if (result.modifiedCount > 0) {
        logger.info("parsed_signal.state_updated", { signalId, newState });
        return true;
      }
    } catch (error) {
      logger.error("parsed_signal.state_update_failed", {
        signalId,
        newState,
        error: error.message,
      });
    }
  } else {
    // Memory fallback logic
    const localIdx = parsedSignals.findIndex((s) => String(s._id) === String(signalId));
    if (localIdx !== -1) {
      if (parsedSignals[localIdx].signalState !== newState) {
        parsedSignals[localIdx].signalState = newState;
        logger.info("parsed_signal.local_state_updated", { signalId, newState });
        return true;
      }
    }
  }
  return false;
}

export async function updateParsedSignalLifecycle(signalId, effectiveStopLoss, remainingTargets, lifecycleStage) {
  if (isMongoConnected()) {
    try {
      await ParsedSignal.updateOne(
        { _id: signalId },
        { $set: { effectiveStopLoss, remainingTargets, lifecycleStage } }
      );
      
      const localIdx = parsedSignals.findIndex((s) => String(s._id) === String(signalId));
      if (localIdx !== -1) {
        parsedSignals[localIdx].effectiveStopLoss = effectiveStopLoss;
        parsedSignals[localIdx].remainingTargets = remainingTargets;
        parsedSignals[localIdx].lifecycleStage = lifecycleStage;
      }
      logger.info("parsed_signal.lifecycle_updated", { signalId, effectiveStopLoss, remainingTargets, lifecycleStage });
      return true;
    } catch (error) {
      logger.error("parsed_signal.lifecycle_update_failed", {
        signalId,
        error: error.message
      });
    }
  } else {
    const localIdx = parsedSignals.findIndex((s) => String(s._id) === String(signalId));
    if (localIdx !== -1) {
      parsedSignals[localIdx].effectiveStopLoss = effectiveStopLoss;
      parsedSignals[localIdx].remainingTargets = remainingTargets;
      parsedSignals[localIdx].lifecycleStage = lifecycleStage;
      logger.info("parsed_signal.local_lifecycle_updated", { signalId, effectiveStopLoss, remainingTargets, lifecycleStage });
      return true;
    }
  }
  return false;
}



export async function getParsedSignals(limit = 100, filters = {}) {
  const query = createSignalQuery(filters);

  if (isMongoConnected()) {
    return ParsedSignal.find(query)
      .sort({
        timestamp: -1,
        createdAt: -1,
      })
      .limit(limit)
      .lean();
  }

  return parsedSignals.filter((signal) => signalMatchesFilters(signal, filters)).slice(0, limit);
}

export async function getParsedSignalCount() {
  if (isMongoConnected()) {
    return ParsedSignal.countDocuments();
  }

  return parsedSignals.length;
}

function createSignalKey(channel, messageId) {
  return `${channel}:${messageId}`;
}

async function addDuplicateMetadata(signal) {
  const activeSignals = await getActiveSignalsForDuplicateCheck(signal);
  return enrichPossibleDuplicate(signal, activeSignals);
}

async function getActiveSignalsForDuplicateCheck(signal) {
  if (!signal?.pair || !signal?.action) {
    return [];
  }

  const filters = {
    activeOnly: true,
    hideStale: true,
  };

  if (isMongoConnected()) {
    return ParsedSignal.find({
      ...createSignalQuery(filters),
      pair: signal.pair,
      action: signal.action,
      parserClassification: "NEW_SIGNAL",
    })
      .sort({
        timestamp: -1,
        createdAt: -1,
      })
      .limit(100)
      .lean();
  }

  return parsedSignals
    .filter((candidate) => candidate.pair === signal.pair && candidate.action === signal.action)
    .filter((candidate) => signalMatchesFilters(candidate, filters))
    .slice(0, 100);
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

function createSignalQuery(filters) {
  const query = {};

  if (filters.activeOnly) {
    query.signalState = {
      $in: ["ACTIVE", "PARTIAL"],
    };
    query.$and = [
      {
        $or: [
          { isTestSignal: { $ne: true } },
          { expiresAt: { $gt: filters.now || new Date() } },
        ],
      },
    ];
  }

  if (filters.hideStale) {
    query.freshnessScore = {
      $ne: "STALE",
    };
  }

  return query;
}

function signalMatchesFilters(signal, filters) {
  if (filters.activeOnly && !["ACTIVE", "PARTIAL"].includes(signal.signalState)) {
    return false;
  }

  if (filters.activeOnly && isExpiredTestSignal(signal, filters.now || new Date())) {
    return false;
  }

  if (filters.hideStale && signal.freshnessScore === "STALE") {
    return false;
  }

  return true;
}
