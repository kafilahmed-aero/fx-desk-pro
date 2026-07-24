import "dotenv/config";
import { createApp } from "./src/app.js";
import { connectDatabase } from "./src/config/database.js";
import { config } from "./src/config/env.js";
import { getSessionCookieStartupLogDetails } from "./src/config/sessionCookie.js";
import { stopTelegramListener } from "./src/services/telegramIngestionService.js";
import { stopMarketEngine } from "./src/services/marketEngineService.js";
import { stopPriceMonitoring } from "./src/services/priceMonitoringScheduler.js";
import { logger } from "./src/utils/logger.js";
import { stopKeepAlive } from "./src/services/keepAliveService.js";
import { initializeAllServices } from "./src/services/serviceRegistry.js";


import mongoose from "mongoose";

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
  initializeBackgroundServices(server).catch((error) => {
    logger.error("server.background_services_failed", {
      error: error.message,
    });
  });

  const shutdown = async () => {
    logger.info("Graceful shutdown sequence initiated...");
    
    // 1. Stop Telegram Ingestion
    await stopTelegramListener();

    // 2. Stop Price Monitoring
    stopPriceMonitoring();

    // 3. Stop Keep Alive & Market Engine
    stopKeepAlive();
    stopMarketEngine();


    // 4. Close Server
    server.close(async () => {
      logger.info("server.stopped");
      
      // 5. Disconnect Database
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        logger.info("database.disconnected");
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function initializeBackgroundServices(server) {
  await initializeAllServices(server);
}

startServer().catch((error) => {
  logger.error("server.start_failed", {
    error: error.message,
  });
  process.exit(1);
});
