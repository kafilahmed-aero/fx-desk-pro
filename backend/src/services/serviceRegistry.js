import { logger } from "../utils/logger.js";
import { connectDatabase } from "../config/database.js";
import { hydratePairStatesFromDb } from "./pairStateHydrationService.js";
import { startMarketEngine } from "./marketEngineService.js";
import { startPriceMonitoring } from "./priceMonitoringScheduler.js";
import { startMt5SyncService } from "./mt5SyncService.js";
import { startAiRecommendationScheduler } from "./aiRecommendationStateService.js";
import { startOutcomeTracker } from "./aiDecisionValidationService.js";
import { generateRecommendationIfNeeded } from "./aiRecommendationStateService.js";
import { startTelegramListener } from "./telegramIngestionService.js";
import { startKeepAlive } from "./keepAliveService.js";
import { initPositionManager } from "./positionManagerService.js";

const services = [
  {
    name: "Database Connection",
    start: async () => {
      const dbRes = await connectDatabase();
      if (!dbRes || !dbRes.connected) {
        throw new Error(dbRes?.error || "Connection response indicated failure");
      }
      logger.info("STARTUP 1 Database Connected");
      
      // Hydrate pair states on database connect success
      try {
        await hydratePairStatesFromDb();
      } catch (err) {
        logger.error("Startup database hydration failed", { error: err.message });
      }
    }
  },
  {
    name: "Keep Alive Service",
    start: async () => {
      startKeepAlive();
    }
  },
  {
    name: "Price Feeds & MT5 Bridge",
    start: async (server) => {
      startMarketEngine();
      startPriceMonitoring();
      startMt5SyncService(server);
      logger.info("STARTUP 2 Price Scheduler Started");
    }
  },
  {
    name: "AI Recommendation Scheduler",
    start: async () => {
      if (global.mockSchedulerCrash) {
        throw new Error("Mock Scheduler Crash");
      }
      startAiRecommendationScheduler();
      startOutcomeTracker();
      
      // Initial recommendation generation cycle (non-blocking async)
      generateRecommendationIfNeeded("STARTUP").catch((err) => {
        logger.warn("server.initial_recommendation_failed", { error: err.message });
      });
      
      logger.info("STARTUP 3 AI Scheduler Started");
    }
  },
  {
    name: "Telegram Ingestion Listener",
    start: async () => {
      const telRes = await startTelegramListener();
      if (telRes && telRes.started) {
        logger.info("STARTUP 4 Telegram Listener Started");
      } else {
        logger.warn("STARTUP 4 Telegram Listener skipped or failed to start", { reason: telRes?.error || "skipped" });
      }
    }
  },
  {
    name: "Phoenix Position Manager",
    start: async () => {
      initPositionManager();
      logger.info("STARTUP 5 Phoenix Position Manager Started");
    }
  }
];

export async function initializeAllServices(server) {
  logger.info("Background Service Registry initialization sequence starting...");
  let stage = 1;
  for (const service of services) {
    try {
      logger.info(`STARTUP STAGE ${stage}: Initializing ${service.name}...`);
      await service.start(server);
      logger.info(`STARTUP STAGE ${stage} COMPLETE: ${service.name} initialized.`);
    } catch (err) {
      logger.error(`STARTUP STAGE ${stage} FAILED: ${service.name} failed to start.`, { error: err.message });
    }
    stage++;
  }
  logger.info("STARTUP COMPLETE");
}
