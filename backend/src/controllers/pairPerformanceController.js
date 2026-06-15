import { getPairPerformances } from "../services/pairPerformanceService.js";
import { logger } from "../utils/logger.js";

/**
 * Controller to fetch all aggregated pair performance statistics
 */
export async function getPairPerformanceController(req, res) {
  try {
    const performances = await getPairPerformances();
    
    // Explicit projection of fields requested by user and additions
    const projected = performances.map((p) => ({
      channelPairKey: p.channelPairKey,
      channel: p.channel,
      pair: p.pair,
      totalSignals: p.totalSignals,
      completedSignals: p.completedSignals,
      fullTpCount: p.fullTpCount,
      partialTpCount: p.partialTpCount,
      slHitCount: p.slHitCount,
      expiredCount: p.expiredCount,
      cancelledCount: p.cancelledCount,
      winRate: p.winRate,
      targetAchievementRate: p.targetAchievementRate,
      avgTpDurationMinutes: p.avgTpDurationMinutes,
      avgSlDurationMinutes: p.avgSlDurationMinutes,
      minimumSignalsRequired: p.minimumSignalsRequired ?? 20,
      isEligible: p.isEligible,
    }));

    return res.status(200).json(projected);
  } catch (error) {
    logger.error("api.get_pair_performance_failed", { error: error.message });
    return res.status(500).json({ error: "Failed to retrieve pair performance stats" });
  }
}
