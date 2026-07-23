import { logger } from "../utils/logger.js";
import { connectDatabase } from "../config/database.js";
import { hydratePairStatesFromDb } from "./pairStateHydrationService.js";
import { startMarketEngine } from "./marketEngineService.js";
import { startPriceMonitoring } from "./priceMonitoringScheduler.js";
import { startMt5SyncService } from "./mt5SyncService.js";
import { startTelegramListener } from "./telegramIngestionService.js";
import { startKeepAlive } from "./keepAliveService.js";

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
    name: "Telegram Ingestion Listener",
    start: async () => {
      startTelegramListener().then((telRes) => {
        if (telRes && telRes.started) {
          logger.info("STARTUP 3 Telegram Listener Started");
        } else {
          logger.warn("STARTUP 3 Telegram Listener skipped or failed to start", { reason: telRes?.reason || "skipped" });
        }
      }).catch((err) => {
        logger.error("STARTUP 3 Telegram Listener failed", { error: err.message });
      });
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
