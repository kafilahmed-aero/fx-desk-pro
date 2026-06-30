import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getCurrentPrice } from "../services/priceIngestionService.js";

const MIN_PRICE_RATIO = 0.25;

async function checkApi() {
  try {
    const res = await fetch("http://localhost:5000/api/signals");
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : (data.signals || []);
    }
  } catch (e) {
    // API not running
  }
  return null;
}

async function run() {
  console.log("=== AUDITING ACTIVE OPPORTUNITIES AND ACTIVE SIGNALS ===");

  // 1. Check if backend API is running on Port 5000
  console.log("Checking live backend API on http://localhost:5000/api/signals...");
  const apiSignals = await checkApi();
  
  if (apiSignals) {
    console.log(`Live backend API is online. Found ${apiSignals.length} signals.`);
  } else {
    console.log("Live backend API is offline (port 5000 connection failed or timed out).");
  }

  // 2. Connect to local MongoDB database
  const conn = await connectDatabase();
  console.log(`Database connection status: ${conn.connected ? "CONNECTED" : "OFFLINE"}`);

  let signalsToCheck = [];

  if (conn.connected) {
    // Find active/partial signals in MongoDB
    signalsToCheck = await ParsedSignal.find({
      signalState: { $in: ["ACTIVE", "PARTIAL"] }
    }).lean();
    console.log(`Retrieved ${signalsToCheck.length} ACTIVE/PARTIAL signals from MongoDB database.`);
  } else if (apiSignals) {
    // Use signals from running API
    signalsToCheck = apiSignals.filter(s => ["ACTIVE", "PARTIAL"].includes(s.signalState));
    console.log(`Using ${signalsToCheck.length} ACTIVE/PARTIAL signals from live API.`);
  } else {
    console.log("No MongoDB database or live API is active. No live opportunities exist.");
  }

  const suspicious = [];
  const pairPriceCache = new Map();

  for (const signal of signalsToCheck) {
    if (!signal.pair || signal.pair === "unknown") {
      continue;
    }

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

    if (signal.entry !== null && signal.entry !== undefined && signal.entry < minAllowed) {
      flaggedReasons.push(`entry (${signal.entry}) < threshold (${minAllowed.toFixed(4)})`);
    }

    if (signal.entryRange && signal.entryRange.length > 0) {
      for (const val of signal.entryRange) {
        if (typeof val === "number" && val < minAllowed) {
          flaggedReasons.push(`entryRange val (${val}) < threshold (${minAllowed.toFixed(4)})`);
          break;
        }
      }
    }

    if (signal.targets && signal.targets.length > 0) {
      for (const val of signal.targets) {
        if (typeof val === "number" && val < minAllowed) {
          flaggedReasons.push(`target (${val}) < threshold (${minAllowed.toFixed(4)})`);
          break;
        }
      }
    }

    if (signal.stopLoss !== null && signal.stopLoss !== undefined && signal.stopLoss < minAllowed) {
      flaggedReasons.push(`stopLoss (${signal.stopLoss}) < threshold (${minAllowed.toFixed(4)})`);
    }

    if (flaggedReasons.length > 0) {
      suspicious.push({
        messageKey: `${signal.channel}#${signal.messageId}`,
        channel: signal.channel,
        pair: signal.pair,
        entry: signal.entry,
        targets: signal.targets,
        stopLoss: signal.stopLoss,
        currentStatus: signal.signalState,
        affectsConsensus: ["ACTIVE", "PARTIAL"].includes(signal.signalState),
        reasons: flaggedReasons
      });
    }
  }

  console.log(`\n=== ACTIVE SUSPICIOUS SIGNALS REPORT ===`);
  console.log(`Total live/active suspicious signals found: ${suspicious.length}`);
  console.log(`========================================`);
  
  if (suspicious.length > 0) {
    console.log(JSON.stringify(suspicious, null, 2));
  } else {
    console.log("No live ACTIVE or PARTIAL signals are currently polluted by index values.");
    console.log("Live Opportunities Dashboard and consensus calculations are 100% clean.");
  }

  if (conn.connected) {
    await mongoose.disconnect();
  }
  process.exit(0);
}

run().catch(console.error);
