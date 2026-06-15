import { getChannelPerformances } from "../services/channelPerformanceService.js";
import { logger } from "../utils/logger.js";

/**
 * Controller to fetch all aggregated channel performance statistics
 */
export async function getChannelPerformanceController(req, res) {
  try {
    const performances = await getChannelPerformances();
    
    // Explicit projection of fields requested by user
    const projected = performances.map((p) => ({
      channel: p.channel,
      totalSignals: p.totalSignals,
      winRate: p.winRate,
      fullTpCount: p.fullTpCount,
      partialTpCount: p.partialTpCount,
      slHitCount: p.slHitCount,
      expiredCount: p.expiredCount,
      cancelledCount: p.cancelledCount,
      // Supporting metadata for frontend convenience
      targetAchievementRate: p.targetAchievementRate,
      expiryRate: p.expiryRate,
      avgTpDurationMinutes: p.avgTpDurationMinutes,
      avgSlDurationMinutes: p.avgSlDurationMinutes,
      isReliabilityEligible: p.isReliabilityEligible,
      completedSignals: p.completedSignals,
    }));

    return res.status(200).json(projected);
  } catch (error) {
    logger.error("api.get_channel_performance_failed", { error: error.message });
    return res.status(500).json({ error: "Failed to retrieve channel performance stats" });
  }
}
