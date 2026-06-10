import { getPairState, updatePairStateFromSignal, resetPairStateStore } from "../services/pairStateEngine.js";
import { logger } from "../utils/logger.js";

// Disable noisy logging during test
logger.level = "silent";

async function runVerification() {
  console.log("=== VERIFYING LAST UPDATED TIMESTAMP ===");

  // Reset the pair state store to ensure a clean test environment
  resetPairStateStore();

  const pair = "GBPUSD";

  const now = new Date();
  // Create two signals: one earlier (9 mins ago) and one later (2 mins ago)
  const earlierTimestamp = new Date(now.getTime() - 9 * 60 * 1000).toISOString();
  const laterTimestamp = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

  console.log(`Step 1: Adding earlier signal for ${pair} with timestamp: ${earlierTimestamp}`);
  updatePairStateFromSignal({
    pair,
    action: "BUY",
    entry: 1.2500,
    classification: "NEW_SIGNAL",
    parserClassification: "NEW_SIGNAL",
    signalState: "ACTIVE",
    createdAt: earlierTimestamp,
    channel: "test-channel",
    messageId: 1
  }, now);

  let state = getPairState(pair, now);
  console.log(`Result: pairState.lastUpdated = ${state.lastUpdated}`);
  if (state.lastUpdated !== earlierTimestamp) {
    throw new Error(`Expected lastUpdated to be ${earlierTimestamp}, but got ${state.lastUpdated}`);
  }

  console.log(`\nStep 2: Adding later signal for ${pair} with timestamp: ${laterTimestamp}`);
  updatePairStateFromSignal({
    pair,
    action: "BUY",
    entry: 1.2510,
    classification: "NEW_SIGNAL",
    parserClassification: "NEW_SIGNAL",
    signalState: "ACTIVE",
    createdAt: laterTimestamp,
    channel: "test-channel",
    messageId: 2
  }, now);

  state = getPairState(pair, now);
  console.log(`Result: pairState.lastUpdated = ${state.lastUpdated}`);
  if (state.lastUpdated !== laterTimestamp) {
    throw new Error(`Expected lastUpdated to be ${laterTimestamp}, but got ${state.lastUpdated}`);
  }

  console.log(`\nStep 3: Adding a third signal that is NOT active (e.g. CLOSED) with a newer timestamp: +1 min`);
  const newerClosedTimestamp = new Date(now.getTime() + 1 * 60 * 1000).toISOString();
  updatePairStateFromSignal({
    pair,
    action: "BUY",
    entry: 1.2520,
    classification: "NEW_SIGNAL",
    parserClassification: "NEW_SIGNAL",
    signalState: "CLOSED", // This should not contribute to the active pair state
    createdAt: newerClosedTimestamp,
    channel: "test-channel",
    messageId: 3
  }, now);

  state = getPairState(pair, now);
  console.log(`Result: pairState.lastUpdated = ${state.lastUpdated}`);
  if (state.lastUpdated !== laterTimestamp) {
    throw new Error(`Expected lastUpdated to remain ${laterTimestamp} (newest ACTIVE signal), but got ${state.lastUpdated}`);
  }

  console.log("\nVERIFICATION PASSED SUCCESSFULLY!");
}

runVerification().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exitCode = 1;
});
