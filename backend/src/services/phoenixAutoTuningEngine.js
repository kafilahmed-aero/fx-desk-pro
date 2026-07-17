import crypto from "crypto";
import mongoose from "mongoose";
import { getRecommendations } from "./phoenixRecommendationEngine.js";
import { getTradeHistory } from "./phoenixMemoryService.js";
import { filterByTimeframe } from "./phoenixAnalyticsEngine.js";
import { AUTO_TUNING_POLICY } from "../config/autoTuningPolicy.js";
import { PhoenixTuningProposal } from "../models/phoenixTuningProposalModel.js";
import { phoenixDeepFreeze } from "./phoenixFeatureEngine.js";

// Offline Cache Map for Tuning Proposals
export const localPhoenixTuningProposals = new Map();

/**
 * Resolves the raw trade memories that served as evidence for a recommendation.
 */
export async function resolveMemoryTradeIds(rec, filters = {}) {
  const allRawTrades = await getTradeHistory({}, { sort: { "result.closeTime": 1 } });
  const filtered = filterByTimeframe(allRawTrades, rec.timeframe || filters.timeframe, filters.startDate, filters.endDate);
  
  let matching = [];
  const category = rec.category;
  const stats = rec.supportingStatistics || {};
  
  if (category === "Channels") {
    const chName = stats.channelName;
    matching = filtered.filter(t => t.signalInfo?.channels?.includes(chName));
  } else if (category === "Sessions") {
    const sName = stats.session;
    matching = filtered.filter(t => {
      const currentSession = t.environment?.session || t.marketContext?.session?.currentSession;
      return String(currentSession).toUpperCase() === String(sName).toUpperCase() ||
             (String(sName).toUpperCase() === "NEW YORK" && String(currentSession).toUpperCase() === "NEWYORK");
    });
  } else if (category === "Smart Entry") {
    const strat = stats.strategy;
    matching = filtered.filter(t => String(t.smartEntry?.recommendedStrategy).toUpperCase() === String(strat).toUpperCase());
  } else if (category === "Decision Engine") {
    const grade = stats.grade;
    matching = filtered.filter(t => String(t.decisionEngine?.grade).toUpperCase() === String(grade).toUpperCase());
  } else {
    matching = filtered;
  }
  
  return matching;
}

/**
 * Runs active recommendations through the 7 deterministic safety gates.
 * 
 * @param {Object} filters - Query and timeframe filters
 * @returns {Promise<Array>} List of generated proposals
 */
