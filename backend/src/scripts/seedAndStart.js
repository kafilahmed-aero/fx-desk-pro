import "dotenv/config";
import { createApp } from "../app.js";
import { saveOutcome, resetOutcomeStore } from "../services/signalOutcomeStore.js";
import { aggregateChannelPerformance, resetPerformanceStore } from "../services/channelPerformanceService.js";
import mongoose from "mongoose";

async function seedData() {
  resetOutcomeStore();
  resetPerformanceStore();
  
  const channels = ["GoldTradePrecision1", "AnabelSignals", "TestVIPPremium"];
  
  // Seed GoldTradePrecision1 (win rate 75%, completed 24 - ELIGIBLE)
  // 15 FULL_TP, 5 SL_HIT, 4 PARTIAL_TP
  for (let i = 0; i < 15; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "FULL_TP", 45));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "SL_HIT", 120));
  }
  for (let i = 0; i < 4; i++) {
    await saveOutcome(buildMockOutcome("GoldTradePrecision1", "PARTIAL_TP", 30));
  }

  // Seed AnabelSignals (win rate 50%, completed 12 - NOT ELIGIBLE)
  // 5 FULL_TP, 5 SL_HIT, 2 PARTIAL_TP
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "FULL_TP", 60));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "SL_HIT", 180));
  }
  for (let i = 0; i < 2; i++) {
    await saveOutcome(buildMockOutcome("AnabelSignals", "PARTIAL_TP", 40));
  }

  // Seed TestVIPPremium (win rate 40%, completed 25 - ELIGIBLE)
  // 8 FULL_TP, 12 SL_HIT, 5 PARTIAL_TP
  for (let i = 0; i < 8; i++) {
    await saveOutcome(buildMockOutcome("TestVIPPremium", "FULL_TP", 90));
  }
  for (let i = 0; i < 12; i++) {
    await saveOutcome(buildMockOutcome("TestVIPPremium", "SL_HIT", 240));
  }
  for (let i = 0; i < 5; i++) {
    await saveOutcome(buildMockOutcome("TestVIPPremium", "PARTIAL_TP", 60));
  }

  await aggregateChannelPerformance();
  console.log("Mock data seeded and aggregated successfully in-memory!");
}

function buildMockOutcome(channel, status, minutesDuration) {
  const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  const outcomeTime = new Date(createdAt.getTime() + minutesDuration * 60 * 1000);
  
  return {
    signalId: new mongoose.Types.ObjectId(),
    messageKey: `${channel}:${Math.floor(Math.random() * 1000000)}`,
    channel,
    pair: "XAUUSD",
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
