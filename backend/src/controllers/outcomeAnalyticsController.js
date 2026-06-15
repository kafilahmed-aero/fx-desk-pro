import { getOutcomeSummary } from "../services/outcomeAnalyticsService.js";
import { logger } from "../utils/logger.js";

/**
 * Controller to fetch outcome history validation and intelligence readiness summary
 */
export async function getOutcomeSummaryController(req, res) {
  try {
    const summary = await getOutcomeSummary();
    return res.status(200).json(summary);
  } catch (error) {
    logger.error("api.get_outcome_summary_failed", { error: error.message });
    return res.status(500).json({ error: "Failed to retrieve outcome summary analytics" });
  }
}
