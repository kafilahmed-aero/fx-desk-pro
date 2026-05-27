import { config } from "../config/env.js";
import {
  getTelegramClient,
  connectTelegramWithSavedSession,
  resolveTelegramChannelEntity,
} from "./telegramService.js";
import { storeRawMessage } from "./rawMessageStore.js";
import { enqueueRawMessageProcessing } from "./messageProcessingQueue.js";
import { createTestSignalMetadata } from "./testSignalExpiry.js";
import { logger } from "../utils/logger.js";

let listenerTimer = null;
let listenerRunning = false;
let pollingInProgress = false;
const ingestionMetrics = {
  pollCycles: 0,
  reconnectAttempts: 0,
  channelFetchFailures: 0,
  messagesFetched: 0,
  messagesStored: 0,
  messagesQueued: 0,
  duplicateMessages: 0,
  lastPollStartedAt: null,
  lastPollCompletedAt: null,
  lastReconnectAt: null,
  lastError: null,
};

// Telegram ingestion lifecycle.
// This runs in the backend process independently from frontend users.
export async function startTelegramListener() {
  if (listenerRunning) {
    return {
      started: true,
      alreadyRunning: true,
    };
  }

  if (config.telegram.channels.length === 0) {
    logger.info("telegram.listener_skipped", {
      reason: "no_channels_configured",
    });
    return {
      started: false,
      reason: "No Telegram channels configured",
    };
  }

  logger.info("telegram.listener_started", {
    channelCount: config.telegram.channels.length,
    pollIntervalMs: config.telegram.pollIntervalMs,
    pollLimit: config.telegram.pollLimit,
  });

  listenerRunning = true;

  try {
    await connectTelegramWithSavedSession();
    logger.info("telegram.connected");
    await pollTelegramChannels();

    listenerTimer = setInterval(() => {
      pollTelegramChannels().catch((error) => {
        logger.error("telegram.polling_failed", {
          error: error.message,
        });
      });
    }, config.telegram.pollIntervalMs);

    return {
      started: true,
      channels: config.telegram.channels,
    };
  } catch (error) {
    listenerRunning = false;
    logger.error("telegram.listener_start_failed", {
      error: error.message,
    });
    scheduleReconnect();

    return {
      started: false,
      error: error.message,
    };
  }
}

export async function stopTelegramListener() {
  listenerRunning = false;

  if (listenerTimer) {
    clearInterval(listenerTimer);
    listenerTimer = null;
  }

  const client = getTelegramClient();

  if (client?.connected) {
    await client.disconnect();
  }

  logger.info("telegram.listener_stopped");
}

async function pollTelegramChannels() {
  if (pollingInProgress || !listenerRunning) {
    return;
  }

  pollingInProgress = true;
  ingestionMetrics.pollCycles += 1;
  ingestionMetrics.lastPollStartedAt = new Date().toISOString();
  const startedAt = Date.now();

  try {
    const client = await connectTelegramWithSavedSession();

    for (const channel of config.telegram.channels) {
      await fetchAndStoreChannelMessages(client, channel);
    }
  } finally {
    ingestionMetrics.lastPollCompletedAt = new Date().toISOString();
    pollingInProgress = false;
    logger.info("telegram.poll_cycle_complete", {
      pollCycles: ingestionMetrics.pollCycles,
      durationMs: Date.now() - startedAt,
      channels: config.telegram.channels.length,
      messagesFetched: ingestionMetrics.messagesFetched,
      messagesStored: ingestionMetrics.messagesStored,
      messagesQueued: ingestionMetrics.messagesQueued,
      duplicateMessages: ingestionMetrics.duplicateMessages,
    });
  }
}

async function fetchAndStoreChannelMessages(client, channel) {
  try {
    const resolvedChannel = await resolveTelegramChannelEntity(client, channel);
    const messages = await client.getMessages(resolvedChannel.entity, {
      limit: config.telegram.pollLimit,
    });
    ingestionMetrics.messagesFetched += messages.length;

    for (const message of messages) {
      const text = message.message || "";
      const hasMedia = Boolean(message.media);
      const channelTitle =
        resolvedChannel.channelTitle || message.chat?.title || message.sender?.username || null;
      const rawMessage = {
        channel: resolvedChannel.channelLabel,
        channelTitle,
        messageId: message.id,
        text,
        hasText: text.trim().length > 0,
        hasMedia,
        mediaType: hasMedia ? getMediaType(message.media) : null,
        textLength: text.length,
        timestamp: formatMessageDate(message.date),
        fetchedAt: new Date().toISOString(),
      };
      const testSignalMetadata = createTestSignalMetadata(rawMessage);
      rawMessage.isTestSignal = testSignalMetadata.isTestSignal;

      if (resolvedChannel.isPrivateInvite) {
        logger.debug("telegram.private_channel_message_received", {
          messageId: message.id,
          hasText: rawMessage.hasText,
        });
      }

      const result = await storeRawMessage(rawMessage);

      if (result.stored) {
        ingestionMetrics.messagesStored += 1;
        logger.info("telegram.message_stored", {
          channel: resolvedChannel.channelLabel,
          messageId: message.id,
          hasText: rawMessage.hasText,
          hasMedia: rawMessage.hasMedia,
          mediaType: rawMessage.mediaType,
          isTestSignal: rawMessage.isTestSignal,
        });
        const queueResult = enqueueRawMessageProcessing(rawMessage);
        if (resolvedChannel.isPrivateInvite && queueResult.queued) {
          logger.debug("telegram.private_channel_message_queued", {
            messageId: message.id,
          });
        }
        if (queueResult.queued) {
          ingestionMetrics.messagesQueued += 1;
        }
        if (queueResult.duplicate) {
          ingestionMetrics.duplicateMessages += 1;
        }
        logger.info("telegram.message_queued", {
          channel: resolvedChannel.channelLabel,
          messageId: message.id,
          ...queueResult,
        });
      } else {
        ingestionMetrics.duplicateMessages += 1;
      }
    }
  } catch (error) {
    ingestionMetrics.channelFetchFailures += 1;
    ingestionMetrics.lastError = error.message;
    logger.error("telegram.channel_fetch_failed", {
      channel,
      error: error.message,
    });
  }
}

function scheduleReconnect() {
  if (!listenerRunning) {
    ingestionMetrics.reconnectAttempts += 1;
    ingestionMetrics.lastReconnectAt = new Date().toISOString();
    logger.info("telegram.reconnect_scheduled", {
      reconnectAttempts: ingestionMetrics.reconnectAttempts,
      retryInMs: config.telegram.pollIntervalMs,
    });

    listenerTimer = setTimeout(() => {
      startTelegramListener().catch((error) => {
        ingestionMetrics.lastError = error.message;
        logger.error("telegram.reconnect_failed", {
          error: error.message,
        });
      });
    }, config.telegram.pollIntervalMs);
  }
}

export function getTelegramIngestionMetrics() {
  return {
    listenerRunning,
    pollingInProgress,
    configuredChannels: config.telegram.channels.length,
    pollIntervalMs: config.telegram.pollIntervalMs,
    pollLimit: config.telegram.pollLimit,
    ...ingestionMetrics,
  };
}

function getMediaType(media) {
  return media?.className || media?.constructor?.name || "unknown";
}

function formatMessageDate(date) {
  if (date instanceof Date) {
    return date.toISOString();
  }

  if (typeof date === "number") {
    return new Date(date * 1000).toISOString();
  }

  return null;
}