export async function evaluateTuningCandidates(filters = {}) {
  // 1. Fetch active recommendations
  const activeRecs = await getRecommendations({ status: "ACTIVE" });
  const proposals = [];

  for (const rec of activeRecs) {
    const matchingTrades = await resolveMemoryTradeIds(rec, filters);
    const tradeIds = matchingTrades.map(t => t.tradeId);
    
    const count = matchingTrades.length;
    const stats = rec.supportingStatistics || {};
    
    // Safety Gates evaluations
    const safetyGates = [];

    // Gate 1: Minimum Sample Size
    const g1Threshold = AUTO_TUNING_POLICY.minSampleSize;
    const g1Observed = count;
    const g1Pass = g1Observed >= g1Threshold;
    safetyGates.push({
      name: "Minimum Sample Size",
      status: g1Pass ? "PASS" : "FAIL",
      observed: g1Observed,
      threshold: g1Threshold,
      reason: g1Pass 
        ? `Observed ${g1Observed} trades matches or exceeds the safety threshold of ${g1Threshold}.`
        : `Observed ${g1Observed} trades is below the safety threshold of ${g1Threshold}.`
    });

    // Gate 2: Minimum Confidence Level
    const g2Threshold = AUTO_TUNING_POLICY.minConfidenceLevels;
    const g2Observed = rec.confidence;
    const g2Pass = g2Threshold.includes(g2Observed);
    safetyGates.push({
      name: "Minimum Confidence Level",
      status: g2Pass ? "PASS" : "FAIL",
      observed: g2Observed,
      threshold: g2Threshold.join(" or "),
      reason: g2Pass
        ? `Confidence level ${g2Observed} is approved for auto-tuning.`
        : `Confidence level ${g2Observed} is too low. Requires high-confidence metrics.`
    });

    // Gate 3: Minimum Historical Stability
    const g3Threshold = "Not Declining";
    const g3Observed = stats.trend || "Stable";
    const g3Pass = g3Observed !== "Declining";
    safetyGates.push({
      name: "Minimum Historical Stability",
      status: g3Pass ? "PASS" : "FAIL",
      observed: g3Observed,
      threshold: g3Threshold,
      reason: g3Pass
        ? `Stability trend resolves to ${g3Observed}.`
        : `Stability trend is Declining. Cannot safely recommend changes on deteriorating trends.`
    });

    // Gate 4: Minimum Observation Period
    const g4Threshold = AUTO_TUNING_POLICY.minObservationPeriodHours;
    let g4Observed = 0.0;
    if (count >= 2) {
      const times = matchingTrades.map(t => new Date(t.result?.closeTime || t.createdAt || Date.now()).getTime());
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      g4Observed = Number(((maxTime - minTime) / (1000.0 * 3600.0)).toFixed(2));
    }
    const g4Pass = g4Observed >= g4Threshold;
    safetyGates.push({
      name: "Minimum Observation Period",
      status: g4Pass ? "PASS" : "FAIL",
      observed: `${g4Observed} hours`,
      threshold: `${g4Threshold} hours`,
      reason: g4Pass
        ? `Observation window covers ${g4Observed} hours (threshold: ${g4Threshold}).`
        : `Observation window is too short (${g4Observed} hours). Minimum required is ${g4Threshold} hours.`
    });

    // Gate 5: Conflict-Free Validation
    const g5Threshold = "No active conflicts";
    const g5Observed = (rec.title.includes("Conflict") || rec.title.includes("Manual Audit")) ? "Conflict Detected" : "Clear";
    const g5Pass = g5Observed === "Clear";
    safetyGates.push({
      name: "Conflict-Free Validation",
      status: g5Pass ? "PASS" : "FAIL",
      observed: g5Observed,
      threshold: g5Threshold,
      reason: g5Pass
        ? "No contradictory advice or warnings found."
        : "Conflicting analytical indicators were flagged. Manual review required."
    });

    // Gate 6: Recommendation Consistency
    const g6Threshold = "Win rate >= 50% for positive scale, <= 50% for negative scale";
    const wr = stats.winRate !== undefined ? stats.winRate : 0.5;
    let g6Pass = true;
    if (rec.title.includes("Increase") || rec.title.includes("Preferred")) {
      g6Pass = wr >= 0.50;
    } else if (rec.title.includes("Decrease") || rec.title.includes("Remove") || rec.title.includes("Avoid")) {
      g6Pass = wr <= 0.50;
    }
    safetyGates.push({
      name: "Recommendation Consistency",
      status: g6Pass ? "PASS" : "FAIL",
      observed: `Win rate ${(wr * 100).toFixed(1)}%`,
      threshold: g6Threshold,
      reason: g6Pass
        ? "Performance metrics are consistent with the recommended advice."
        : `Recommendation is inconsistent. Win rate ${(wr * 100).toFixed(1)}% does not justify the action.`
    });

    // Gate 7: Statistical Significance
    const g7Threshold = `Win rate >= ${(AUTO_TUNING_POLICY.minWinRateThreshold * 100)}% OR <= ${(AUTO_TUNING_POLICY.maxLossRateThreshold * 100)}%`;
    let g7Pass = true;
    if (stats.winRate !== undefined && (rec.category === "Channels" || rec.category === "Sessions" || rec.category === "Smart Entry" || rec.category === "Decision Engine")) {
      g7Pass = stats.winRate >= AUTO_TUNING_POLICY.minWinRateThreshold || stats.winRate <= AUTO_TUNING_POLICY.maxLossRateThreshold;
    }
    safetyGates.push({
      name: "Statistical Significance",
      status: g7Pass ? "PASS" : "FAIL",
      observed: stats.winRate !== undefined ? `Win rate ${(stats.winRate * 100).toFixed(1)}%` : "N/A",
      threshold: g7Threshold,
      reason: g7Pass
        ? "Statistical performance metrics show high relevance."
        : `Statistical relevance is low. Win rate ${(stats.winRate * 100).toFixed(1)}% falls into the neutral zone.`
    });

    // Scoring math
    const passedGatesList = safetyGates.filter(g => g.status === "PASS").map(g => g.name);
    const failedGatesList = safetyGates.filter(g => g.status === "FAIL").map(g => g.name);
    const passedCount = passedGatesList.length;
    const safetyScore = Number(((passedCount / 7.0) * 100.0).toFixed(2));

    let status = "REJECTED";
    let safetyGrade = "REJECT";
    
    // Strict safety check - ALL gates must pass to be approved
    if (passedCount === 7) {
      status = "APPROVED_FOR_MANUAL_REVIEW";
      safetyGrade = rec.confidence === "VERY HIGH" ? "A" : (rec.confidence === "HIGH" ? "B" : "C");
    }

    const proposalHash = crypto.createHash("sha256")
      .update(`${rec.recommendationId}:${status}:${safetyGrade}`)
      .digest("hex")
      .substring(0, 12);
    const proposalId = `PROP-${rec.category.toUpperCase().replace(/\s+/g, "-")}-${proposalHash}`;

    proposals.push({
      proposalId,
      proposalVersion: "1.0",
      recommendationId: rec.recommendationId,
      generatedAt: new Date(),
      analyticsVersion: rec.analyticsVersion || "1.0",
      featureVersion: "1.0",
      memoryTradeIds: tradeIds,
      status,
      safetyScore,
      safetyGrade,
      evidence: rec.evidenceSummary,
      supportingStatistics: stats,
      passedGates: passedGatesList,
      failedGates: failedGatesList,
      safetyGates,
      explanation: status === "APPROVED_FOR_MANUAL_REVIEW"
        ? `Tuning candidate approved for human manual review. Passed all 7 safety gates. Grade: ${safetyGrade}.`
        : `Tuning candidate rejected due to safety gate failure: ${failedGatesList.join(", ")}.`,
      confidence: rec.confidence,
      recommendation: rec,
      summary: `Tuning candidate check for: ${rec.title}`
    });
  }

  return phoenixDeepFreeze(proposals);
}

