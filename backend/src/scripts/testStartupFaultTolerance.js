import "dotenv/config";
import mongoose from "mongoose";
import { TelegramClient } from "telegram";
import { RawMessage } from "../models/rawMessageModel.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { initializeBackgroundServices } from "../../server.js";
import { getTelegramIngestionMetrics } from "../services/telegramIngestionService.js";

// Mock Mongoose readyState
Object.defineProperty(mongoose.connection, 'readyState', {
  get: function() { return 1; },
  configurable: true
});

// Mock Mongoose connection db object to avoid crashing mt5 change stream
mongoose.connection.db = {
  collection: () => ({
    watch: () => ({
      on: () => {}
    })
  })
};

// Mock Models to prevent real MongoDB operations
RawMessage.create = async (msg) => ({ toObject: () => msg });
ParsedSignal.find = () => ({
  sort: () => ({
    lean: async () => []
  })
});
AiRecommendationOutcome.find = () => ({
  sort: () => ({
    lean: async () => []
  })
});

// Mock GramJS TelegramClient methods to prevent real network calls
TelegramClient.prototype.connect = async function() {
  // Mock connection success
};
Object.defineProperty(TelegramClient.prototype, 'connected', {
  get: function() { return true; },
  configurable: true
});
TelegramClient.prototype.getMe = async function() {
  return { id: 12345, username: "MockUser" };
};
TelegramClient.prototype.getEntity = async function(ref) {
  return {
    id: 99999,
    username: ref,
    title: `Mock ${ref}`,
  };
};
TelegramClient.prototype.getMessages = async function() {
  return [];
};

async function runTest() {
  console.log("=== STARTING STARTUP FAULT TOLERANCE REGRESSION TEST ===");

  // Step 1: Arm the global crash flag for AI Scheduler
  global.mockSchedulerCrash = true;
  console.log("[TEST] Configured global.mockSchedulerCrash = true.");

  // Mock server object
  const mockServer = {
    address: () => ({ port: 5000 }),
    prependListener: () => {}
  };

  let testPassed = false;

  try {
    // Step 2: Invoke initializeBackgroundServices
    console.log("[TEST] Invoking initializeBackgroundServices...");
    await initializeBackgroundServices(mockServer);

    // Step 3: Assert that Telegram listener successfully started despite AI Scheduler crash
    const metrics = getTelegramIngestionMetrics();
    console.log("[TEST] Telegram Ingestion metrics fetched:", {
      listenerRunning: metrics.listenerRunning,
      reconnectAttempts: metrics.reconnectAttempts,
      lastError: metrics.lastError
    });

    if (metrics.listenerRunning) {
      testPassed = true;
      console.log("\n[PASS] Telegram Ingestion listener successfully running despite AI Scheduler failure!");
    } else {
      console.error("\n[FAIL] Telegram Ingestion listener is NOT running.");
    }
  } catch (err) {
    console.error("\n[FAIL] Startup test encountered an unhandled exception:", err);
  } finally {
    // Reset global crash flag and clean up intervals
    global.mockSchedulerCrash = false;
    process.exit(testPassed ? 0 : 1);
  }
}

runTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
