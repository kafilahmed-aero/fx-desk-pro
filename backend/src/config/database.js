import mongoose from "mongoose";
import { config } from "./env.js";
import { logger } from "../utils/logger.js";

// database.js owns the MongoDB connection.
// Future Mongoose models will use this connection automatically.
export async function connectDatabase() {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 3000,
    });
    logger.info("database.connected");

    return {
      connected: true,
    };
  } catch (error) {
    logger.warn("database.disconnected", {
      error: error.message,
    });

    return {
      connected: false,
      error: error.message,
    };
  }
}
