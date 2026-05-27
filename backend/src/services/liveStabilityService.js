import { getActiveOpportunities, getLiveMarketOverview } from "./activeOpportunityService.js";
import { getMarketEngineMetrics } from "./marketEngineService.js";
import { getProcessingQueueMetrics } from "./messageProcessingQueue.js";
import { getTelegramIngestionMetrics } from "./telegramIngestionService.js";

export function getLiveStabilitySnapshot() {
  const memory = process.memoryUsage();
  const overview = getLiveMarketOverview();
  const opportunities = getActiveOpportunities();
  const queue = getProcessingQueueMetrics();
  const telegram = getTelegramIngestionMetrics();
  const marketEngine = getMarketEngineMetrics();

  return {
    timestamp: new Date().toISOString(),
    status: getStabilityStatus({ queue, telegram, marketEngine }),
    overview: {
      pairCount: overview.pairCount,
      signalCount: overview.signalCount,
      marketBias: overview.marketBias,
      strongestPair: overview.strongestOpportunity?.pair || null,
    },
    opportunities: opportunities.map((opportunity) => ({
      pair: opportunity.pair,
      marketDirection: opportunity.marketDirection,
      confidenceScore: opportunity.confidenceScore,
      buyConfidence: opportunity.buyConfidence,
      sellConfidence: opportunity.sellConfidence,
      signalCount: opportunity.signalCount,
      freshnessLevel: opportunity.freshnessLevel,
      buyZones: opportunity.buyZones,
      sellZones: opportunity.sellZones,
      entryZone: opportunity.entryZone,
      tpZone: opportunity.tpZone,
      slZone: opportunity.slZone,
      lastUpdated: opportunity.lastUpdated,
    })),
    telegram,
    marketEngine,
    queue,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: {
        rss: toMegabytes(memory.rss),
        heapUsed: toMegabytes(memory.heapUsed),
        heapTotal: toMegabytes(memory.heapTotal),
        external: toMegabytes(memory.external),
      },
      cpuUsage: process.cpuUsage(),
    },
  };
}

function getStabilityStatus({ queue, telegram, marketEngine }) {
  if (queue.droppedCount > 0 || queue.failedCount > 0) {
    return "DEGRADED";
  }

  if (telegram.channelFetchFailures > 0 || marketEngine.refreshFailures > 0) {
    return "WATCH";
  }

  return "OK";
}

function toMegabytes(value) {
  return Number((value / 1024 / 1024).toFixed(2));
}
