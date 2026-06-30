import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import readline from "readline";
import { ParsedSignal } from "../models/parsedSignalModel.js";

async function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

function checkIsBadSignal(signal) {
  const entry = signal.entry || null;
  const entryRange = signal.entryRange || [];
  const stopLoss = signal.stopLoss || null;
  const targets = signal.targets || [];

  let isBad = false;
  const reasons = [];

  if (entry !== null && entry > 0 && entry <= 10) {
    isBad = true;
    reasons.push(`entry (${entry}) <= 10`);
  }

  for (const val of entryRange) {
    if (val !== null && val > 0 && val <= 10) {
      isBad = true;
      reasons.push(`entryRange val (${val}) <= 10`);
      break;
    }
  }

  if (stopLoss !== null && stopLoss > 0 && stopLoss <= 10) {
    isBad = true;
    reasons.push(`stopLoss (${stopLoss}) <= 10`);
  }

  for (const val of targets) {
    if (val !== null && val > 0 && val <= 10) {
      isBad = true;
      reasons.push(`target (${val}) <= 10`);
      break;
    }
  }

  return { isBad, reasons };
}

async function runLiveCleanup(dbUri) {
  console.log(`Connecting to database...`);
  await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 5000 });
  console.log("Connected to MongoDB successfully.");

  // 2. Count signals
  const activeCount = await ParsedSignal.countDocuments({ signalState: "ACTIVE" });
  const partialCount = await ParsedSignal.countDocuments({ signalState: "PARTIAL" });
  const closedCount = await ParsedSignal.countDocuments({ signalState: "CLOSED" });
  const expiredCount = await ParsedSignal.countDocuments({ signalState: "EXPIRED" });

  console.log("\n=== DATABASE SIGNAL COUNTS ===");
  console.log(`ACTIVE signals: ${activeCount}`);
  console.log(`PARTIAL signals: ${partialCount}`);
  console.log(`CLOSED signals: ${closedCount}`);
  console.log(`EXPIRED signals: ${expiredCount}`);

  // 3. Find invalid active/partial signals
  const signals = await ParsedSignal.find({
    signalState: { $in: ["ACTIVE", "PARTIAL"] }
  }).lean();

  console.log(`\nAuditing ${signals.length} active/partial signals in DB for invalid values...`);

  const badSignals = [];
  for (const signal of signals) {
    const { isBad, reasons } = checkIsBadSignal(signal);
    if (isBad) {
      badSignals.push({
        id: signal._id.toString(),
        pair: signal.pair,
        channel: signal.channel,
        messageId: signal.messageId,
        rawText: signal.rawText,
        entry: signal.entry,
        targets: signal.targets,
        stopLoss: signal.stopLoss,
        reasons
      });
    }
  }

  console.log(`Found ${badSignals.length} suspicious active/partial signals in DB.`);
  
  if (badSignals.length > 0) {
    console.log("\nSuspicious active/partial records details:");
    console.log(JSON.stringify(badSignals, null, 2));

    // 5. Mark found records as EXPIRED
    const badIds = badSignals.map(s => s.id);
    const updateResult = await ParsedSignal.updateMany(
      { _id: { $in: badIds } },
      { $set: { signalState: "EXPIRED" } }
    );
    console.log(`Successfully transitioned ${updateResult.modifiedCount} records to EXPIRED state in DB.`);
  } else {
    console.log("Consensus integrity verified: 0 bad active/partial records exist in the database.");
  }

  return { count: badSignals.length, records: badSignals };
}

function runOfflineAudit() {
  console.log("\n--- Database is offline. Running offline audit fallback on local JSON files ---");
  const workspaceDir = "c:/Users/Lenovo/forex-dashboard-demo/backend";
  const files = [
    "suspicious_audits.json",
    "channel_audit_results.json",
    "deep_channel_audit_results.json"
  ];

  const badSignals = [];

  for (const file of files) {
    const filePath = path.join(workspaceDir, file);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : Object.values(data).flat();

      for (const item of items) {
        const signal = item.parsed || item;
        if (!signal) continue;

        const { isBad, reasons } = checkIsBadSignal(signal);
        if (isBad) {
          badSignals.push({
            sourceFile: file,
            pair: signal.pair || "unknown",
            channel: signal.channel || "unknown",
            messageId: signal.messageId || null,
            rawText: item.rawText || signal.rawText || signal.text || "",
            entry: signal.entry || null,
            targets: signal.targets || [],
            stopLoss: signal.stopLoss || null,
            reasons
          });
        }
      }
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  }

  const uniqueBadSignals = [];
  const seenTexts = new Set();
  for (const sig of badSignals) {
    const cleanText = (sig.rawText || "").trim();
    if (!seenTexts.has(cleanText)) {
      seenTexts.add(cleanText);
      uniqueBadSignals.push(sig);
    }
  }

  console.log(`Audited offline datasets: found ${uniqueBadSignals.length} unique suspicious signal records.`);
  if (uniqueBadSignals.length > 0) {
    console.log("\nOffline audit details (Sample):");
    console.log(JSON.stringify(uniqueBadSignals.slice(0, 10), null, 2));

    console.log("\nIf these records exist in your production database, run this MongoDB update query to clean them:");
    console.log(`db.parsedsignals.updateMany({ pair: "XAUUSD", signalState: { $in: ["ACTIVE", "PARTIAL"] }, $or: [ { entry: { $lte: 10 } }, { stopLoss: { $lte: 10 } }, { targets: { $elemMatch: { $lte: 10 } } } ] }, { $set: { signalState: "EXPIRED" } })`);
  }

  return { count: uniqueBadSignals.length, records: uniqueBadSignals };
}

async function main() {
  let dbUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/telegram_signal_consensus";

  if (dbUri.includes("127.0.0.1") || dbUri.includes("localhost")) {
    console.log("Local MongoDB configuration detected.");
    const inputUri = await askQuestion("Enter MongoDB Atlas connection string (or press Enter to skip and run offline): ");
    if (inputUri.trim()) {
      dbUri = inputUri.trim();
    }
  }

  try {
    await runLiveCleanup(dbUri);
    console.log("\n=== CLEANUP COMPLETED (LIVE DB MODE) ===");
  } catch (error) {
    console.warn(`\nLive DB access unavailable or failed (${error.message}).`);
    runOfflineAudit();
    console.log("\n=== AUDIT COMPLETED (OFFLINE MODE) ===");
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(0);
  }
}

main();
