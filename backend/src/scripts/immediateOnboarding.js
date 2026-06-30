import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { hydratePairStatesFromDb } from "../services/pairStateHydrationService.js";
import { startMarketEngine, stopMarketEngine } from "../services/marketEngineService.js";
import { connectTelegramWithSavedSession, resolveTelegramChannelEntity } from "../services/telegramService.js";
import { storeRawMessage } from "../services/rawMessageStore.js";
import { processRawMessage } from "../services/signalProcessingService.js";
import { logger } from "../utils/logger.js";

// Keep logs focused
logger.level = "warn";

const channelsList = [
  "https://t.me/+ua1zqZQYznRmOGNk",
  "https://t.me/+mqca6AmDO4M5ZjI0",
  "https://t.me/tradewithhuve",
  "https://t.me/Vincentgoldtreder",
  "https://t.me/Btcusdtt15",
  "https://t.me/Isabelle_QueenOfGolds",
  "https://t.me/GoldScalpingSingnals",
  "https://t.me/Goldscalper7860",
  "https://t.me/MikalTraders",
  "https://t.me/TeamPerfect1489",
  "https://t.me/+Hl8jUVLvWLw1MDc0"
];

function getChannelRef(url) {
  if (url.includes("+")) {
    return url;
  }
  const parts = url.split("/");
  return parts[parts.length - 1];
}

async function run() {
  console.log("=== Immediate Onboarding & Backfill (Batch 4) ===");
  console.log(`Total channels requested: ${channelsList.length}`);

  // Connect DB
  const dbStatus = await connectDatabase();
  if (!dbStatus.connected) {
    console.warn("[WARN] Database connection failed. Operating in memory-only fallback mode.");
  } else {
    console.log("Database connected successfully.");
  }

  // Init services
  await hydratePairStatesFromDb();
  startMarketEngine();

  // Connect Telegram
  let client;
  try {
    client = await connectTelegramWithSavedSession();
    console.log("Telegram connected successfully.");
  } catch (error) {
    console.error("Failed to connect to Telegram with saved session:", error.message);
    process.exit(1);
  }

  const successfullyAdded = [];
  const failedChannels = [];
  let totalMessagesBackfilled = 0;
  let totalParsedSignals = 0;
  const pairCounts = {};
  const failedParses = [];

  for (const url of channelsList) {
    const ref = getChannelRef(url);
    console.log(`\nResolving channel: ${ref}...`);
    try {
      const resolvedChannel = await resolveTelegramChannelEntity(client, ref);

      if (!resolvedChannel || !resolvedChannel.entity || (resolvedChannel.channelId === null && !resolvedChannel.isPrivateInvite)) {
        throw new Error("Could not resolve channel entity");
      }

      successfullyAdded.push({ url, ref, title: resolvedChannel.channelTitle });
      console.log(`[RESOLVED] Title: "${resolvedChannel.channelTitle}". Commencing 2-hour backfill...`);

      const minTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      let offsetId = 0;
      let channelFetchedCount = 0;
      let keepFetching = true;

      while (keepFetching && channelFetchedCount < 200) {
        const messages = await client.getMessages(resolvedChannel.entity, {
          limit: 50,
          offsetId,
        });

        if (messages.length === 0) {
          break;
        }

        for (const message of messages) {
          const messageDate = new Date(message.date * 1000);
          if (messageDate >= minTime) {
            channelFetchedCount++;

            const text = message.message || "";
            const hasMedia = Boolean(message.media);
            const channelTitle = resolvedChannel.channelTitle || message.chat?.title || message.sender?.username || null;

            const rawMessage = {
              channel: resolvedChannel.channelLabel,
              channelTitle,
              messageId: message.id,
              text,
              hasText: text.trim().length > 0,
              hasMedia,
              mediaType: hasMedia ? message.media.className || message.media.constructor?.name || "unknown" : null,
              textLength: text.length,
              timestamp: messageDate.toISOString(),
              fetchedAt: new Date().toISOString(),
            };

            const storeResult = await storeRawMessage(rawMessage);
            if (storeResult.stored) {
              totalMessagesBackfilled++;

              const processResult = await processRawMessage(rawMessage);
              
              if (processResult.classification && ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(processResult.classification)) {
                if (processResult.parsedSignal) {
                  totalParsedSignals++;
                  const pair = processResult.parsedSignal.pair || "unknown";
                  pairCounts[pair] = (pairCounts[pair] || 0) + 1;

                  if (processResult.parsedSignal.missingFields && processResult.parsedSignal.missingFields.length > 0) {
                    failedParses.push({
                      channel: resolvedChannel.channelLabel,
                      messageId: message.id,
                      text,
                      reason: `Partial signal: missing fields [${processResult.parsedSignal.missingFields.join(", ")}]`
                    });
                  }
                } else {
                  failedParses.push({
                    channel: resolvedChannel.channelLabel,
                    messageId: message.id,
                    text,
                    reason: `Classified as ${processResult.classification} but parsedSignal is null (missing fields / pair detection failed)`
                  });
                }
              }
            }
          } else {
            keepFetching = false;
            break;
          }
        }

        if (messages.length < 50) {
          break;
        }
        offsetId = messages[messages.length - 1].id;
      }
      
      console.log(`[BACKFILL COMPLETE] Channel @${resolvedChannel.channelLabel}: stored ${channelFetchedCount} messages.`);
    } catch (error) {
      console.error(`[ERROR] Failed resolving/backfilling ${ref}:`, error.message);
      failedChannels.push({ url, ref, reason: error.message });
    }
  }

  console.log("\n=== ONBOARDING AND BACKFILL PROCESS COMPLETED ===");
  console.log(`Total channels requested: ${channelsList.length}`);
  console.log(`Successfully added channels: ${successfullyAdded.length}`);
  console.log(`Failed/private channels: ${failedChannels.length}`);
  console.log(`Total messages backfilled: ${totalMessagesBackfilled}`);
  console.log(`Total parsed signals created: ${totalParsedSignals}`);
  console.log("Top pairs detected:", pairCounts);
  if (failedParses.length > 0) {
    console.log(`Signal formats that failed to parse completely (Count: ${failedParses.length}):`);
    failedParses.slice(0, 10).forEach((fp, idx) => {
      console.log(`\nSample ${idx + 1}: Channel: ${fp.channel}, Msg ID: ${fp.messageId}`);
      console.log(`Reason: ${fp.reason}`);
      console.log(`Text: "${fp.text.replace(/\n/g, ' ')}"`);
    });
  }

  // Shutdown services clean
  stopMarketEngine();
  await mongoose.connection.close();
  console.log("Database connection closed. Exiting process.");
}

run().catch((err) => {
  console.error("Unhanlded run failure:", err);
  process.exit(1);
});
