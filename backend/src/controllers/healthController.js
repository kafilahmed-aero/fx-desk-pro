import { getLiveStabilitySnapshot } from "../services/liveStabilityService.js";
import { logger } from "../utils/logger.js";
import { getRawMessages } from "../services/rawMessageStore.js";
import { getParsedSignals } from "../services/parsedSignalStore.js";

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

export async function getDebugSignals(_request, response) {
  try {
    const raw = await getRawMessages(5);
    const parsed = await getParsedSignals(5);
    response.json({ raw, parsed });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}
