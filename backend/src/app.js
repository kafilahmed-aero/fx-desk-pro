import cors from "cors";
import express from "express";
import { config } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import consensusRoutes from "./routes/consensusRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import rawMessageRoutes from "./routes/rawMessageRoutes.js";
import signalRoutes from "./routes/signalRoutes.js";
import channelPerformanceRoutes from "./routes/channelPerformanceRoutes.js";
import pairPerformanceRoutes from "./routes/pairPerformanceRoutes.js";
import reliabilityScoreRoutes from "./routes/reliabilityScoreRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
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
  app.use("/api/channel-performance", requireAuth, channelPerformanceRoutes);
  app.use("/api/pair-performance", requireAuth, pairPerformanceRoutes);
  app.use("/api/reliability-scores", requireAuth, reliabilityScoreRoutes);
  app.use("/api/system", requireAuth, systemRoutes);
  app.use("/api/ai", requireAuth, aiRoutes);

  return app;
}
