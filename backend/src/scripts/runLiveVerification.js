import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { config } from "../config/env.js";
import { RawMessage } from "../models/rawMessageModel.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { getTelegramIngestionMetrics } from "../services/telegramIngestionService.js";
import { isPriceMonitoringRunning } from "../services/priceMonitoringScheduler.js";

async function runVerification() {
  console.log("=== STARTING LIVE DATA COLLECTION VERIFICATION ===\n");

  // 1. Connect to Database
  const dbStatus = await connectDatabase();
  if (!dbStatus.connected) {
    console.error(`[ERROR] MongoDB is offline: ${dbStatus.error}. Cannot query live data.`);
    process.exit(1);
  }

  console.log("Database connected successfully.\n");

  // 2. Signal Ingestion Status
  const ingestionMetrics = getTelegramIngestionMetrics();
  console.log("--- SIGNAL INGESTION ---");
  console.log(`- Connection Status (Listener Running): ${ingestionMetrics.listenerRunning}`);
  console.log(`- Polling in Progress: ${ingestionMetrics.pollingInProgress}`);
  console.log(`- Total Configured Channels Monitored: ${ingestionMetrics.configuredChannels}`);
  console.log(`- Monitored Channels List: ${config.telegram.channels.join(", ")}`);
  
  if (ingestionMetrics.startupChannelReport) {
    console.log(`  * Active channels resolved on boot: ${ingestionMetrics.startupChannelReport.activeChannels?.length || 0}`);
    console.log(`  * Inaccessible channels: ${ingestionMetrics.startupChannelReport.inaccessibleChannels?.length || 0}`);
  }

  // Get last message received per channel
  const rawChannels = await RawMessage.aggregate([
    {
      $group: {
        _id: "$channel",
        totalRawMessages: { $sum: 1 },
        lastReceivedAt: { $max: "$timestamp" },
      }
    }
  ]);

  console.log("\n- Ingested Raw Messages per Channel:");
  if (rawChannels.length === 0) {
    console.log("  No raw messages ingested yet.");
  } else {
    rawChannels.forEach((ch) => {
      console.log(`  * ${ch._id}: ${ch.totalRawMessages} messages (Last Received: ${ch.lastReceivedAt ? new Date(ch.lastReceivedAt).toISOString() : "N/A"})`);
    });
  }

  // 3. LIVE Parsed Signals
  // Filter out fixture channels
  const fixtureChannels = new Set([
    "torture-test-suite",
    "clean-complete-signals",
    "market-commentary-signals",
    "update-result-signals",
    "partial-incomplete-signals",
    "short-fast-signals",
    "promo-noise-signals",
  ]);

  // We define LIVE parsed signals as signals where isTestSignal === false OR channel is not in fixture list
  const liveParsedQuery = {
    channel: { $nin: Array.from(fixtureChannels) },
    isTestSignal: { $ne: true }
  };

  const totalLiveParsed = await ParsedSignal.countDocuments(liveParsedQuery);
  const liveParsedSignals = await ParsedSignal.find(liveParsedQuery).sort({ timestamp: 1 }).lean();

  console.log("\n--- LIVE PARSED SIGNALS ---");
  console.log(`- Total LIVE ParsedSignal records: ${totalLiveParsed}`);

  if (totalLiveParsed > 0) {
    const earliestLive = liveParsedSignals[0].timestamp || liveParsedSignals[0].createdAt;
    const latestLive = liveParsedSignals[liveParsedSignals.length - 1].timestamp || liveParsedSignals[liveParsedSignals.length - 1].createdAt;
    
    console.log(`- Earliest LIVE signal: ${new Date(earliestLive).toISOString()}`);
    console.log(`- Latest LIVE signal: ${new Date(latestLive).toISOString()}`);

    // Grouped by channel
    const channelGroups = {};
    const pairGroups = {};

    liveParsedSignals.forEach((sig) => {
      const ch = sig.channel || "unknown";
      const pair = sig.pair || "unknown";
      channelGroups[ch] = (channelGroups[ch] || 0) + 1;
      pairGroups[pair] = (pairGroups[pair] || 0) + 1;
    });

    console.log("- LIVE Signals grouped by channel:");
    Object.entries(channelGroups).sort((a, b) => b[1] - a[1]).forEach(([ch, count]) => {
      console.log(`  * ${ch}: ${count}`);
    });

    console.log("- LIVE Signals grouped by pair:");
    Object.entries(pairGroups).sort((a, b) => b[1] - a[1]).forEach(([pair, count]) => {
      console.log(`  * ${pair}: ${count}`);
    });
  } else {
    console.log("  No LIVE parsed signals found.");
  }

  // 4. LIVE Outcome Tracking
  // We can query outcomes matching the live parsed query by linking via signalId or matching channel
  const liveOutcomeQuery = {
    channel: { $nin: Array.from(fixtureChannels) }
  };

  const totalLiveOutcomes = await SignalOutcome.countDocuments(liveOutcomeQuery);
  const liveOutcomes = await SignalOutcome.find(liveOutcomeQuery).lean();

  console.log("\n--- LIVE OUTCOME TRACKING ---");
  console.log(`- Total LIVE SignalOutcome records: ${totalLiveOutcomes}`);

  if (totalLiveOutcomes > 0) {
    const statusCounts = {
      PENDING: 0,
      ACTIVE: 0,
      PARTIAL_TP: 0,
      FULL_TP: 0,
      SL_HIT: 0,
      EXPIRED: 0,
      CANCELLED: 0
    };

    liveOutcomes.forEach((o) => {
      if (statusCounts[o.status] !== undefined) {
        statusCounts[o.status]++;
      }
    });

    console.log("- Outcome Status Breakdown:");
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  * ${status}: ${count}`);
    });
  } else {
    console.log("  No LIVE outcomes found.");
  }

  // 5. Price Monitoring Status
  console.log("\n--- PRICE MONITORING STATUS ---");
  console.log(`- Scheduler Running: ${isPriceMonitoringRunning()}`);
  
  const activePendingOutcomes = await SignalOutcome.find({
    status: { $in: ["PENDING", "ACTIVE", "PARTIAL_TP"] }
  }).lean();
  
  const liveActivePending = activePendingOutcomes.filter(o => !fixtureChannels.has(o.channel));
  const uniqueLivePairs = [...new Set(liveActivePending.map(o => o.pair))];
  
  console.log(`- Active/Pending LIVE Outcomes Monitored: ${liveActivePending.length}`);
  console.log(`- Unique LIVE Pairs Monitored: ${uniqueLivePairs.length} (${uniqueLivePairs.join(", ") || "none"})`);

  // 6. End-to-End Pipeline Validation
  console.log("\n--- END-TO-END PIPELINE VALIDATION ---");
  const sampleLiveParsed = await ParsedSignal.findOne({
    channel: { $nin: Array.from(fixtureChannels) },
    classification: "NEW_SIGNAL"
  }).sort({ createdAt: -1 }).lean();

  if (sampleLiveParsed) {
    console.log("[OK] Found recent live signal candidate:");
    console.log(`  * Signal ID: ${sampleLiveParsed._id}`);
    console.log(`  * Channel: ${sampleLiveParsed.channel}`);
    console.log(`  * Message ID: ${sampleLiveParsed.messageId}`);
    console.log(`  * Pair: ${sampleLiveParsed.pair}`);
    console.log(`  * Timestamp: ${new Date(sampleLiveParsed.timestamp || sampleLiveParsed.createdAt).toISOString()}`);

    // Trace 1: Raw Message
    const traceRaw = await RawMessage.findOne({
      channel: sampleLiveParsed.channel,
      messageId: sampleLiveParsed.messageId
    }).lean();

    if (traceRaw) {
      console.log(`  [OK] Link 1/2: RawMessage matches channel + messageId.`);
      console.log(`       Raw Text: "${traceRaw.text.replace(/\n/g, " ")}"`);
    } else {
      console.log(`  [FAIL] Link 1/2: RawMessage NOT found for channel + messageId.`);
    }

    // Trace 2: SignalOutcome
    const traceOutcome = await SignalOutcome.findOne({
      signalId: sampleLiveParsed._id
    }).lean();

    if (traceOutcome) {
      console.log(`  [OK] Link 2/2: SignalOutcome exists referencing signalId.`);
      console.log(`       Outcome Status: ${traceOutcome.status}`);
      console.log(`       Outcome Expires At: ${new Date(traceOutcome.expiresAt).toISOString()}`);
    } else {
      console.log(`  [FAIL] Link 2/2: SignalOutcome NOT found referencing signalId.`);
    }
  } else {
    console.log("  No live signals found to perform end-to-end validation tracing.");
  }

  await mongoose.disconnect();
  console.log("\n=== VERIFICATION COMPLETE ===");
}

runVerification().catch((err) => {
  console.error("Verification script crashed:", err);
});
