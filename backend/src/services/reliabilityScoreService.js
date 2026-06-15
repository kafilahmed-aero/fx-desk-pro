import { getChannelPerformances } from "./channelPerformanceService.js";

const MINIMUM_SIGNALS_REQUIRED = 20;

/**
 * Calculates reliability score and confidence tier for a channel performance record
 * @param {Object} perf ChannelPerformance record
 * @returns {Object} { reliabilityScore: Number, confidenceTier: String, isReliabilityEligible: Boolean }
 */
export function calculateReliability(perf) {
  const winRate = perf.winRate ?? 0.0;
  const targetAchievementRate = perf.targetAchievementRate ?? 0.0;
  const expiryRate = perf.expiryRate ?? 0.0;
  const completedSignals = perf.completedSignals ?? 0;

  // Volume factor is completedSignals / 100, capped at 1.0
  const volumeFactor = Math.min(completedSignals / 100, 1.0);

  // Score formula
  const rawScore = (
    winRate * 0.50 +
    targetAchievementRate * 0.25 +
    (1.0 - expiryRate) * 0.15 +
    volumeFactor * 0.10
  ) * 100;

  const reliabilityScore = Number(rawScore.toFixed(2));
  const isReliabilityEligible = completedSignals >= MINIMUM_SIGNALS_REQUIRED;

  let confidenceTier = "UNRATED";
  if (isReliabilityEligible) {
    if (reliabilityScore >= 90) {
      confidenceTier = "A+";
    } else if (reliabilityScore >= 80) {
      confidenceTier = "A";
    } else if (reliabilityScore >= 70) {
      confidenceTier = "B";
    } else if (reliabilityScore >= 60) {
      confidenceTier = "C";
    } else {
      confidenceTier = "D";
    }
  }

  return {
    reliabilityScore,
    confidenceTier,
    isReliabilityEligible,
  };
}

/**
 * Retrieves all channels, computes reliability scores, and returns them sorted by score and completed signals
 * @returns {Promise<Array<Object>>}
 */
export async function getReliabilityScores() {
  const performances = await getChannelPerformances();

  const scores = performances.map((p) => {
    const calc = calculateReliability(p);
    return {
      channel: p.channel,
      completedSignals: p.completedSignals,
      winRate: p.winRate,
      targetAchievementRate: p.targetAchievementRate,
      expiryRate: p.expiryRate,
      minimumSignalsRequired: MINIMUM_SIGNALS_REQUIRED,
      ...calc,
    };
  });

  // Sort: 1. reliabilityScore DESC, 2. completedSignals DESC
  return scores.sort((a, b) => {
    if (b.reliabilityScore !== a.reliabilityScore) {
      return b.reliabilityScore - a.reliabilityScore;
    }
    return b.completedSignals - a.completedSignals;
  });
}