/**
 * Saves generated proposals to the ledger, transitioning previous active proposals to SUPERSEDED.
 * 
 * @param {Array} proposals - Proposals array
 * @returns {Promise<Array>} List of saved proposals
 */
export async function saveProposalsToLedger(proposals) {
  const isMongoConnected = mongoose.connection.readyState === 1;
  const processed = [];

  for (const p of proposals) {
    if (isMongoConnected) {
      // Transition previous active proposals targeting the same recommendationId to SUPERSEDED
      await PhoenixTuningProposal.updateMany(
        { recommendationId: p.recommendationId, status: "APPROVED_FOR_MANUAL_REVIEW" },
        { $set: { status: "REJECTED" } } // Or superceded/rejected
      );

      const exists = await PhoenixTuningProposal.findOne({ recommendationId: p.recommendationId });
      if (!exists) {
        const newDoc = new PhoenixTuningProposal(p);
        const saved = await newDoc.save();
        processed.push(saved.toObject());
      } else {
        processed.push(exists.toObject());
      }
    } else {
      // Local cache transitions
      Array.from(localPhoenixTuningProposals.values()).forEach(prev => {
        if (prev.recommendationId === p.recommendationId && prev.status === "APPROVED_FOR_MANUAL_REVIEW") {
          const updated = { ...prev, status: "REJECTED" };
          localPhoenixTuningProposals.set(prev.proposalId, phoenixDeepFreeze(updated));
        }
      });

      if (!localPhoenixTuningProposals.has(p.proposalId)) {
        const frozen = phoenixDeepFreeze({ ...p });
        localPhoenixTuningProposals.set(p.proposalId, frozen);
        processed.push(frozen);
      } else {
        processed.push(localPhoenixTuningProposals.get(p.proposalId));
      }
    }
  }

  return phoenixDeepFreeze(processed);
}

/**
 * Queries proposals (Read-Only)
 */
export async function getTuningProposals(filter = {}, options = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const query = PhoenixTuningProposal.find(filter);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(options.limit);
    if (options.skip) query.skip(options.skip);

    const docs = await query.exec();
    return phoenixDeepFreeze(docs.map(doc => doc.toObject()));
  } else {
    let list = Array.from(localPhoenixTuningProposals.values());
    
    Object.keys(filter).forEach(key => {
      list = list.filter(item => {
        const val = item[key];
        return val === filter[key];
      });
    });

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return phoenixDeepFreeze(list);
  }
}
