import { config } from "../config/env.js";
import { backfillChannelMessages, runStartupBackfill } from "../services/telegramIngestionService.js";
import { getRawMessages, getRawMessageCount } from "../services/rawMessageStore.js";
import { logger } from "../utils/logger.js";

// Force quiet logging for clean test output
logger.level = "warn";

async function runTests() {
  console.log("=== STARTING TELEGRAM STARTUP RECOVERY & BACKFILL TESTS ===");

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    if (condition) {
      passedTests++;
      console.log(`[PASS] ${message}`);
    } else {
      failedTests++;
      console.error(`[FAIL] ${message}`);
    }
  }

  // Clear in-memory raw messages between tests if needed, but since rawMessageStore doesn't expose a clear,
  // we can just use unique channel names for each scenario.

  // SCENARIO 1: Standard recovery (Signal posted 2 hours ago)
  try {
    const mockClient = {
      getEntity: async (channelRef) => ({
        id: "1001",
        username: "standard_channel",
        title: "Standard Channel",
      }),
      getMessages: async (entity, options) => {
        // Return 1 message dated 2 hours ago
        return [
          {
            id: 201,
            message: "BUY EURUSD ENTRY 1.0800 TP 1.0850 SL 1.0750",
            date: Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000),
            media: null,
          },
        ];
      },
    };

    config.telegram.backfillHours = 3;
    config.telegram.backfillLimit = 100;

    const metrics = await backfillChannelMessages(mockClient, "standard_channel");
    
    assert(metrics.messagesFetched === 1, "Scenario 1: Fetched 1 message");
    assert(metrics.messagesStored === 1, "Scenario 1: Stored 1 message (within 3-hour window)");
    assert(metrics.duplicateMessages === 0, "Scenario 1: No duplicates");
    assert(metrics.safetyLimitReached === false, "Scenario 1: Safety limit not reached");
  } catch (err) {
    console.error("Scenario 1 failed:", err);
    failedTests++;
  }

  // SCENARIO 2: Expired messages (Signal posted 4 hours ago)
  try {
    const mockClient = {
      getEntity: async (channelRef) => ({
        id: "1002",
        username: "expired_channel",
        title: "Expired Channel",
      }),
      getMessages: async (entity, options) => {
        // Return 1 message dated 4 hours ago (older than 3 hours)
        return [
          {
            id: 301,
            message: "BUY EURUSD ENTRY 1.0800 TP 1.0850 SL 1.0750",
            date: Math.floor((Date.now() - 4 * 60 * 60 * 1000) / 1000),
            media: null,
          },
        ];
      },
    };

    config.telegram.backfillHours = 3;
    config.telegram.backfillLimit = 100;

    const metrics = await backfillChannelMessages(mockClient, "expired_channel");

    assert(metrics.messagesFetched === 1, "Scenario 2: Fetched 1 message");
    assert(metrics.messagesStored === 0, "Scenario 2: Stored 0 messages (older than 3-hour window)");
    assert(metrics.safetyLimitReached === false, "Scenario 2: Safety limit not reached");
  } catch (err) {
    console.error("Scenario 2 failed:", err);
    failedTests++;
  }

  // SCENARIO 3: Deduplication (Previously processed signal)
  try {
    const mockClient = {
      getEntity: async (channelRef) => ({
        id: "1003",
        username: "dedupe_channel",
        title: "Dedupe Channel",
      }),
      getMessages: async (entity, options) => {
        return [
          {
            id: 401,
            message: "BUY EURUSD ENTRY 1.0800 TP 1.0850 SL 1.0750",
            date: Math.floor((Date.now() - 1 * 60 * 60 * 1000) / 1000),
            media: null,
          },
        ];
      },
    };

    config.telegram.backfillHours = 3;
    config.telegram.backfillLimit = 100;

    // First run (stores the message)
    const metrics1 = await backfillChannelMessages(mockClient, "dedupe_channel");
    assert(metrics1.messagesStored === 1, "Scenario 3: Stored 1 message on first run");

    // Second run (should identify as duplicate)
    const metrics2 = await backfillChannelMessages(mockClient, "dedupe_channel");
    assert(metrics2.messagesStored === 0, "Scenario 3: Stored 0 messages on second run");
    assert(metrics2.duplicateMessages === 1, "Scenario 3: Counted 1 duplicate message");
  } catch (err) {
    console.error("Scenario 3 failed:", err);
    failedTests++;
  }

  // SCENARIO 4: High-volume channel (Safety limit reached)
  try {
    const mockClient = {
      getEntity: async (channelRef) => ({
        id: "1004",
        username: "high_volume_channel",
        title: "High Volume Channel",
      }),
      getMessages: async (entity, options) => {
        // Return 10 messages within the 3-hour window
        const batch = [];
        const baseId = options.offsetId || 500;
        for (let i = 0; i < options.limit; i++) {
          batch.push({
            id: baseId + i + 1,
            message: `Mock Message #${baseId + i + 1}`,
            date: Math.floor((Date.now() - 10 * 60 * 1000) / 1000), // 10 minutes ago
            media: null,
          });
        }
        return batch;
      },
    };

    config.telegram.backfillHours = 3;
    config.telegram.backfillLimit = 15; // Set low safety limit for testing

    const metrics = await backfillChannelMessages(mockClient, "high_volume_channel");

    // Since safety limit is 15, and it fetches in batches of Math.min(100, backfillLimit - fetchedCount):
    // First query limit will be 15. The getMessages will return 15 messages.
    // Fetched count reaches 15. The loop will terminate and flag safety limit.
    assert(metrics.messagesFetched === 15, "Scenario 4: Fetched exactly safety limit (15) messages");
    assert(metrics.messagesStored === 15, "Scenario 4: Stored all 15 messages");
    assert(metrics.safetyLimitReached === true, "Scenario 4: Flagged safety limit reached");
  } catch (err) {
    console.error("Scenario 4 failed:", err);
    failedTests++;
  }

  console.log("\n=== TEST RUN SUMMARY ===");
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests > 0) {
    process.exitCode = 1;
  }
}

runTests().catch(console.error);
