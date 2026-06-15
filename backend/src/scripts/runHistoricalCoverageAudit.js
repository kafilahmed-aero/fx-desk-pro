import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureRoot = path.resolve(__dirname, "../../test-messages");

const actionableClassifications = new Set([
  "NEW_SIGNAL",
  "UPDATE_SIGNAL",
  "RESULT_SIGNAL",
  "MARKET_ANALYSIS",
]);

async function runAudit() {
  console.log("=== STARTING HISTORICAL SIGNAL COVERAGE AUDIT ===");

  let parsedSignalsList = [];
  let source = "";

  // 1. Try to connect to Database
  const dbStatus = await connectDatabase();
  if (dbStatus.connected) {
    try {
      console.log("Database connected. Fetching ParsedSignal records from MongoDB...");
      const docs = await ParsedSignal.find({}).lean();
      parsedSignalsList = docs.map(doc => ({
        channel: doc.channel,
        pair: doc.pair,
        timestamp: doc.timestamp || doc.createdAt,
        entry: doc.entry,
        entryRange: doc.entryRange,
        targets: doc.targets,
        stopLoss: doc.stopLoss,
        classification: doc.classification || doc.parserClassification,
        action: doc.action,
      }));
      source = "MongoDB";
    } catch (err) {
      console.warn(`[WARN] Database fetch failed: ${err.message}. Falling back to fixtures.`);
    }
  }

  // 2. Fallback to Local Fixtures
  if (parsedSignalsList.length === 0) {
    console.log("Database offline or empty. Auditing historical test-messages datasets...");
    
    // Load JSON files from test-messages/ (excluding baseline)
    const files = fs.readdirSync(fixtureRoot)
      .filter((file) => file.endsWith(".json"))
      .filter((file) => file !== "regression-baseline.json");

    let totalExamples = 0;
    for (const file of files) {
      const filePath = path.join(fixtureRoot, file);
      try {
        const fixtures = JSON.parse(fs.readFileSync(filePath, "utf8"));
        totalExamples += fixtures.length;

        fixtures.forEach((fixture, index) => {
          const rawMessage = {
            channel: fixture.rawMessage?.channel || file.replace(".json", ""),
            messageId: fixture.rawMessage?.messageId || index + 1,
            text: fixture.rawMessage?.text ?? fixture.rawText ?? "",
            timestamp: fixture.rawMessage?.timestamp || new Date().toISOString(),
          };

          const classificationResult = classifyMessage(rawMessage);
          const parsed = actionableClassifications.has(classificationResult.classification)
            ? parseSignalMessage(rawMessage, classificationResult.classification)
            : null;

          if (parsed) {
            parsedSignalsList.push({
              channel: parsed.channel || rawMessage.channel,
              pair: parsed.pair,
              timestamp: parsed.timestamp || rawMessage.timestamp,
              entry: parsed.entry,
              entryRange: parsed.entryRange,
              targets: parsed.targets,
              stopLoss: parsed.stopLoss,
              classification: parsed.classification || classificationResult.classification,
              action: parsed.action,
            });
          }
        });
      } catch (err) {
        console.error(`Error loading or parsing fixture ${file}: ${err.message}`);
      }
    }
    console.log(`Loaded and parsed ${parsedSignalsList.length} signals from ${totalExamples} raw messages.`);
    source = "Fixtures Dataset";
  }

  // 3. Compute Metrics
  const totalRecords = parsedSignalsList.length;
  
  let earliestDate = null;
  let latestDate = null;
  const channelCounts = {};
  const pairCounts = {};
  
  let hasAllFieldsCount = 0; // Contains pair, action, entry, targets, stopLoss
  let replayableSignalsCount = 0;
  const replayableByChannel = {};
  const replayableByPair = {};

  parsedSignalsList.forEach((sig) => {
    // Dates
    if (sig.timestamp) {
      const d = new Date(sig.timestamp);
      if (!isNaN(d.getTime())) {
        if (!earliestDate || d < earliestDate) earliestDate = d;
        if (!latestDate || d > latestDate) latestDate = d;
      }
    }

    // Channels Grouping
    const ch = sig.channel || "unknown";
    channelCounts[ch] = (channelCounts[ch] || 0) + 1;

    // Pairs Grouping
    const pr = sig.pair || "unknown";
    pairCounts[pr] = (pairCounts[pr] || 0) + 1;

    // Field Checks
    const hasPair = sig.pair !== null && sig.pair !== undefined && sig.pair !== "unknown";
    const hasAction = sig.action !== null && sig.action !== undefined;
    const hasEntry = sig.entry !== null && sig.entry !== undefined;
    const hasEntryRange = Array.isArray(sig.entryRange) && sig.entryRange.length > 0;
    const hasTargets = Array.isArray(sig.targets) && sig.targets.length > 0;
    const hasStopLoss = sig.stopLoss !== null && sig.stopLoss !== undefined;

    // Report requirement 6: contains pair, action, entry, targets, stopLoss
    if (hasPair && hasAction && hasEntry && hasTargets && hasStopLoss) {
      hasAllFieldsCount++;
    }

    // Report requirement 7: Replay Eligibility Check
    // Contains: pair, action, entry or entryRange, at least one target, stopLoss
    if (
      hasPair &&
      hasAction &&
      (hasEntry || hasEntryRange) &&
      hasTargets &&
      hasStopLoss
    ) {
      replayableSignalsCount++;
      replayableByChannel[ch] = (replayableByChannel[ch] || 0) + 1;
      replayableByPair[pr] = (replayableByPair[pr] || 0) + 1;
    }
  });

  // Sort groupings for nice reporting
  const sortedChannels = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]);
  const sortedPairs = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]);
  const sortedReplayChannels = Object.entries(replayableByChannel).sort((a, b) => b[1] - a[1]);
  const sortedReplayPairs = Object.entries(replayableByPair).sort((a, b) => b[1] - a[1]);

  console.log("\n================ AUDIT REPORT ================");
  console.log(`Source: ${source}`);
  console.log(`1. Total ParsedSignal records: ${totalRecords}`);
  console.log(`2. Earliest signal timestamp: ${earliestDate ? earliestDate.toISOString() : "N/A"}`);
  console.log(`3. Latest signal timestamp: ${latestDate ? latestDate.toISOString() : "N/A"}`);
  
  console.log("\n4. Signals grouped by channel:");
  sortedChannels.forEach(([ch, count]) => {
    console.log(`   - ${ch}: ${count}`);
  });

  console.log("\n5. Signals grouped by pair:");
  sortedPairs.forEach(([pr, count]) => {
    console.log(`   - ${pr}: ${count}`);
  });

  console.log("\n6. Signals containing (pair, action, entry, targets, stopLoss):");
  console.log(`   - Count: ${hasAllFieldsCount}`);

  console.log("\n7. Replay Eligibility Analysis:");
  console.log(`   - Total replayable signals: ${replayableSignalsCount}`);
  
  console.log("\n8. Replayable signals by channel:");
  sortedReplayChannels.forEach(([ch, count]) => {
    console.log(`   - ${ch}: ${count}`);
  });

  console.log("\n   Replayable signals by pair:");
  sortedReplayPairs.forEach(([pr, count]) => {
    console.log(`   - ${pr}: ${count}`);
  });
  console.log("==============================================");

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
}

runAudit().catch((err) => {
  console.error("Audit crashed:", err);
});
