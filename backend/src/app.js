import cors from "cors";
import express from "express";
import { config } from "./config/env.js";
import healthRoutes from "./routes/healthRoutes.js";

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

  return app;
}
