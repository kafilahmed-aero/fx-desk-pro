console.log("Loading env");

await import("dotenv/config");

const { Api } = await import("telegram");
const { config } = await import("../config/env.js");
const { connectTelegramWithSavedSession } = await import("../services/telegramService.js");
const { processRawMessage } = await import("../services/signalProcessingService.js");
const { getConsensusSummary } = await import("../services/consensusService.js");

const channelDisplayNames = Object.fromEntries(
  config.telegram.channelConfigs.map((channel) => [channel.ref, channel.title || channel.ref])
);

const actionableClassifications = new Set([
  "NEW_SIGNAL",
  "UPDATE_SIGNAL",
  "RESULT_SIGNAL",
  "MARKET_ANALYSIS",
]);

const channels = config.telegram.channels;
const limit = config.telegram.pollLimit;
const summary = createEmptySummary(channels);

console.log("Live beta Telegram ingestion validation");
console.log(`Configured channels: ${channels.join(", ") || "(none)"}`);
console.log(`Fetch limit per channel: ${limit}`);

if (channels.length === 0) {
  console.log("No monitored Telegram channels configured");
  process.exitCode = 1;
} else {
  await runLiveBetaValidation();
}

async function runLiveBetaValidation() {
  let client;

  try {
    client = await connectTelegramWithSavedSession();
    console.log("Telegram client connected with saved session");
  } catch (error) {
    const reason = normalizeError(error);

    for (const channel of channels) {
      summary.failedChannels.push({
        channel,
        displayName: getDisplayName(channel),
        reason,
      });
    }

    printSummary(summary);
    process.exitCode = 1;
    return;
  }

  for (const channel of channels) {
    await validateChannel(client, channel);
  }

  try {
    summary.consensusPreview = await getConsensusSummary({
      limit: 100,
      latestLimit: 3,
    });
  } catch (error) {
    summary.consensusError = normalizeError(error);
  }

  printSummary(summary);
}

async function validateChannel(client, channel) {
  const displayName = getDisplayName(channel);
  const channelSummary = {
    channel,
    displayName,
    fetchedMessages: 0,
    classificationCounts: {},
    extractionExamples: [],
  };

  try {
    const entity = await client.getEntity(channel);

    await client.invoke(
      new Api.channels.GetFullChannel({
        channel: entity,
      })
    );

    const messages = await client.getMessages(entity, {
      limit,
    });

    channelSummary.fetchedMessages = messages.length;

    for (const message of messages) {
      const rawMessage = createRawMessage(channel, message);
      const result = await processRawMessage(rawMessage);
      const classification = result.classification || "NOISE";

      channelSummary.classificationCounts[classification] =
        (channelSummary.classificationCounts[classification] || 0) + 1;

      if (
        actionableClassifications.has(classification) &&
        result.parsedSignal &&
        channelSummary.extractionExamples.length < 3
      ) {
        channelSummary.extractionExamples.push(createExtractionExample(result.parsedSignal));
      }
    }

    summary.connectedChannels.push(channelSummary);
  } catch (error) {
    summary.failedChannels.push({
      channel,
      displayName,
      reason: normalizeError(error),
    });
  }
}

function createRawMessage(channel, message) {
  const text = message.message || "";
  const hasMedia = Boolean(message.media);

  return {
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
}

function createExtractionExample(signal) {
  return {
    pair: signal.pair,
    action: signal.action,
    entry: signal.entry,
    targets: signal.targets,
    stopLoss: signal.stopLoss,
    signalState: signal.signalState,
    freshnessScore: signal.freshnessScore,
    possibleDuplicate: Boolean(signal.possibleDuplicate),
    confidence: signal.extractionConfidence,
    sample: String(signal.rawText || "").replace(/\s+/g, " ").trim().slice(0, 180),
  };
}

function createEmptySummary(configuredChannels) {
  return {
    configuredChannels,
    connectedChannels: [],
    failedChannels: [],
    consensusPreview: [],
    consensusError: null,
  };
}

function printSummary(result) {
  const totals = getTotals(result.connectedChannels);

  console.log("");
  console.log("Live beta summary");
  console.log(`Connected channels: ${result.connectedChannels.length}`);
  console.log(`Failed channels: ${result.failedChannels.length}`);
  console.log(`Fetched messages: ${totals.fetchedMessages}`);
  console.log(`NEW_SIGNAL count: ${totals.classificationCounts.NEW_SIGNAL || 0}`);
  console.log(`UPDATE_SIGNAL count: ${totals.classificationCounts.UPDATE_SIGNAL || 0}`);
  console.log(`Consensus-ready signals: ${getConsensusReadySignalCount(result.connectedChannels)}`);

  console.log("");
  console.log("Connected channel details");
  for (const channel of result.connectedChannels) {
    console.log(
      `- ${channel.displayName} (@${channel.channel}): ${channel.fetchedMessages} messages, ` +
        formatCounts(channel.classificationCounts)
    );

    for (const example of channel.extractionExamples) {
      console.log(`  example: ${JSON.stringify(example)}`);
    }
  }

  console.log("");
  console.log("Failed channel details");
  for (const channel of result.failedChannels) {
    console.log(`- ${channel.displayName} (@${channel.channel}): ${channel.reason}`);
  }

  if (result.consensusError) {
    console.log("");
    console.log(`Consensus preview failed: ${result.consensusError}`);
  } else {
    console.log("");
    console.log(`Consensus-ready pairs: ${result.consensusPreview.length}`);
    for (const pairSummary of result.consensusPreview.slice(0, 5)) {
      console.log(
        `- ${pairSummary.pair}: ${pairSummary.consensus}, buy=${pairSummary.buySignals}, ` +
          `sell=${pairSummary.sellSignals}, duplicates=${pairSummary.duplicateSignals || 0}, ` +
          `confidence=${pairSummary.confidence}`
      );
    }
  }
}

function getTotals(channelsToCount) {
  return channelsToCount.reduce(
    (totals, channel) => {
      totals.fetchedMessages += channel.fetchedMessages;

      for (const [classification, count] of Object.entries(channel.classificationCounts)) {
        totals.classificationCounts[classification] =
          (totals.classificationCounts[classification] || 0) + count;
      }

      return totals;
    },
    {
      fetchedMessages: 0,
      classificationCounts: {},
    }
  );
}

function formatCounts(counts) {
  const entries = Object.entries(counts).filter(([classification]) => classification !== "PROMO");
  return entries.length === 0
    ? "no classified messages"
    : entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function getConsensusReadySignalCount(channelsToCount) {
  return channelsToCount.reduce((count, channel) => {
    return count + (channel.classificationCounts.NEW_SIGNAL || 0);
  }, 0);
}

function getDisplayName(channel) {
  return channelDisplayNames[channel] || channel;
}

function normalizeError(error) {
  return error?.message || String(error);
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

function getMediaType(media) {
  return media?.className || media?.constructor?.name || "unknown";
}
