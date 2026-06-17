import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { classifyMessage } from "../parsers/noiseFilter.js";

function isActionable(classification) {
  return ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(classification);
}

async function run() {
  console.log("=== STARTING HISTORICAL RECLASSIFICATION AUDIT (READ-ONLY) ===");

  const dbStatus = await connectDatabase();
  if (!dbStatus.connected) {
    console.error("Database connection failed. Exiting.");
    process.exit(1);
  }

  try {
    const signals = await ParsedSignal.find({}).lean();
    console.log(`Loaded ${signals.length} historical parsed signals from database.\n`);

    let xauusdToDxy = [];
    let xauusdToUnknown = [];
    let unknownToDxy = [];
    let validToUnknown = [];
    let generalChanges = [];

    let beforeActionableCount = 0;
    let afterActionableCount = 0;
    let beforeSuccessCount = 0;
    let afterSuccessCount = 0;

    for (const doc of signals) {
      const rawMessage = {
        channel: doc.channel,
        messageId: doc.messageId,
        text: doc.rawText,
        hasMedia: doc.textStats?.hasMedia || false,
        timestamp: doc.timestamp || doc.createdAt,
      };

      // 1. Evaluate "Before" State (stored in DB)
      const oldClassification = doc.parserClassification || doc.classification;
      const oldPair = doc.pair || "unknown";

      if (isActionable(oldClassification)) {
        beforeActionableCount++;
        if (oldPair && oldPair !== "unknown") {
          beforeSuccessCount++;
        }
      }

      // 2. Evaluate "After" State (run through the new logic)
      const newClassificationResult = classifyMessage(rawMessage);
      const newClassification = newClassificationResult.classification;
      
      const parsed = isActionable(newClassification)
        ? parseSignalMessage(rawMessage, newClassification)
        : null;

      const newPair = parsed?.pair || "unknown";

      if (isActionable(newClassification)) {
        afterActionableCount++;
        if (newPair && newPair !== "unknown") {
          afterSuccessCount++;
        }
      }

      // Detect reclassification changes
      if (oldPair !== newPair) {
        const changeInfo = {
          channel: doc.channel,
          messageId: doc.messageId,
          oldPair,
          newPair,
          text: doc.rawText,
        };

        if (oldPair === "XAUUSD" && newPair === "DXY") {
          xauusdToDxy.push(changeInfo);
        } else if (oldPair === "XAUUSD" && newPair === "unknown") {
          xauusdToUnknown.push(changeInfo);
        } else if (oldPair === "unknown" && newPair === "DXY") {
          unknownToDxy.push(changeInfo);
        } else if (oldPair !== "unknown" && newPair === "unknown") {
          validToUnknown.push(changeInfo);
        } else {
          generalChanges.push(changeInfo);
        }
      }
    }

    // Report aggregate counts
    console.log("=== AGGREGATE COUNTS ===");
    console.log(`- XAUUSD -> DXY: ${xauusdToDxy.length}`);
    console.log(`- XAUUSD -> UNKNOWN: ${xauusdToUnknown.length}`);
    console.log(`- UNKNOWN -> DXY: ${unknownToDxy.length}`);
    console.log(`- VALID_PAIR -> UNKNOWN (False-Positive Check): ${validToUnknown.length}`);
    console.log(`- General Pair Changes: ${generalChanges.length}`);
    console.log(`- Total Parsed Actionable Signals Before: ${beforeActionableCount}`);
    console.log(`- Total Parsed Actionable Signals After: ${afterActionableCount}`);
    
    const beforeSuccessRate = signals.length > 0 ? (beforeSuccessCount / signals.length) * 100 : 0;
    const afterSuccessRate = signals.length > 0 ? (afterSuccessCount / signals.length) * 100 : 0;
    
    console.log(`- Success Count Before: ${beforeSuccessCount} (Rate: ${beforeSuccessRate.toFixed(2)}%)`);
    console.log(`- Success Count After: ${afterSuccessCount} (Rate: ${afterSuccessRate.toFixed(2)}%)`);
    console.log(`- Net Actionable Signal Count Change: ${afterActionableCount - beforeActionableCount}`);
    console.log(`- Net Success Rate Change: ${(afterSuccessRate - beforeSuccessRate).toFixed(2)}%\n`);

    // Report Reclassification Examples (up to 20)
    console.log("=== SAMPLE RECLASSIFICATION REPORTS (Max 20) ===");
    const allExamples = [...xauusdToDxy, ...xauusdToUnknown, ...unknownToDxy, ...generalChanges];
    const sampleExamples = allExamples.slice(0, 20);

    sampleExamples.forEach((ex, idx) => {
      console.log(`\nExample ${idx + 1}:`);
      console.log(`${ex.oldPair} -> ${ex.newPair}`);
      console.log(`Channel: ${ex.channel}`);
      console.log(`MessageId: ${ex.messageId}`);
      console.log("Message Preview:");
      console.log(`"${(ex.text || "").replace(/\n/g, " ").substring(0, 200)}..."`);
    });

    if (sampleExamples.length === 0) {
      console.log("No pair reclassification examples found.");
    }

    // Report False-Positive Safety Audit (VALID_PAIR -> UNKNOWN)
    console.log("\n=== FALSE-POSITIVE SAFETY AUDIT ===");
    console.log(`Total VALID_PAIR -> UNKNOWN: ${validToUnknown.length}`);
    
    const channelsAffected = [...new Set(validToUnknown.map(ex => ex.channel))];
    console.log(`Channels affected: [${channelsAffected.join(", ") || "none"}]`);

    validToUnknown.forEach((ex, idx) => {
      console.log(`\nFalse Positive Example ${idx + 1}:`);
      console.log(`${ex.oldPair} -> ${ex.newPair}`);
      console.log(`Channel: ${ex.channel}`);
      console.log(`MessageId: ${ex.messageId}`);
      console.log("Message Preview:");
      console.log(`"${(ex.text || "").replace(/\n/g, " ").substring(0, 200)}..."`);
    });

    if (validToUnknown.length === 0) {
      console.log("No false-positive regressions detected (0 VALID_PAIR -> UNKNOWN transitions).");
    }

  } catch (err) {
    console.error("Audit query error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nHistorical reclassification audit complete.");
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
});
