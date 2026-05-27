import { getLiveStabilitySnapshot } from "../services/liveStabilityService.js";
import { logger } from "../utils/logger.js";

// controllers contain request handlers.
// Keeping handlers here prevents route files from growing too large.
export function getHealth(_request, response) {
  response.json({
    status: "Backend running",
  });
}

export function getLiveStability(_request, response) {
  logger.debug("api.live_stability_requested");

  response.json({
    stability: getLiveStabilitySnapshot(),
  });
}
