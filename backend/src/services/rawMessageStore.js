import mongoose from "mongoose";
import { RawMessage } from "../models/rawMessageModel.js";
import fs from "fs/promises";
import path from "path";

const OFFLINE_QUEUE_DIR = path.resolve(process.cwd(), "data");
const OFFLINE_QUEUE_FILE = path.join(OFFLINE_QUEUE_DIR, "offline_telegram_queue.json");

const rawMessages = [];
const messageKeys = new Set();
let fileWriteQueue = Promise.resolve();
let flushingInProgress = false;
let cachedQueuedCount = 0;

async function ensureQueueDirExists() {
  try {
    await fs.mkdir(OFFLINE_QUEUE_DIR, { recursive: true });
  } catch (err) {
    // Ignore
  }
}

async function initQueuedCount() {
  try {
    const fileContent = await fs.readFile(OFFLINE_QUEUE_FILE, "utf-8");
    const arr = JSON.parse(fileContent);
    cachedQueuedCount = Array.isArray(arr) ? arr.length : 0;
  } catch (e) {
    cachedQueuedCount = 0;
  }
}
initQueuedCount().catch(() => {});

async function appendToOfflineFile(message) {
  fileWriteQueue = fileWriteQueue.then(async () => {
    try {
      await ensureQueueDirExists();
      let existing = [];
      try {
        const fileContent = await fs.readFile(OFFLINE_QUEUE_FILE, "utf-8");
        existing = JSON.parse(fileContent);
      } catch (e) {
        // File doesn't exist
      }
      
      const key = `${message.channel}:${message.messageId}`;
      const duplicate = existing.some(msg => `${msg.channel}:${msg.messageId}` === key);
      if (!duplicate) {
        existing.push(message);
        await fs.writeFile(OFFLINE_QUEUE_FILE, JSON.stringify(existing, null, 2), "utf-8");
        cachedQueuedCount = existing.length;
      }
    } catch (err) {
      console.error("[rawMessageStore] Failed to write offline message to file:", err.message);
    }
  });
  await fileWriteQueue;
}

export async function flushOfflineQueue() {
  if (flushingInProgress || !isMongoConnected()) {
    return;
  }

  flushingInProgress = true;
  
  try {
    await ensureQueueDirExists();
    let existing = [];
    try {
      const fileContent = await fs.readFile(OFFLINE_QUEUE_FILE, "utf-8");
      existing = JSON.parse(fileContent);
    } catch (e) {
      flushingInProgress = false;
      return;
    }

    if (existing.length === 0) {
      flushingInProgress = false;
      return;
    }

    console.log(`[rawMessageStore] MongoDB connected. Flushing ${existing.length} offline queued messages...`);
    
    let successfullyStored = 0;
    for (const msg of existing) {
      try {
        await RawMessage.create(msg);
        successfullyStored++;
      } catch (err) {
        if (err.code === 11000) {
          successfullyStored++;
        } else {
          console.error(`[rawMessageStore] Failed to flush message ${msg.channel}:${msg.messageId}:`, err.message);
          break; // Stop flushing if database writes fail for other reasons
        }
      }
    }

    const remaining = existing.slice(successfullyStored);
    if (remaining.length > 0) {
      await fs.writeFile(OFFLINE_QUEUE_FILE, JSON.stringify(remaining, null, 2), "utf-8");
    } else {
      try {
        await fs.unlink(OFFLINE_QUEUE_FILE);
      } catch (e) {}
    }
    cachedQueuedCount = remaining.length;
  } catch (err) {
    console.error("[rawMessageStore] Error during offline queue flush:", err.message);
  } finally {
    flushingInProgress = false;
  }
}

export async function storeRawMessage(rawMessage) {
  const messageToStore = {
    ...rawMessage,
    hasText: rawMessage.hasText ?? String(rawMessage.text || "").trim().length > 0,
    hasMedia: rawMessage.hasMedia ?? Boolean(rawMessage.mediaType),
    textLength: rawMessage.textLength ?? String(rawMessage.text || "").length,
  };
  const key = createMessageKey(rawMessage.channel, rawMessage.messageId);

  if (messageKeys.has(key)) {
    return {
      stored: false,
      duplicate: true,
      message: messageToStore,
    };
  }

  messageKeys.add(key);

  if (isMongoConnected()) {
    // Flush any pending queue messages first (async)
    flushOfflineQueue().catch(() => {});

    try {
      const savedMessage = await RawMessage.create(messageToStore);
      rawMessages.unshift(savedMessage.toObject());
    } catch (error) {
      if (error.code === 11000) {
        return {
          stored: false,
          duplicate: true,
          message: messageToStore,
        };
      }
      throw error;
    }
  } else {
    // MongoDB offline fallback: Store in memory and local persistent JSON file
    rawMessages.unshift(messageToStore);
    await appendToOfflineFile(messageToStore);
  }

  return {
    stored: true,
    duplicate: false,
    message: messageToStore,
  };
}

export function getQueuedMessagesCount() {
  return cachedQueuedCount;
}

export async function getRawMessages(limit = 100) {
  if (isMongoConnected()) {
    return RawMessage.find({})
      .sort({
        timestamp: -1,
        fetchedAt: -1,
      })
      .limit(limit)
      .lean();
  }
  return rawMessages.slice(0, limit);
}

export async function getRawMessageCount() {
  if (isMongoConnected()) {
    return RawMessage.countDocuments();
  }
  return rawMessages.length;
}

function createMessageKey(channel, messageId) {
  return `${channel}:${messageId}`;
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}
