import "dotenv/config";
import { connectTelegramWithSavedSession, resolveTelegramChannelEntity } from "../services/telegramService.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";

async function run() {
  console.log("Connecting Telegram...");
  try {
    const client = await connectTelegramWithSavedSession();
    console.log("Connected. Resolving arixanderxx7...");
    const resolved = await resolveTelegramChannelEntity(client, "arixanderxx7");
    console.log("Resolved. Fetching last 50 messages...");
    const messages = await client.getMessages(resolved.entity, { limit: 50 });
    console.log(`Fetched ${messages.length} messages.\n`);

    let total = messages.length;
    let nonGoldCount = 0;
    let goldCount = 0;
    let emptyOrNoise = 0;
    let parseableIfGoldAssumed = 0;

    const auditResults = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const text = msg.message || "";
      if (!text.trim()) {
        emptyOrNoise++;
        continue;
      }

      // Check if any non-gold instrument name is in the text
      const nonGoldPattern = /\b(EUR|GBP|JPY|AUD|NZD|CAD|CHF|BTC|ETH|SOL|US30|NAS100|SPX500|WTI|BRENT|NATGAS)\b/i;
      const goldPattern = /\b(XAU|GOLD)\b/i;

      const hasNonGold = nonGoldPattern.test(text);
      const hasGold = goldPattern.test(text);

      if (hasNonGold) {
        nonGoldCount++;
      } else if (hasGold) {
        goldCount++;
      }

      const rawMessage = {
        channel: "arixanderxx7",
        messageId: msg.id,
        text: text,
        hasText: true,
        timestamp: new Date(msg.date * 1000).toISOString(),
      };

      const classificationResult = classifyMessage(rawMessage);
      
      const parsedAsIs = parseSignalMessage(rawMessage, classificationResult.classification);
      const isAsIsParseable = parsedAsIs && parsedAsIs.pair !== "unknown" && parsedAsIs.parserClassification !== "NOISE";

      // Simulate default pair behavior
      const rawMessageWithGold = {
        ...rawMessage,
        text: "XAUUSD\n" + text,
      };
      const classificationWithGold = classifyMessage(rawMessageWithGold);
      const parsedWithGold = parseSignalMessage(rawMessageWithGold, classificationWithGold.classification);
      const isWithGoldParseable = parsedWithGold && parsedWithGold.pair !== "unknown" && parsedWithGold.parserClassification !== "NOISE";

      let parseResult = "NOISE";
      if (isAsIsParseable) {
        parseResult = "PARSEABLE_AS_IS";
      } else if (isWithGoldParseable) {
        parseResult = "PARSEABLE_WITH_DEFAULT_PAIR";
        parseableIfGoldAssumed++;
      }

      auditResults.push({
        id: msg.id,
        date: new Date(msg.date * 1000).toISOString(),
        text: text.replace(/\n/g, " | "),
        classification: classificationResult.classification,
        hasGold,
        hasNonGold,
        parseResult,
        parsedFields: isWithGoldParseable ? {
          action: parsedWithGold.action,
          entry: parsedWithGold.entry,
          targets: parsedWithGold.targets,
          stopLoss: parsedWithGold.stopLoss
        } : null
      });
    }

    console.log("=== AUDIT SUMMARY ===");
    console.log(`Total messages processed: ${total}`);
    console.log(`Empty/pure noise messages: ${emptyOrNoise}`);
    console.log(`Messages with explicit Gold reference: ${goldCount}`);
    console.log(`Messages with explicit Non-Gold reference: ${nonGoldCount}`);
    console.log(`Messages parseable as-is: ${auditResults.filter(r => r.parseResult === "PARSEABLE_AS_IS").length}`);
    console.log(`Messages parseable if XAUUSD assumed: ${parseableIfGoldAssumed}`);
    console.log(`Estimated Parser Improvement: +${((parseableIfGoldAssumed / total) * 100).toFixed(2)}%\n`);

    console.log("=== MESSAGE LOGS (Last 50) ===");
    auditResults.forEach(r => {
      console.log(`[ID ${r.id}] [${r.parseResult}] ${r.text}`);
      if (r.parsedFields) {
        console.log(`   -> Parsed: Action=${r.parsedFields.action}, Entry=${r.parsedFields.entry}, TP=${JSON.stringify(r.parsedFields.targets)}, SL=${r.parsedFields.stopLoss}`);
      }
    });

  } catch (error) {
    console.error("Audit failed:", error);
  }
}

run();
