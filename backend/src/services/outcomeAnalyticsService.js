import { getOutcomes } from "./signalOutcomeStore.js";
import { getChannelPerformances } from "./channelPerformanceService.js";
import { getPairPerformances } from "./pairPerformanceService.js";

/**
 * Calculates outcome analytics, data readiness metrics, historical coverage, and intelligence readiness scores.
 * @returns {Promise<Object>} The aggregated readiness summary.
 */
export async function getOutcomeSummary() {
  const outcomes = await getOutcomes(10000);
  const channelPerformances = await getChannelPerformances();
  const pairPerformances = await getPairPerformances();

  // 1. Outcome analytics counts
  const totalSignalsTracked = outcomes.length;
  let activeSignalsCount = 0;
  let completedSignals = 0;
  let fullTpCount = 0;
  let partialTpCount = 0;
  let slHitCount = 0;
  let expiredCount = 0;
  let cancelledCount = 0;

  // Channel dates lookup
  const channelDates = {};

  outcomes.forEach((o) => {
    const status = o.status;
    const channel = o.channel;
    const date = o.createdAt ? new Date(o.createdAt) : null;

    if (status === "ACTIVE" || status === "PENDING") {
      activeSignalsCount++;
    } else {
      completedSignals++;
    }

    switch (status) {
      case "FULL_TP":
        fullTpCount++;
        break;
      case "PARTIAL_TP":
        partialTpCount++;
        break;
      case "SL_HIT":
        slHitCount++;
        break;
      case "EXPIRED":
        expiredCount++;
        break;
      case "CANCELLED":
        cancelledCount++;
        break;
    }

    if (channel && date) {
      if (!channelDates[channel]) {
        channelDates[channel] = { first: date, latest: date };
      } else {
        if (date < channelDates[channel].first) channelDates[channel].first = date;
        if (date > channelDates[channel].latest) channelDates[channel].latest = date;
      }
    }
  });

  // 2. Data Readiness metrics
  const reliabilityEligibleChannels = channelPerformances.filter((c) => c.isReliabilityEligible).length;
  const reliabilityIneligibleChannels = channelPerformances.filter((c) => !c.isReliabilityEligible).length;
  const pairEligibleRecords = pairPerformances.filter((p) => p.isEligible).length;
  const pairIneligibleRecords = pairPerformances.filter((p) => !p.isEligible).length;

  // 3. Historical Coverage Metrics
  const historicalCoverage = channelPerformances.map((c) => {
    const dates = channelDates[c.channel] || {};
    return {
      channel: c.channel,
      firstSignalDate: dates.first ? dates.first.toISOString() : null,
      latestSignalDate: dates.latest ? dates.latest.toISOString() : null,
      completedSignals: c.completedSignals,
    };
  });

  // 4. Intelligence Readiness Score
  // HIGH: completedSignals >= 200 && reliabilityEligibleChannels >= 3 && pairEligibleRecords >= 5
  // MEDIUM: completedSignals >= 50 && reliabilityEligibleChannels >= 1 && pairEligibleRecords >= 2
  // LOW: otherwise
  let readinessLevel = "LOW";
  let weightedConsensusRecommended = false;

  if (completedSignals >= 200 && reliabilityEligibleChannels >= 3 && pairEligibleRecords >= 5) {
    readinessLevel = "HIGH";
    weightedConsensusRecommended = true;
  } else if (completedSignals >= 50 && reliabilityEligibleChannels >= 1 && pairEligibleRecords >= 2) {
    readinessLevel = "MEDIUM";
    weightedConsensusRecommended = false;
  } else {
    readinessLevel = "LOW";
    weightedConsensusRecommended = false;
  }

  return {
    totalSignalsTracked,
    activeSignals: activeSignalsCount,
    completedSignals,
    fullTpCount,
    partialTpCount,
    slHitCount,
    expiredCount,
    cancelledCount,
    reliabilityEligibleChannels,
    reliabilityIneligibleChannels,
    pairEligibleRecords,
    pairIneligibleRecords,
    readinessLevel,
    weightedConsensusRecommended,
    historicalCoverage,
  };
}
