import "dotenv/config";
import { createApp } from "../app.js";
import { saveOutcome, resetOutcomeStore } from "../services/signalOutcomeStore.js";
import { aggregateChannelPerformance, resetPerformanceStore } from "../services/channelPerformanceService.js";
import { aggregatePairPerformance, resetPairPerformanceStore } from "../services/pairPerformanceService.js";
import mongoose from "mongoose";

async function seedData() {
  resetOutcomeStore();
  resetPerformanceStore();
  resetPairPerformanceStore();
  
  // Seed GoldTradePrecision1:
  // - 15 FULL_TP, 5 SL_HIT, 4 PARTIAL_TP on "XAUUSD" (completed = 24, winRate = 75%)
  // - 5 FULL_TP, 2 SL_HIT on alias "GOLD" (completed = 7, will merge with XAUUSD to total completed = 31!)
  // - 5 FULL_TP on "EURUSD" (completed = 5, not eligible)
  for (let i = 0; i < 15; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "XAUUSD", "FULL_TP", 45));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "XAUUSD", "SL_HIT", 120));
  }
  for (let i = 0; i < 4; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "XAUUSD", "PARTIAL_TP", 30));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "GOLD", "FULL_TP", 40));
  }
  for (let i = 0; i < 2; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "GOLD", "SL_HIT", 100));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "EURUSD", "FULL_TP", 55));
  }

  // Seed AnabelSignals:
  // - 12 FULL_TP, 10 SL_HIT on "EURUSD" (completed = 22, winRate = 54.5%)
  // - 2 FULL_TP on alias "EUR/USD" (completed = 2, will merge with EURUSD to total completed = 24!)
  // - 5 FULL_TP on "GBP/JPY" (completed = 5, not eligible)
  for (let i = 0; i < 12; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "EURUSD", "FULL_TP", 60));
  }
  for (let i = 0; i < 10; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "EURUSD", "SL_HIT", 180));
  }
  for (let i = 0; i < 2; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "EUR/USD", "FULL_TP", 50));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "GBPJPY", "FULL_TP", 75));
  }

  // Seed TestVIPPremium:
  // - 8 FULL_TP, 12 SL_HIT, 5 PARTIAL_TP on "BTCUSD" (completed = 25, winRate = 40%)
  for (let i = 0; i < 8; i++) {
    await saveOutcome(buildMockOutcome("TestVIPPremium", "BTCUSD", "FULL_TP", 90));
  }
  for (let i = 0; i < 12; i++) {
    await saveOutcome(buildMockOutcome("TestVIPPremium", "BTCUSD", "SL_HIT", 240));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("TestVIPPremium", "BTCUSD", "PARTIAL_TP", 60));
  }

  await aggregateChannelPerformance();
  await aggregatePairPerformance();
  console.log("Mock data seeded and aggregated successfully in-memory!");
}

function buildMockOutcome(channel, pair, status, minutesDuration) {
  const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  const outcomeTime = new Date(createdAt.getTime() + minutesDuration * 60 * 1000);
  
  return {
    signalId: new mongoose.Types.ObjectId(),
    messageKey: `${channel}:${pair}:${Math.floor(Math.random() * 1000000)}`,
    channel,
    pair,
    action: "BUY",
    entry: { entryType: "PRICE", entryPrice: 2000, entryLow: null, entryHigh: null },
    targets: [{ targetNumber: 1, price: 2010, isHit: status === "FULL_TP" || status === "PARTIAL_TP" }],
    stopLoss: 1990,
    status,
    hitTargets: status === "FULL_TP" || status === "PARTIAL_TP" ? [1] : [],
    maxTargetHit: status === "FULL_TP" || status === "PARTIAL_TP" ? 1 : 0,
    outcomePrice: status === "FULL_TP" ? 2010 : (status === "SL_HIT" ? 1990 : null),
    outcomeTime,
    outcomeReason: "PRICE_MONITOR",
    expiresAt: new Date(createdAt.getTime() + 72 * 60 * 60 * 1000),
    createdAt,
  };
}

async function start() {
  await seedData();
  const app = createApp();
  const server = app.listen(5000, "0.0.0.0", () => {
    console.log("Mock Backend Server started on port 5000");
  });
}

start();
