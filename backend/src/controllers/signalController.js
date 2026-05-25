import {
  getParsedSignalCount,
  getParsedSignals,
} from "../services/parsedSignalStore.js";

export async function getSignalsController(request, response) {
  const limit = Number(request.query.limit) || 100;
  const filters = {
    activeOnly: request.query.activeOnly === "true",
    hideStale: request.query.hideStale === "true",
  };

  response.json({
    count: await getParsedSignalCount(),
    signals: await getParsedSignals(limit, filters),
  });
}
