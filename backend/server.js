import "dotenv/config";
import { createApp } from "./src/app.js";
import { connectDatabase } from "./src/config/database.js";
import { config } from "./src/config/env.js";
import { getSessionCookieStartupLogDetails } from "./src/config/sessionCookie.js";
import {
  startTelegramListener,
  stopTelegramListener,
} from "./src/services/telegramIngestionService.js";
import {
  startMarketEngine,
  stopMarketEngine,
} from "./src/services/marketEngineService.js";
import {
  startPerformanceAggregation,
  stopPerformanceAggregation,
} from "./src/services/channelPerformanceScheduler.js";
import {
  startPairPerformanceAggregation,
  stopPairPerformanceAggregation,
} from "./src/services/pairPerformanceScheduler.js";
import {
  startPriceMonitoring,
  stopPriceMonitoring,
} from "./src/services/priceMonitoringScheduler.js";
import { logger } from "./src/utils/logger.js";
import { hydratePairStatesFromDb } from "./src/services/pairStateHydrationService.js";
import {
  startKeepAlive,
  stopKeepAlive,
} from "./src/services/keepAliveService.js";

// server.js is the backend entry point.
// It loads configuration, prepares external services, and starts Express.
const app = createApp();
const bindHost = "0.0.0.0";

async function startServer() {
  const server = app.listen(config.port, bindHost, () => {
    const address = server.address();
    logger.info("server.started", {
      host: bindHost,
      port: typeof address === "object" ? address.port : config.port,
      nodeEnv: config.nodeEnv,
    });
    logger.info("auth.cookie_config_resolved", getSessionCookieStartupLogDetails());
  });

  server.on("error", (error) => {
    logger.error("server.listen_failed", {
      error: error.message,
      port: config.port,
    });
    process.exit(1);
  });

  // Telegram ingestion runs in the backend process, not in the frontend.
  // If no saved session is available yet, the API still runs and logs the setup gap.
  initializeBackgroundServices().catch((error) => {
    logger.error("server.background_services_failed", {
      error: error.message,
    });
  });

  const shutdown = async () => {
    stopKeepAlive();
    stopMarketEngine();
    stopPriceMonitoring();
    stopPerformanceAggregation();
    stopPairPerformanceAggregation();
    await stopTelegramListener();
    server.close(() => {
      logger.info("server.stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function initializeBackgroundServices() {
  startKeepAlive();
  await connectDatabase();
  await hydratePairStatesFromDb();
  startMarketEngine();
  startPriceMonitoring();
  startPerformanceAggregation();
  startPairPerformanceAggregation();
  await startTelegramListener();
}

startServer().catch((error) => {
  logger.error("server.start_failed", {
    error: error.message,
  });
  process.exit(1);
});
