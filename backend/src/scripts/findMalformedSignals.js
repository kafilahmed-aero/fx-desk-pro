import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";

async function run() {
  const conn = await connectDatabase();
  if (!conn.connected) {
    console.error("Failed to connect to database:", conn.error);
    process.exit(1);
  }

  try {
    const signals = await ParsedSignal.find({
      $and: [
        { entryRange: { $exists: true } },
        { entryRange: { $size: 2 } }
      ]
    }).lean();

    const malformed = [];
    for (const signal of signals) {
      const min = Math.min(...signal.entryRange);
      const max = Math.max(...signal.entryRange);
      const diff = max - min;
      
      // If the difference is huge (e.g., > 1000), it's likely a malformed range
      if (diff > 1000) {
        malformed.push(signal);
      }
    }

    console.log(`Found ${malformed.length} malformed signals:`);
    for (const signal of malformed) {
      console.log(JSON.stringify({
        channel: signal.channel,
        channelTitle: signal.channelTitle,
        messageId: signal.messageId,
        timestamp: signal.timestamp || signal.createdAt,
        rawText: signal.rawText,
        entry: signal.entry,
        entryRange: signal.entryRange,
        targets: signal.targets,
        stopLoss: signal.stopLoss
      }, null, 2));
    }
  } catch (error) {
    console.error("Query failed:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
