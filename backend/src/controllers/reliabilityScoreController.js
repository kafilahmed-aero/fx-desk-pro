import { getReliabilityScores } from "../services/reliabilityScoreService.js";
import { logger } from "../utils/logger.js";

/**
 * Controller to fetch all calculated channel reliability scores and confidence tiers
 */
export async function getReliabilityScoresController(req, res) {
  try {
    const scores = await getReliabilityScores();
    return res.status(200).json(scores);
  } catch (error) {
    logger.error("api.get_reliability_scores_failed", { error: error.message });
    return res.status(500).json({ error: "Failed to retrieve reliability scores" });
  }
}
