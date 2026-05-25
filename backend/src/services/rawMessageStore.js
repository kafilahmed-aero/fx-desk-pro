import mongoose from "mongoose";
import { RawMessage } from "../models/rawMessageModel.js";

const rawMessages = [];
const messageKeys = new Set();

// Raw Telegram storage. MongoDB is used when connected; memory is the local fallback.
export async function storeRawMessage(rawMessage) {
  const messageToStore = {
    ...rawMessage,
    hasText:
      rawMessage.hasText ?? String(rawMessage.text || "").trim().length > 0,
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
    rawMessages.unshift(messageToStore);
  }

  return {
    stored: true,
    duplicate: false,
    message: messageToStore,
  };
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
