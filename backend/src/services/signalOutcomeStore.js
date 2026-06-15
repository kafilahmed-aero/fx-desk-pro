import mongoose from "mongoose";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { logger } from "../utils/logger.js";

// Local in-memory fallback store
const localOutcomes = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export async function saveOutcome(outcomeData) {
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
      updatedAt: new Date(),
      createdAt: existing.createdAt || new Date(),
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
}
