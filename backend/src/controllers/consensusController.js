import { getConsensusSummary } from "../services/consensusService.js";
import {
  getActiveOpportunities,
  getActivePairStates,
  getLiveConsensus,
  getLiveMarketOverview,
  getWeightedConsensus,
} from "../services/activeOpportunityService.js";
import { subscribeToLiveUpdates } from "../services/liveUpdateService.js";
import { logger } from "../utils/logger.js";

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
  logger.debug("api.active_pair_states_served");

  response.json({
    pairs: getActivePairStates(),
  });
}

export function getLiveConsensusController(_request, response) {
  logger.debug("api.live_consensus_served");

  response.json({
    pairs: getLiveConsensus(),
  });
}

export function getActiveOpportunitiesController(_request, response) {
  logger.debug("api.active_opportunities_served");

  response.json({
    opportunities: getActiveOpportunities(),
  });
}

export function getWeightedConsensusController(_request, response) {
  logger.debug("api.weighted_consensus_served");

  response.json({
    pairs: getWeightedConsensus(),
  });
}

export function getPairConsensusController(request, response) {
  const pair = String(request.params.pair || "").toUpperCase();
  const consensus = getWeightedConsensus(pair);

  logger.debug("api.pair_consensus_requested", { pair });

  if (!consensus) {
    response.status(404).json({
      error: "Pair consensus not found",
      pair,
    });
    return;
  }

  response.json({
    pair: consensus,
  });
}

export function getLiveMarketOverviewController(_request, response) {
  logger.debug("api.live_market_overview_served");

  response.json({
    overview: getLiveMarketOverview(),
  });
}

export function streamLiveConsensusEventsController(request, response) {
  logger.debug("api.live_consensus_event_stream_opened");

  subscribeToLiveUpdates(request, response);
}
