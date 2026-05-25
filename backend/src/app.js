import cors from "cors";
import express from "express";
import { config } from "./config/env.js";
import consensusRoutes from "./routes/consensusRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import rawMessageRoutes from "./routes/rawMessageRoutes.js";
import signalRoutes from "./routes/signalRoutes.js";

// app.js owns the Express application setup.
// Middleware, route registration, and API-level defaults live here.
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.clientUrl,
    })
  );
  app.use(express.json());

  app.use("/api/health", healthRoutes);
  app.use("/api/raw-messages", rawMessageRoutes);
  app.use("/api/signals", signalRoutes);
  app.use("/api/consensus", consensusRoutes);

  return app;
}
