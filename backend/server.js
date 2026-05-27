import "dotenv/config";
import { createApp } from "./src/app.js";
import { connectDatabase } from "./src/config/database.js";
import { config } from "./src/config/env.js";
import {
  startTelegramListener,
  stopTelegramListener,
} from "./src/services/telegramIngestionService.js";
import {
  startMarketEngine,
  stopMarketEngine,
} from "./src/services/marketEngineService.js";
import { logger } from "./src/utils/logger.js";

// server.js is the backend entry point.
// It loads configuration, prepares external services, and starts Express.
const app = createApp();

async function startServer() {
  await connectDatabase();

  const server = app.listen(config.port, () => {
    logger.info("server.started", {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });
  });

  // Telegram ingestion runs in the backend process, not in the frontend.
  // If no saved session is available yet, the API still runs and logs the setup gap.
  startMarketEngine();
  await startTelegramListener();

  const shutdown = async () => {
    stopMarketEngine();
    await stopTelegramListener();
    server.close(() => {
      logger.info("server.stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  logger.error("server.start_failed", {
    error: error.message,
  });
  process.exit(1);
});
