import mongoose from "mongoose";
import { config } from "../config/env.js";
import { localPhoenixTradeMemory } from "../services/phoenixMemoryService.js";
import { localPhoenixTradeFeatures } from "../services/phoenixFeatureEngine.js";
import { localPhoenixRecommendations } from "../services/phoenixRecommendationEngine.js";
import {
  evaluateTuningCandidates,
  saveProposalsToLedger,
  getTuningProposals,
  localPhoenixTuningProposals,
  resolveMemoryTradeIds
} from "../services/phoenixAutoTuningEngine.js";
import { AUTO_TUNING_POLICY } from "../config/autoTuningPolicy.js";
import { PhoenixTuningProposal } from "../models/phoenixTuningProposalModel.js";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${message}`);
    failCount++;
  }
}

function createMockTrade({ tradeId, closeTime, netProfit, outcome, channel, session, grade, strategy, durationMs }) {
  return {
    tradeId,
    symbol: "XAUUSD",
    direction: "BUY",
    signalInfo: {
      channels: [channel],
      consensusPercentage: 85,
      confidence: 88
    },
    decisionEngine: {
      decision: "BUY",
      grade,
      finalScore: 88,
      reasons: ["Test reason"],
      warnings: []
    },
    marketContext: {
      overallScore: 82,
      session: { currentSession: session },
      trend: { score: 85 },
      structure: { score: 80 }
    },
    smartEntry: {
      recommendedStrategy: strategy,
      entryQuality: "GRADE B",
      entryPrice: 2000.0,
      entryRR: 2.5
    },
    execution: {
      lotSize: 0.1,
      actualFill: 2000.0,
      stopLoss: 1990.0,
      takeProfit: 2025.0
    },
    lifecycleTimeline: [
      { event: "Trade Opened", timestamp: new Date(new Date(closeTime).getTime() - durationMs) }
    ],
    result: {
      outcome,
      netProfit,
      rMultiple: 2.5,
      rrAchieved: outcome === "FULL_TP" ? 2.5 : 1.0,
      durationMs,
      closeTime: new Date(closeTime)
    },
    environment: {
      session,
      timestamp: new Date(closeTime)
    }
  };
}

async function runTests() {
  console.log("=== RUNNING PHOENIX SAFE AUTO-TUNING TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Clear maps
  localPhoenixTradeMemory.clear();
  localPhoenixTradeFeatures.clear();
  localPhoenixRecommendations.clear();
  localPhoenixTuningProposals.clear();

  if (isMongoAvailable) {
    try {
      await mongoose.connection.db.collection("phoenixTuningProposal").deleteMany({});
    } catch (e) {}
  }

  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  // 1. Setup Mock Trades: Seed 12 trades for VincentGold spanning 5 days (120 hours)
  console.log("\n[Test 1] Seeding mock data with stable historical observation...");
  const baseTime = new Date("2026-07-10T12:00:00Z").getTime();
  
  for (let i = 0; i < 12; i++) {
    const tradeId = `T-VINCENT-${i}`;
    const closeTime = new Date(baseTime + i * 10 * 3600 * 1000).toISOString(); // Spans 110 hours
    const raw = createMockTrade({
      tradeId,
      closeTime,
      netProfit: 100.0,
      outcome: "FULL_TP",
      channel: "VincentGold",
      session: "London",
      grade: "GRADE A",
      strategy: "LIMIT",
      durationMs: 600000
    });
    localPhoenixTradeMemory.set(tradeId, raw);
  }

  // Seed 4 trades for short observation period checks (under 72 hours)
  for (let i = 0; i < 4; i++) {
    const tradeId = `T-SHORT-${i}`;
    const closeTime = new Date(baseTime + i * 2 * 3600 * 1000).toISOString(); // Spans 6 hours
    const raw = createMockTrade({
      tradeId,
      closeTime,
      netProfit: 100.0,
      outcome: "FULL_TP",
      channel: "ShortChan",
      session: "London",
      grade: "GRADE A",
      strategy: "LIMIT",
      durationMs: 600000
    });
    localPhoenixTradeMemory.set(tradeId, raw);
  }

  assert(localPhoenixTradeMemory.size === 16, "Successfully seeded 16 trades");

  // 2. Setup Mock Recommendations
  console.log("\n[Test 2] Setting up Mock Recommendations...");
  const recs = [
    // R1: Perfect candidate (all 7 gates pass)
    {
      recommendationId: "REC-VINCENT-001",
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "Channels",
      title: "Increase Confidence Weighting for Channel VincentGold",
      priority: "HIGH",
      confidence: "VERY HIGH",
      impact: "HIGH",
      evidenceSummary: "Win rate is 100% across 12 trades spanning 110 hours.",
      explanation: "Excellent channel performance.",
      supportingStatistics: { channelName: "VincentGold", count: 12, winRate: 1.0, trend: "Improving" },
      timeframe: "allTime"
    },
    // R2: Rejected candidate due to low sample size (count = 4)
    {
      recommendationId: "REC-SHORT-002",
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "Channels",
      title: "Increase Confidence Weighting for Channel ShortChan",
      priority: "MEDIUM",
      confidence: "HIGH",
      impact: "MEDIUM",
      evidenceSummary: "Win rate is 100% across 4 trades.",
      explanation: "Good but insufficient data.",
      supportingStatistics: { channelName: "ShortChan", count: 4, winRate: 1.0, trend: "Stable" },
      timeframe: "allTime"
    },
    // R3: Rejected candidate due to declining trend
    {
      recommendationId: "REC-DECLINING-003",
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "Channels",
      title: "Increase Confidence Weighting for Channel VincentGold",
      priority: "LOW",
      confidence: "HIGH",
      impact: "LOW",
      evidenceSummary: "Declining trend flagged.",
      explanation: "Deteriorating consistency.",
      supportingStatistics: { channelName: "VincentGold", count: 12, winRate: 0.85, trend: "Declining" },
      timeframe: "allTime"
    },
    // R4: Conflict resolution candidate
    {
      recommendationId: "REC-CONFLICT-004",
      recommendationVersion: "1.0",
      generatedAt: new Date(),
      analyticsVersion: "1.0",
      status: "ACTIVE",
      category: "System Health",
      title: "Conflict Resolved: weightings",
      priority: "HIGH",
      confidence: "HIGH",
      impact: "UNKNOWN",
      evidenceSummary: "Conflict flagged",
      explanation: "Advisory conflict flagged",
      supportingStatistics: { totalTrades: 16 },
      timeframe: "allTime"
    }
  ];

  recs.forEach(r => localPhoenixRecommendations.set(r.recommendationId, r));

  // 3. Run Safe Auto-Tuning Engine validations
  console.log("\n[Test 3] Running Safety Evaluations...");
  const proposals = await evaluateTuningCandidates({ timeframe: "allTime" });
  assert(proposals.length === 4, "Engine evaluated all 4 candidates");

  // Validate R1 (Perfect candidate)
  const prop1 = proposals.find(p => p.recommendationId === "REC-VINCENT-001");
  assert(prop1.status === "APPROVED_FOR_MANUAL_REVIEW", "R1 passed all gates and is APPROVED_FOR_MANUAL_REVIEW");
  assert(prop1.safetyScore === 100, `R1 safetyScore is 100 (Actual: ${prop1.safetyScore})`);
  assert(prop1.safetyGrade === "A", "R1 safetyGrade is A (matches confidence VERY HIGH)");
  assert(prop1.passedGates.length === 7, "R1 passed exactly 7 safety gates");
  assert(prop1.failedGates.length === 0, "R1 has 0 failed gates");
  
  // Gate check detail audatibility
  const sampleSizeGate = prop1.safetyGates.find(g => g.name === "Minimum Sample Size");
  assert(sampleSizeGate.status === "PASS", "Gate details shows PASS status");
  assert(sampleSizeGate.observed === 12, "Gate details contains correct observed sample size (12)");
  assert(sampleSizeGate.threshold === AUTO_TUNING_POLICY.minSampleSize, "Gate details contains correct policy threshold (10)");

  // Validate R2 (Low sample size)
  const prop2 = proposals.find(p => p.recommendationId === "REC-SHORT-002");
  assert(prop2.status === "REJECTED", "R2 is REJECTED due to sample size");
  assert(prop2.safetyGrade === "REJECT", "R2 safetyGrade is REJECT");
  assert(prop2.failedGates.includes("Minimum Sample Size") || prop2.failedGates.includes("Minimum Observation Period"), `R2 failed gates: ${prop2.failedGates.join(", ")}`);

  // Validate R3 (Declining trend)
  const prop3 = proposals.find(p => p.recommendationId === "REC-DECLINING-003");
  assert(prop3.status === "REJECTED", "R3 is REJECTED due to declining trend");
  assert(prop3.failedGates.includes("Minimum Historical Stability"), "R3 failed gate: Minimum Historical Stability");

  // Validate R4 (Conflict)
  const prop4 = proposals.find(p => p.recommendationId === "REC-CONFLICT-004");
  assert(prop4.status === "REJECTED", "R4 is REJECTED due to conflict flag");
  assert(prop4.failedGates.includes("Conflict-Free Validation"), "R4 failed gate: Conflict-Free Validation");

  // 4. Test Proposal Traceability Audit Trail
  console.log("\n[Test 4] Testing Proposal Traceability Audit Trail...");
  assert(prop1.proposalId !== undefined, "Proposal contains unique proposalId");
  assert(prop1.proposalVersion === "1.0", "Proposal version is '1.0'");
  assert(prop1.analyticsVersion === "1.0", "Proposal references correct analyticsVersion");
  assert(prop1.featureVersion === "1.0", "Proposal references correct featureVersion");
  assert(Array.isArray(prop1.memoryTradeIds), "Proposal references memoryTradeIds array");
  assert(prop1.memoryTradeIds.length === 12, "memoryTradeIds contains all 12 source trade IDs");
  assert(prop1.generatedAt !== undefined, "Proposal generatedAt timestamp populated");

  // 5. Test Configurable Policy Validation
  console.log("\n[Test 5] Testing Configurable Policy Updates...");
  // Temporarily adjust policy minSampleSize to 15
  const originalMinSize = AUTO_TUNING_POLICY.minSampleSize;
  AUTO_TUNING_POLICY.minSampleSize = 15;

  const propsPolicyUpdate = await evaluateTuningCandidates({ timeframe: "allTime" });
  const prop1Updated = propsPolicyUpdate.find(p => p.recommendationId === "REC-VINCENT-001");
  assert(prop1Updated.status === "REJECTED", "R1 is now REJECTED under updated policy threshold of 15 trades");
  assert(prop1Updated.failedGates.includes("Minimum Sample Size"), "R1 failed gate list updated to flag Minimum Sample Size");

  // Restore policy
  AUTO_TUNING_POLICY.minSampleSize = originalMinSize;

  // 6. Test Status transitions & Offline Cache save
  console.log("\n[Test 6] Testing Status transitions & Cache storage...");
  const processed = await saveProposalsToLedger(proposals);
  assert(localPhoenixTuningProposals.size === 4, "Saved exactly 4 proposals in local cache");

  const newMockProp = {
    ...proposals[0],
    proposalId: "PROP-NEW-ID-ABC",
    safetyScore: 95
  };
  await saveProposalsToLedger([newMockProp]);

  // Query previous Vincent proposal to check if status was updated
  const prevProp = localPhoenixTuningProposals.get(proposals[0].proposalId);
  assert(prevProp.status === "REJECTED", "Older active manual review proposal transitioned to REJECTED/SUPERSEDED successfully");

  // 7. Test Mongoose Online database integration
  if (isMongoAvailable) {
    console.log("\n[Test 7] Testing Mongoose Database Integration...");
    Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

    try {
      await saveProposalsToLedger(proposals);
      
      const queried = await getTuningProposals({ status: "APPROVED_FOR_MANUAL_REVIEW" });
      assert(queried.length > 0, "getTuningProposals retrieves active manual review records from MongoDB");

      // Try to mutate other fields on saved document (should fail)
      try {
        await PhoenixTuningProposal.updateOne({ proposalId: proposals[0].proposalId }, { $set: { safetyScore: 0 } });
        assert(false, "Mongoose updateOne allowed modifying append-only proposal safetyScore");
      } catch (e) {
        assert(e.message.includes("Only status transitions"), `updateOne block prevents metric modifications (Message: ${e.message})`);
      }

      // Try status transition only (should pass)
      await PhoenixTuningProposal.updateOne({ proposalId: proposals[0].proposalId }, { $set: { status: "REJECTED" } });
      const updatedDoc = await PhoenixTuningProposal.findOne({ proposalId: proposals[0].proposalId });
      assert(updatedDoc.status === "REJECTED", "Mongoose updateOne allowed status transition successfully");
      
      // Try to delete document (should fail)
      try {
        await PhoenixTuningProposal.deleteOne({ proposalId: proposals[0].proposalId });
        assert(false, "Mongoose deleteOne allowed deleting append-only proposal");
      } catch (e) {
        assert(e.message.includes("prohibited"), `deleteOne block prevents record deletion (Message: ${e.message})`);
      }
    } catch (e) {
      console.error("  FAIL: Online validation failed", e);
      failCount++;
    }
  }

  // Restore state
  Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

  console.log(`\n==============================================`);
  console.log(`TEST RUN COMPLETE: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log(`==============================================`);
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
