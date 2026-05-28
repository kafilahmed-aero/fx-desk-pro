import cors from "cors";
import express from "express";
import { config } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import consensusRoutes from "./routes/consensusRoutes.js";
import debugRoutes from "./routes/debugRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import rawMessageRoutes from "./routes/rawMessageRoutes.js";
import signalRoutes from "./routes/signalRoutes.js";
import { requireAuth } from "./middleware/authMiddleware.js";

// app.js owns the Express application setup.
// Middleware, route registration, and API-level defaults live here.
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.clientUrls.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin not allowed by CORS"));
      },
      credentials: true,
    })
  );
  app.use(express.json());

  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/raw-messages", requireAuth, rawMessageRoutes);
  app.use("/api/signals", requireAuth, signalRoutes);
  app.use("/api/consensus", requireAuth, consensusRoutes);
  app.use("/api/debug", requireAuth, debugRoutes);

  return app;
}
