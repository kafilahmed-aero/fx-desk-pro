import { getConsensusSummary } from "../services/consensusService.js";
import {
  getActiveOpportunities,
  getActivePairStates,
  getLiveConsensus,
} from "../services/activeOpportunityService.js";

export async function getConsensusController(request, response) {
  const limit = Number(request.query.limit) || 500;
  const latestLimit = Number(request.query.latestLimit) || 5;

  response.json({
    pairs: await getConsensusSummary({
      limit,
      latestLimit,
    }),
  });
}

export function getActivePairStatesController(_request, response) {
  response.json({
    pairs: getActivePairStates(),
  });
}

export function getLiveConsensusController(_request, response) {
  response.json({
    pairs: getLiveConsensus(),
  });
}

export function getActiveOpportunitiesController(_request, response) {
  response.json({
    opportunities: getActiveOpportunities(),
  });
}
