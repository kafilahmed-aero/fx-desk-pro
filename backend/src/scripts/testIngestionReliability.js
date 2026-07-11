import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import { RawMessage } from "../models/rawMessageModel.js";
import {
  storeRawMessage,
  getQueuedMessagesCount,
  flushOfflineQueue
} from "../services/rawMessageStore.js";
import {
  pollTelegramChannels,
  getTelegramIngestionMetrics,
  startTelegramListener,
  stopTelegramListener
} from "../services/telegramIngestionService.js";
import { TelegramClient } from "telegram";

const OFFLINE_QUEUE_FILE = path.resolve(process.cwd(), "data", "offline_telegram_queue.json");

// Helper assert function
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`[PASS] ${msg}`);
  } else {
    failed++;
    console.error(`[FAIL] ${msg}`);
  }
}

// Mock Mongoose connection state helper
let mockConnectionState = 1;
Object.defineProperty(mongoose.connection, 'readyState', {
  get: () => mockConnectionState,
  configurable: true
});

// Mock RawMessage.create
const dbMessages = [];
RawMessage.create = async (msg) => {
  if (mockConnectionState !== 1) {
    throw new Error("DB Connection Error");
  }
  const saved = {
    ...msg,
    _id: new mongoose.Types.ObjectId(),
    toObject: () => msg
  };
  dbMessages.push(saved);
  return saved;
};

// Mock TelegramClient prototype methods
TelegramClient.prototype.connect = async function() {
  this.connected = true;
};
TelegramClient.prototype.getMe = async function() {
  return { id: 12345, username: "MockUser" };
};
TelegramClient.prototype.getEntity = async function(ref) {
  return { id: 99999, username: ref, title: `Mock ${ref}` };
};
TelegramClient.prototype.getMessages = async function() {
  return [];
};

async function runTests() {
  console.log("=== STARTING TELEGRAM INGESTION RELIABILITY TEST ===");

  // Cleanup pre-existing queue file if any
  try {
    await fs.unlink(OFFLINE_QUEUE_FILE);
  } catch (e) {}

  // ==========================================
  // Test 1: Polling guard try/finally safety
  // ==========================================
  console.log("\n--- TEST 1: Polling Lock try/finally Safety ---");
  
  // Setup: make connectTelegramWithSavedSession throw synchronously
  const originalConnect = TelegramClient.prototype.connect;
  TelegramClient.prototype.connect = async () => {
    throw new Error("Simulated GramJS Connect Crash");
  };

  // Trigger listener & polling
  await startTelegramListener();
  await pollTelegramChannels();

  const metricsAfterCrash = getTelegramIngestionMetrics();
  assert(metricsAfterCrash.pollingInProgress === false, "pollingInProgress is reset to false after a polling loop exception.");
  assert(metricsAfterCrash.lastError && metricsAfterCrash.lastError.includes("Simulated GramJS Connect Crash"), "lastError metric is updated with the correct exception message.");

  // Restore client connect method
  TelegramClient.prototype.connect = originalConnect;

  // ==========================================
  // Test 2: Disk-Backed Offline Queue under MongoDB Outage
  // ==========================================
  console.log("\n--- TEST 2: Disk-Backed Offline Queue under DB Outage ---");
  
  mockConnectionState = 0; // Simulate Mongo disconnected
  console.log("[TEST] Simulated MongoDB offline (readyState = 0).");

  const testMessage = {
    channel: "TestChannel",
    messageId: 1001,
    text: "Test signal BUY XAUUSD @ 2025",
    timestamp: new Date().toISOString()
  };

  const storeRes = await storeRawMessage(testMessage);
  assert(storeRes.stored === true, "storeRawMessage returns stored: true even when MongoDB is offline.");
  
  const count = getQueuedMessagesCount();
  assert(count === 1, `queuedMessagesCount is exactly 1 (current: ${count}).`);

  // Assert local queue file exists and has correct contents
  try {
    const fileContent = await fs.readFile(OFFLINE_QUEUE_FILE, "utf-8");
    const arr = JSON.parse(fileContent);
    assert(arr.length === 1, "offline_telegram_queue.json contains exactly 1 queued message.");
    assert(arr[0].messageId === 1001, "Stored message has correct messageId (1001).");
  } catch (e) {
    assert(false, "offline_telegram_queue.json file was not successfully created or read.");
  }

  // ==========================================
  // Test 3: Flush Offline Queue on MongoDB Reconnect
  // ==========================================
  console.log("\n--- TEST 3: Queue Flush on MongoDB Reconnection ---");

  mockConnectionState = 1; // Simulate Mongo reconnected
  console.log("[TEST] Simulated MongoDB online (readyState = 1).");

  // Call flush
  await flushOfflineQueue();

  const countAfterFlush = getQueuedMessagesCount();
  assert(countAfterFlush === 0, `queuedMessagesCount goes back to 0 (current: ${countAfterFlush}).`);

  // Assert queue file is deleted or empty
  let fileExists = true;
  try {
    await fs.access(OFFLINE_QUEUE_FILE);
  } catch (e) {
    fileExists = false;
  }
  assert(fileExists === false, "offline_telegram_queue.json is cleaned up after successful flush.");

  // Assert message was written to mock DB array
  const foundInDb = dbMessages.some(msg => msg.messageId === 1001);
  assert(foundInDb === true, "Queued message was successfully flushed and saved to MongoDB.");

  // Cleanup
  await stopTelegramListener();

  console.log(`\n=== TEST SUMMARY: ${passed} Passed, ${failed} Failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test execution encountered unexpected crash:", err);
  process.exit(1);
});
