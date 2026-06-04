import { config } from "../config/env.js";
import {
  getTelegramClient,
  connectTelegramWithSavedSession,
  resolveTelegramChannelEntity,
} from "./telegramService.js";
import { storeRawMessage } from "./rawMessageStore.js";
import { enqueueRawMessageProcessing } from "./messageProcessingQueue.js";
import { createTestSignalMetadata } from "./testSignalExpiry.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { logger } from "../utils/logger.js";

let listenerTimer = null;
let listenerRunning = false;
let pollingInProgress = false;
const discoveredChannels = new Set();
const subscribedChannels = new Set();
const activePollingChannels = new Set();
let lastStartupChannelReport = null;
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
    lastStartupChannelReport = await validateStartupChannels();
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
    lastStartupChannelReport = createFailedStartupChannelReport(error.message);
    logStartupChannelReport(lastStartupChannelReport);
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

async function validateStartupChannels() {
  const client = await connectTelegramWithSavedSession();
  const report = {
    totalChannelsMonitored: config.telegram.channels.length,
    activeChannels: [],
    inaccessibleChannels: [],
  };

  for (const channel of config.telegram.channels) {
    const validation = await validateStartupChannel(client, channel);

    if (validation.accessible) {
      report.activeChannels.push(validation);
    } else {
      report.inaccessibleChannels.push(validation);
    }
  }

  logStartupChannelReport(report);

  return report;
}

function createFailedStartupChannelReport(errorMessage) {
  return {
    totalChannelsMonitored: config.telegram.channels.length,
    activeChannels: [],
    inaccessibleChannels: config.telegram.channels.map((channel) => ({
      channelRef: channel,
      sourceChannel: channel,
      channelId: null,
      channelUsername: null,
      channelTitle: null,
      found: false,
      joined: false,
      accessible: false,
      sampledMessages: 0,
      parserCoverageStats: createEmptyParserCoverageStats(),
      error: errorMessage,
    })),
  };
}

function logStartupChannelReport(report) {
  logger.info("telegram.channel_startup_report", {
    totalChannelsMonitored: report.totalChannelsMonitored,
    activeChannels: report.activeChannels.length,
    inaccessibleChannels: report.inaccessibleChannels.length,
    activeChannelRefs: report.activeChannels.map((channel) => channel.channelRef),
    inaccessibleChannelRefs: report.inaccessibleChannels.map((channel) => ({
      channelRef: channel.channelRef,
      reason: channel.error,
    })),
  });
}

async function validateStartupChannel(client, channel) {
  const validation = {
    channelRef: channel,
    sourceChannel: channel,
    channelId: null,
    channelUsername: null,
    channelTitle: null,
    found: false,
    joined: false,
    accessible: false,
    sampledMessages: 0,
    parserCoverageStats: createEmptyParserCoverageStats(),
    error: null,
  };

  try {
    const resolvedChannel = await resolveTelegramChannelEntity(client, channel);
    validation.sourceChannel = resolvedChannel.channelLabel;
    validation.channelId = resolvedChannel.channelId;
    validation.channelUsername = resolvedChannel.channelUsername;
    validation.channelTitle = resolvedChannel.channelTitle;
    validation.found = true;

    logger.info("telegram.channel_validation_found", {
      channelRef: channel,
      sourceChannel: resolvedChannel.channelLabel,
      channelId: resolvedChannel.channelId,
      channelUsername: resolvedChannel.channelUsername,
      channelTitle: resolvedChannel.channelTitle,
    });

    validation.joined = true;
    logger.info("telegram.channel_validation_joined", {
      channelRef: channel,
      sourceChannel: resolvedChannel.channelLabel,
      channelId: resolvedChannel.channelId,
      channelUsername: resolvedChannel.channelUsername,
      channelTitle: resolvedChannel.channelTitle,
      joinMode: resolvedChannel.isPrivateInvite
        ? "invite_joined_or_already_participating"
        : "public_or_already_accessible",
    });

    const messages = await client.getMessages(resolvedChannel.entity, {
      limit: config.telegram.pollLimit,
    });
    validation.accessible = true;
    validation.sampledMessages = messages.length;
    validation.parserCoverageStats = getParserCoverageStats(messages, resolvedChannel);

    logger.info("telegram.channel_validation_accessible", {
      channelRef: channel,
      sourceChannel: resolvedChannel.channelLabel,
      channelId: resolvedChannel.channelId,
      channelUsername: resolvedChannel.channelUsername,
      channelTitle: resolvedChannel.channelTitle,
      sampledMessages: validation.sampledMessages,
    });

    logger.info("telegram.channel_parser_coverage_stats", {
      channelRef: channel,
      sourceChannel: resolvedChannel.channelLabel,
      channelId: resolvedChannel.channelId,
      channelUsername: resolvedChannel.channelUsername,
      channelTitle: resolvedChannel.channelTitle,
      ...validation.parserCoverageStats,
    });
  } catch (error) {
    validation.error = error.message;
    logger.error("telegram.channel_startup_validation_failed", {
      channelRef: channel,
      sourceChannel: validation.sourceChannel,
      channelId: validation.channelId,
      channelUsername: validation.channelUsername,
      channelTitle: validation.channelTitle,
      found: validation.found,
      joined: validation.joined,
      accessible: validation.accessible,
      error: error.message,
    });
  }

  return validation;
}

