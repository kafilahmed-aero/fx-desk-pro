import { config } from "../config/env.js";
import { getTelegramClient, connectTelegramWithSavedSession } from "./telegramService.js";
import { storeRawMessage } from "./rawMessageStore.js";
import { enqueueRawMessageProcessing } from "./messageProcessingQueue.js";
import { logger } from "../utils/logger.js";

let listenerTimer = null;
let listenerRunning = false;
let pollingInProgress = false;

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

  try {
    const client = await connectTelegramWithSavedSession();

    for (const channel of config.telegram.channels) {
      await fetchAndStoreChannelMessages(client, channel);
    }
  } finally {
    pollingInProgress = false;
  }
}

async function fetchAndStoreChannelMessages(client, channel) {
  try {
    const messages = await client.getMessages(channel, {
      limit: config.telegram.pollLimit,
    });

    for (const message of messages) {
      const text = message.message || "";
      const hasMedia = Boolean(message.media);
      const rawMessage = {
        channel,
        messageId: message.id,
        text,
        hasText: text.trim().length > 0,
        hasMedia,
        mediaType: hasMedia ? getMediaType(message.media) : null,
        textLength: text.length,
        timestamp: formatMessageDate(message.date),
        fetchedAt: new Date().toISOString(),
      };

      const result = await storeRawMessage(rawMessage);

      if (result.stored) {
        logger.info("telegram.message_stored", {
          channel,
          messageId: message.id,
          hasText: rawMessage.hasText,
          hasMedia: rawMessage.hasMedia,
          mediaType: rawMessage.mediaType,
        });
        const queueResult = enqueueRawMessageProcessing(rawMessage);
        logger.info("telegram.message_queued", {
          channel,
          messageId: message.id,
          ...queueResult,
        });
      }
    }
  } catch (error) {
    logger.error("telegram.channel_fetch_failed", {
      channel,
      error: error.message,
    });
  }
}

function scheduleReconnect() {
  if (!listenerRunning) {
    listenerTimer = setTimeout(() => {
      startTelegramListener().catch((error) => {
        logger.error("telegram.reconnect_failed", {
          error: error.message,
        });
      });
    }, config.telegram.pollIntervalMs);
  }
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
