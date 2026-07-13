import "dotenv/config";
import { connectTelegramWithSavedSession } from "../src/services/telegramService.js";
import { processRawMessage } from "../src/services/signalProcessingService.js";

function getMediaType(media) {
  return media?.className || media?.constructor?.name || null;
}

function formatMessageDate(date) {
  if (date instanceof Date) return date.toISOString();
  if (typeof date === "number") return new Date(date * 1000).toISOString();
  return null;
}

async function main() {
  console.log("Connecting Telegram client...");
  const client = await connectTelegramWithSavedSession();
  
  console.log("Fetching dialogs...");
  const dialogs = await client.getDialogs();
  
  let targetEntity = null;
  for (const d of dialogs) {
    if (d.title && d.title.includes("Fx-test-feed")) {
      targetEntity = d.entity;
      break;
    }
  }

  if (!targetEntity) {
    try {
      console.log("Attempting to get channel entity by ID...");
      targetEntity = await client.getEntity(-1003955968449);
    } catch (e) {
      console.log("Could not get by ID:", e.message);
    }
  }

  if (!targetEntity) {
    throw new Error("Could not find Fx-test-feed channel.");
  }

  console.log(`Resolved: ${targetEntity.title || targetEntity.id}`);

  console.log("Fetching latest messages...");
  const messages = await client.getMessages(targetEntity, { limit: 5 });
  console.log(`Fetched ${messages.length} messages.`);

  for (const message of messages) {
    const text = message.message || "";
    const hasMedia = Boolean(message.media);
    const rawMessage = {
      channel: "Fx-test-feed",
      channelTitle: "Fx-test-feed",
      messageId: message.id,
      text,
      hasText: text.trim().length > 0,
      hasMedia,
      mediaType: hasMedia ? getMediaType(message.media) : null,
      textLength: text.length,
      timestamp: formatMessageDate(message.date),
      fetchedAt: new Date().toISOString(),
    };

    console.log(`\n========================================`);
    console.log(`Processing message ID ${rawMessage.messageId}:`);
    console.log(`Text:\n"""\n${rawMessage.text}\n"""`);
    
    console.log("Running pipeline processing...");
    const result = await processRawMessage(rawMessage);
    
    console.log("\nPipeline Results:");
    console.log("Classification:", result.classification);
    if (result.parsedSignal) {
      console.log("Parsed Signal Fields:");
      console.log("- Pair detected:", result.parsedSignal.pair);
      console.log("- Action:", result.parsedSignal.action);
      console.log("- Bias:", result.parsedSignal.bias);
      console.log("- Entry:", result.parsedSignal.entry);
      console.log("- Stop Loss:", result.parsedSignal.stopLoss);
      console.log("- Take Profit targets:", result.parsedSignal.targets);
      console.log("- Extraction Confidence:", result.parsedSignal.extractionConfidence);
      console.log("- Is Test Signal:", result.parsedSignal.isTestSignal);
    } else {
      console.log("No signal parsed (message skipped or classified as noise/promo).");
    }
    console.log(`========================================\n`);
  }

  process.exit(0);
}

main().catch(console.error);
