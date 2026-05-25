import mongoose from "mongoose";
import { config } from "./env.js";

// database.js owns the MongoDB connection.
// Future Mongoose models will use this connection automatically.
export async function connectDatabase() {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log("MongoDB status: connected");

    return {
      connected: true,
    };
  } catch (error) {
    console.warn(`MongoDB status: disconnected (${error.message})`);
    console.warn("Backend will keep running. Configure MONGODB_URI when ready.");

    return {
      connected: false,
      error: error.message,
    };
  }
}
