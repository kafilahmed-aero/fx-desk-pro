import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { resolveSymbol, getCurrentPrice } from "../services/priceIngestionService.js";
import { updateOutcomePrice } from "../services/signalOutcomeEngine.js";

async function run() {
  console.log("=== STARTING PRODUCTION VERIFICATION AUDIT ===");

  // Connect to Database
  const dbStatus = await connectDatabase();
  console.log(`Database connected: ${dbStatus.connected} ${dbStatus.error || ""}`);

  if (!dbStatus.connected) {
    console.warn("[WARN] Database connection failed. MongoDB queries will be skipped.");
  }

  // 1. Production Outcome Verification (Phase E)
  console.log("\n--- Phase E: Database Outcome Counts ---");
  if (dbStatus.connected) {
    try {
      const total = await SignalOutcome.countDocuments();
      const active = await SignalOutcome.countDocuments({ status: "ACTIVE" });
      const pending = await SignalOutcome.countDocuments({ status: "PENDING" });
      const fullTp = await SignalOutcome.countDocuments({ status: "FULL_TP" });
      const partialTp = await SignalOutcome.countDocuments({ status: "PARTIAL_TP" });
      const slHit = await SignalOutcome.countDocuments({ status: "SL_HIT" });
      const expired = await SignalOutcome.countDocuments({ status: "EXPIRED" });
      const cancelled = await SignalOutcome.countDocuments({ status: "CANCELLED" });

      console.log(`Total Outcome Records: ${total}`);
      console.log(`ACTIVE count: ${active}`);
      console.log(`PENDING count: ${pending}`);
      console.log(`FULL_TP count: ${fullTp}`);
      console.log(`PARTIAL_TP count: ${partialTp}`);
      console.log(`SL_HIT count: ${slHit}`);
      console.log(`EXPIRED count: ${expired}`);
      console.log(`CANCELLED count: ${cancelled}`);
    } catch (dbQueryErr) {
      console.error(`[FAIL] Querying database records failed: ${dbQueryErr.message}`);
    }
  } else {
    console.log("Database offline. Outcome counts are unavailable.");
  }

  // 2. Price Feed Verification (Phase B)
  console.log("\n--- Phase B: Price Feed Verification ---");
  const yahooAssets = ["XAUUSD", "EURUSD", "GBPJPY", "US30", "US100", "SPX500", "WTI", "BRENT", "NATGAS"];
  const binanceAssets = ["BTCUSD", "ETHUSD"];

  console.log("\n--- Yahoo Finance Assets ---");
  for (const pair of yahooAssets) {
    const resolved = resolveSymbol(pair);
    try {
      const priceInfo = await getCurrentPrice(pair);
      if (priceInfo) {
        console.log(`[PASS] ${pair} (${resolved.symbol}) via ${resolved.provider} -> Price: ${priceInfo.price}, Time: ${priceInfo.lastUpdated}`);
      } else {
        console.log(`[FAIL] ${pair} (${resolved.symbol}) via ${resolved.provider} -> No price returned`);
      }
    } catch (err) {
      console.log(`[FAIL] ${pair} (${resolved.symbol}) via ${resolved.provider} -> Error: ${err.message}`);
    }
  }

  console.log("\n--- Binance Assets ---");
  for (const pair of binanceAssets) {
    const resolved = resolveSymbol(pair);
    try {
      const priceInfo = await getCurrentPrice(pair);
      if (priceInfo) {
        console.log(`[PASS] ${pair} (${resolved.symbol}) via ${resolved.provider} -> Price: ${priceInfo.price}, Time: ${priceInfo.lastUpdated}`);
      } else {
        console.log(`[FAIL] ${pair} (${resolved.symbol}) via ${resolved.provider} -> No price returned`);
      }
    } catch (err) {
      console.log(`[FAIL] ${pair} (${resolved.symbol}) via ${resolved.provider} -> Error: ${err.message}`);
    }
  }

  // 3. Market Cache Verification (Phase C)
  console.log("\n--- Phase C: Market Cache Verification ---");
  const pairToTest = "EURUSD";
  const startFetch = Date.now();
  const price1 = await getCurrentPrice(pairToTest);
  const midFetch = Date.now();
  const price2 = await getCurrentPrice(pairToTest);
  const endFetch = Date.now();
  
  const cacheHitDuration = endFetch - midFetch;
  console.log(`First Fetch duration: ${midFetch - startFetch}ms`);
  console.log(`Second Fetch (cache hit) duration: ${cacheHitDuration}ms`);
  console.log(`Cache entry for ${pairToTest}: Price=${price2?.price}, LastUpdated=${price2?.lastUpdated}`);
  if (cacheHitDuration < 10) {
    console.log("[PASS] Cache hit returned instantly (< 10ms)");
  } else {
    console.log(`[WARN] Cache hit duration: ${cacheHitDuration}ms`);
  }

  // 4. Outcome Engine Verification (Phase D)
  console.log("\n--- Phase D: Outcome Engine Verification ---");
  console.log("\nTesting Lifecycle 1: PENDING -> ACTIVE -> PARTIAL_TP -> FULL_TP");
  const testOutcome1 = {
    signalId: new mongoose.Types.ObjectId(),
    messageKey: "Verification:Lifecycle1",
    channel: "VerificationChannel",
    pair: "EURUSD",
    action: "BUY",
    entry: { entryType: "PRICE", entryPrice: 1.0800 },
    targets: [
      { targetNumber: 1, price: 1.0850, isHit: false },
      { targetNumber: 2, price: 1.0900, isHit: false }
    ],
    stopLoss: 1.0750,
    status: "PENDING",
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  console.log(`Initial status: ${testOutcome1.status}`);
  await updateOutcomePrice(testOutcome1, 1.0800);
  console.log(`After Entry Price 1.0800: ${testOutcome1.status}`);
  await updateOutcomePrice(testOutcome1, 1.0860);
  console.log(`After Target 1 Price 1.0860: ${testOutcome1.status} (TP1: ${testOutcome1.targets[0].isHit}, TP2: ${testOutcome1.targets[1].isHit})`);
  await updateOutcomePrice(testOutcome1, 1.0910);
  console.log(`After Target 2 Price 1.0910: ${testOutcome1.status} (TP1: ${testOutcome1.targets[0].isHit}, TP2: ${testOutcome1.targets[1].isHit})`);

  console.log("\nTesting Lifecycle 2: PENDING -> ACTIVE -> SL_HIT");
  const testOutcome2 = {
    signalId: new mongoose.Types.ObjectId(),
    messageKey: "Verification:Lifecycle2",
    channel: "VerificationChannel",
    pair: "EURUSD",
    action: "BUY",
    entry: { entryType: "PRICE", entryPrice: 1.0800 },
    targets: [{ targetNumber: 1, price: 1.0850, isHit: false }],
    stopLoss: 1.0750,
    status: "PENDING",
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  console.log(`Initial status: ${testOutcome2.status}`);
  await updateOutcomePrice(testOutcome2, 1.0800);
  console.log(`After Entry Price 1.0800: ${testOutcome2.status}`);
  await updateOutcomePrice(testOutcome2, 1.0740);
  console.log(`After Stop Loss 1.0740: ${testOutcome2.status}`);

  await mongoose.disconnect();
  console.log("\nProduction verification script complete.");
}

run().catch((err) => {
  console.error("Execution error:", err);
});
