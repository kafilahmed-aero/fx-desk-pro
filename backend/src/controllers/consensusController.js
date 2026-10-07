import { getConsensusSummary } from "../services/consensusService.js";
import {
  getActiveOpportunities,
  getActivePairStates,
  getLiveConsensus,
  getLiveMarketOverview,
  getWeightedConsensus,
} from "../services/activeOpportunityService.js";
import { hydratePairStatesFromDb } from "../services/pairStateHydrationService.js";
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

export async function getActivePairStatesController(_request, response) {
  logger.debug("api.active_pair_states_served");

  let pairs = getActivePairStates();
  if (pairs.length === 0) {
    try {
      await hydratePairStatesFromDb();
      pairs = getActivePairStates();
    } catch (_err) {}
  }

  response.json({
    pairs,
  });
}

export function getLiveConsensusController(_request, response) {
  logger.debug("api.live_consensus_served");

  response.json({
    pairs: getLiveConsensus(),
  });
}

export async function getActiveOpportunitiesController(_request, response) {
  logger.debug("api.active_opportunities_served");

  let opportunities = getActiveOpportunities();
  if (opportunities.length === 0) {
    try {
      await hydratePairStatesFromDb();
      opportunities = getActiveOpportunities();
    } catch (_err) {}
  }

  response.json({
    opportunities,
  });
}

export async function getWeightedConsensusController(_request, response) {
  logger.debug("api.weighted_consensus_served");

  let pairs = getWeightedConsensus();
  if (pairs.length === 0) {
    try {
      await hydratePairStatesFromDb();
      pairs = getWeightedConsensus();
    } catch (_err) {}
  }

  response.json({
    pairs,
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
