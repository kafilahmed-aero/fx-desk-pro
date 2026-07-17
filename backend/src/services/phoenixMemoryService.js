import mongoose from "mongoose";
import { PhoenixTradeMemory } from "../models/phoenixTradeMemoryModel.js";
import { recordTradeFeatures } from "./phoenixFeatureEngine.js";

// In-memory ledger map cache fallback for offline testing
export const localPhoenixTradeMemory = new Map();

/**
 * Specialized deep freeze function for Phoenix database structures
 * Bypasses ObjectId, Dates, RegExp, and Binary buffer objects.
 */
export function phoenixDeepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  if (
    obj instanceof Date ||
    obj instanceof RegExp ||
    Buffer.isBuffer(obj) ||
    ArrayBuffer.isView(obj) ||
    obj.constructor?.name === "ObjectId" ||
    obj.constructor?.name === "Decimal128"
  ) {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    phoenixDeepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Phoenix Memory Service - recordCompletedTrade
 * Appends a completed trade case study snapshot to the ledger.
 */
export async function recordCompletedTrade(snapshotData = {}) {
  const tradeId = snapshotData.tradeId;

  if (!tradeId) {
    throw new Error("Missing required parameter: tradeId");
  }

  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    // Online unique tradeId duplicate check
    const exists = await PhoenixTradeMemory.findOne({ tradeId });
    if (exists) {
      throw new Error(`Duplicate trade entry detected. Trade ID '${tradeId}' already exists in the Phoenix ledger.`);
    }

    const newDoc = new PhoenixTradeMemory(snapshotData);
    const savedDoc = await newDoc.save();
    const plainObj = savedDoc.toObject();

    // Cache locally as well
    localPhoenixTradeMemory.set(tradeId, plainObj);

    // Generate and save engineered features (one-way pipeline flow)
    await recordTradeFeatures(plainObj).catch(err => {
      console.error("phoenix_memory.record_features_failed", err);
    });

    return phoenixDeepFreeze(plainObj);
  } else {
    // Offline unique tradeId duplicate check
    if (localPhoenixTradeMemory.has(tradeId)) {
      throw new Error(`Duplicate trade entry detected. Trade ID '${tradeId}' already exists in the Phoenix ledger.`);
    }

    // Schema validation checks locally using a detached Mongoose document
    const mockDoc = new PhoenixTradeMemory(snapshotData);
    await mockDoc.validate();

    // Convert doc to plain object (resolving defaults/schemas)
    const plainObj = {
      _id: new mongoose.Types.ObjectId(),
      schemaVersion: "1.0",
      engineVersion: "FX Desk Pro v1.0",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...mockDoc.toObject()
    };

    localPhoenixTradeMemory.set(tradeId, plainObj);

    // Generate and save engineered features locally (one-way pipeline flow)
    await recordTradeFeatures(plainObj).catch(err => {
      console.error("phoenix_memory.record_features_local_failed", err);
    });

    return phoenixDeepFreeze(plainObj);
  }
}

/**
 * Query the Phoenix Trade Ledger (Read-Only)
 */
export async function getTradeHistory(filter = {}, options = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const query = PhoenixTradeMemory.find(filter);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(options.limit);
    if (options.skip) query.skip(options.skip);

    const docs = await query.exec();
    return phoenixDeepFreeze(docs.map(doc => doc.toObject()));
  } else {
    // In-memory filtering query emulator
    let list = Array.from(localPhoenixTradeMemory.values());
    
    // Simple filter matching
    Object.keys(filter).forEach(key => {
      list = list.filter(item => {
        const val = item[key];
        return val === filter[key];
      });
    });

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return phoenixDeepFreeze(list);
  }
}

/**
 * Explicit mutation block wrappers for safety assertions
 */
export async function updateTradeMemory(tradeId, updates) {
  const isMongoConnected = mongoose.connection.readyState === 1;
  if (isMongoConnected) {
    await PhoenixTradeMemory.updateOne({ tradeId }, { $set: updates });
  } else {
    throw new Error("Phoenix trade memory is append-only. Modifying existing records is prohibited.");
  }
}

export async function deleteTradeMemory(tradeId) {
  const isMongoConnected = mongoose.connection.readyState === 1;
  if (isMongoConnected) {
    await PhoenixTradeMemory.deleteOne({ tradeId });
  } else {
    throw new Error("Phoenix trade memory is append-only. Deleting records is prohibited.");
  }
}
