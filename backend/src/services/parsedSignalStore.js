import mongoose from "mongoose";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { enrichPossibleDuplicate } from "./duplicateSignalDetection.js";
import { updatePairStateFromSignal } from "./pairStateEngine.js";

const parsedSignals = [];
const signalKeys = new Set();

// Parsed signal storage is separate from raw message storage by design.
// Parser quality can improve without losing the original Telegram message.
export async function storeParsedSignal(signal) {
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

  return {
    stored: true,
    duplicate: false,
    signal: signalWithDuplicateMetadata,
  };
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

  if (filters.hideStale && signal.freshnessScore === "STALE") {
    return false;
  }

  return true;
}
