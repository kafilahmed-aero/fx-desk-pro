import "dotenv/config";
import { createApp } from "./src/app.js";
import { connectDatabase } from "./src/config/database.js";
import { config } from "./src/config/env.js";
import { createTelegramClient } from "./src/services/telegramClient.js";

// server.js is the backend entry point.
// It loads configuration, prepares external services, and starts Express.
const app = createApp();

async function startServer() {
  await connectDatabase();

  // Telegram is prepared at startup so future fetching services can reuse it.
  // The client is not connected automatically until credentials are configured.
  createTelegramClient();

  app.listen(config.port, () => {
    console.log("Backend running");
    console.log(`Server port: ${config.port}`);
    console.log(`Local URL: http://localhost:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