function getParserCoverageStats(messages, resolvedChannel) {
  const stats = createEmptyParserCoverageStats();

  for (const message of messages) {
    const text = message.message || "";
    const hasMedia = Boolean(message.media);
    const classificationResult = classifyMessage({
      channel: resolvedChannel.channelLabel,
      channelTitle: resolvedChannel.channelTitle,
      messageId: message.id,
      text,
      hasText: text.trim().length > 0,
      hasMedia,
      mediaType: hasMedia ? getMediaType(message.media) : null,
      textLength: text.length,
      timestamp: formatMessageDate(message.date),
    });
    const classification = classificationResult.classification || "NOISE";

    stats.sampledMessages += 1;
    stats.classificationCounts[classification] =
      (stats.classificationCounts[classification] || 0) + 1;

    if (isActionableClassification(classification)) {
      stats.actionableMessages += 1;
    } else {
      stats.nonActionableMessages += 1;
    }
  }

  stats.coveragePercent =
    stats.sampledMessages === 0
      ? 0
      : Math.round((stats.actionableMessages / stats.sampledMessages) * 100);

  return stats;
}

function createEmptyParserCoverageStats() {
  return {
    sampledMessages: 0,
    actionableMessages: 0,
    nonActionableMessages: 0,
    coveragePercent: 0,
    classificationCounts: {},
  };
}

function isActionableClassification(classification) {
  return ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL", "MARKET_ANALYSIS"].includes(
    classification
  );
}

async function fetchAndStoreChannelMessages(client, channel) {
  try {
    const resolvedChannel = await resolveTelegramChannelEntity(client, channel);
    logChannelDiscovered(channel, resolvedChannel);
    const messages = await client.getMessages(resolvedChannel.entity, {
      limit: config.telegram.pollLimit,
    });
    logChannelSubscribed(channel, resolvedChannel);
    logChannelPollingActive(channel, resolvedChannel);
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
      logger.info("telegram.channel_message_received", {
        sourceChannel: resolvedChannel.channelLabel,
        messageId: message.id,
        messageTimestamp: rawMessage.timestamp,
      });
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

function logChannelDiscovered(channelRef, resolvedChannel) {
  const key = resolvedChannel.channelLabel || channelRef;

  if (discoveredChannels.has(key)) {
    return;
  }

  discoveredChannels.add(key);
  logger.info("telegram.channel_discovered", {
    channelRef,
    sourceChannel: resolvedChannel.channelLabel,
    channelId: resolvedChannel.channelId,
    channelUsername: resolvedChannel.channelUsername,
    channelTitle: resolvedChannel.channelTitle,
  });
}

function logChannelSubscribed(channelRef, resolvedChannel) {
  const key = resolvedChannel.channelLabel || channelRef;

  if (subscribedChannels.has(key)) {
    return;
  }

  subscribedChannels.add(key);
  logger.info("telegram.channel_subscribed", {
    channelRef,
    sourceChannel: resolvedChannel.channelLabel,
    channelId: resolvedChannel.channelId,
    channelUsername: resolvedChannel.channelUsername,
    channelTitle: resolvedChannel.channelTitle,
  });
}

function logChannelPollingActive(channelRef, resolvedChannel) {
  const key = resolvedChannel.channelLabel || channelRef;

  if (activePollingChannels.has(key)) {
    return;
  }

  activePollingChannels.add(key);
  logger.info("telegram.channel_polling_active", {
    channelRef,
    sourceChannel: resolvedChannel.channelLabel,
    channelId: resolvedChannel.channelId,
    channelUsername: resolvedChannel.channelUsername,
    channelTitle: resolvedChannel.channelTitle,
  });
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
    startupChannelReport: lastStartupChannelReport,
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
