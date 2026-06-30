import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getCurrentPrice } from "../services/priceIngestionService.js";

const MIN_PRICE_RATIO = 0.25;

async function run() {
  console.log("=== STARTING SUSPICIOUS SIGNALS DB/FILE AUDIT ===");
  const conn = await connectDatabase();
  console.log(`Database connection status: ${conn.connected ? "CONNECTED" : "OFFLINE"} ${conn.error || ""}`);

  try {
    let signals = [];

    if (conn.connected) {
      // Query MongoDB
      signals = await ParsedSignal.find({
        signalState: { $in: ["ACTIVE", "PARTIAL"] }
      }).lean();
      console.log(`Retrieved ${signals.length} ACTIVE/PARTIAL signals from MongoDB.`);
    } else {
      // Fallback: Read local suspicious audits file
      console.log("Database offline. Falling back to local file 'suspicious_audits.json'...");
      const file = "suspicious_audits.json";
      if (fs.existsSync(file)) {
        const content = JSON.parse(fs.readFileSync(file, "utf8"));
        console.log(`Read ${content.length} suspicious records from ${file}.`);
        for (const item of content) {
          if (item.parsed) {
            signals.push({
              channel: item.channel,
              messageId: item.parsed.messageId || Math.floor(Math.random() * 100000),
              rawText: item.rawText,
              pair: item.parsed.pair,
              entry: item.parsed.entry,
              entryRange: item.parsed.entryRange,
              targets: item.parsed.targets,
              stopLoss: item.parsed.stopLoss,
              signalState: "ACTIVE"
            });
          }
        }
      } else {
        console.warn(`File ${file} does not exist locally.`);
      }
    }

    console.log(`Analyzing ${signals.length} parsed signals against live market prices...`);

    const suspicious = [];
    const pairPriceCache = new Map();

    for (const signal of signals) {
      if (!signal.pair || signal.pair === "unknown") {
        continue;
      }

      // Fetch or cache current price
      let currentPrice = pairPriceCache.get(signal.pair);
      if (currentPrice === undefined) {
        try {
          const priceInfo = await getCurrentPrice(signal.pair);
          currentPrice = priceInfo?.price || null;
        } catch (e) {
          currentPrice = null;
        }
        pairPriceCache.set(signal.pair, currentPrice);
      }

      if (!currentPrice) {
        continue;
      }

      const minAllowed = currentPrice * MIN_PRICE_RATIO;
      const flaggedReasons = [];

      // Check entry
      if (signal.entry !== null && signal.entry !== undefined && signal.entry < minAllowed) {
        flaggedReasons.push(`entry (${signal.entry}) < threshold (${minAllowed.toFixed(4)})`);
      }

      // Check entryRange
      if (signal.entryRange && signal.entryRange.length > 0) {
        for (const val of signal.entryRange) {
          if (typeof val === "number" && val < minAllowed) {
            flaggedReasons.push(`entryRange val (${val}) < threshold (${minAllowed.toFixed(4)})`);
            break;
          }
        }
      }

      // Check targets
      if (signal.targets && signal.targets.length > 0) {
        for (const val of signal.targets) {
          if (typeof val === "number" && val < minAllowed) {
            flaggedReasons.push(`target (${val}) < threshold (${minAllowed.toFixed(4)})`);
            break;
          }
        }
      }

      // Check stopLoss
      if (signal.stopLoss !== null && signal.stopLoss !== undefined && signal.stopLoss < minAllowed) {
        flaggedReasons.push(`stopLoss (${signal.stopLoss}) < threshold (${minAllowed.toFixed(4)})`);
      }

      if (flaggedReasons.length > 0) {
        suspicious.push({
          messageKey: `${signal.channel}#${signal.messageId}`,
          channel: signal.channel,
          rawText: signal.rawText || signal.normalizedText,
          parsedValues: {
            pair: signal.pair,
            entry: signal.entry,
            entryRange: signal.entryRange,
            targets: signal.targets,
            stopLoss: signal.stopLoss,
            signalState: signal.signalState
          },
          currentPrice,
          reasons: flaggedReasons
        });
      }
    }

    console.log(`\n=== SUSPICIOUS SIGNALS REPORT ===`);
    console.log(`Total suspicious signals found: ${suspicious.length}`);
    console.log(`=================================`);
    
    if (suspicious.length > 0) {
      console.log(JSON.stringify(suspicious.slice(0, 50), null, 2));
      if (suspicious.length > 50) {
        console.log(`... and ${suspicious.length - 50} more records.`);
      }
    }
  } catch (error) {
    console.error("Audit failed:", error);
  } finally {
    if (conn.connected) {
      await mongoose.disconnect();
    }
    process.exit(0);
  }
}

run();
