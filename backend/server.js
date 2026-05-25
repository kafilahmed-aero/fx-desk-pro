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

// server.js is the backend entry point.
// It loads configuration, prepares external services, and starts Express.
const app = createApp();

async function startServer() {
  await connectDatabase();

  const server = app.listen(config.port, () => {
    console.log("Backend running");
    console.log(`Server port: ${config.port}`);
    console.log(`Local URL: http://localhost:${config.port}`);
  });

  // Telegram ingestion runs in the backend process, not in the frontend.
  // If no saved session is available yet, the API still runs and logs the setup gap.
  startMarketEngine();
  await startTelegramListener();

  const shutdown = async () => {
    stopMarketEngine();
    await stopTelegramListener();
    server.close(() => {
      console.log("Backend stopped");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
