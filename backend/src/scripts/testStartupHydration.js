import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { SignalOutcome } from "../models/signalOutcomeModel.js";
import { hydratePairStatesFromDb } from "../services/pairStateHydrationService.js";
import { getPairStates as getStoredPairStates } from "../services/pairStateStore.js";
import { getActiveOpportunities } from "../services/activeOpportunityService.js";
import { logger } from "../utils/logger.js";

// Set logging level to warn to keep clean test output
logger.level = "warn";

async function runVerification() {
  console.log("=== STARTING STARTUP HYDRATION VERIFICATION TEST ===");

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

  // 1. Connect to Database
  const dbStatus = await connectDatabase();
  assert(dbStatus.connected, "Connected to MongoDB");

  if (!dbStatus.connected) {
    console.error("Database connection failed. Exiting tests.");
    process.exit(1);
  }

  try {
    // 2. Record Database Counts before test
    const preParsedSignalCount = await ParsedSignal.countDocuments();
    const preSignalOutcomeCount = await SignalOutcome.countDocuments();
    console.log(`Pre-test Database Counts: ParsedSignals=${preParsedSignalCount}, SignalOutcomes=${preSignalOutcomeCount}`);

    // 3. Confirm behavior on empty/reset state
    // Reset in-memory store
    console.log("Resetting in-memory pairStateStore...");
    const preStoredPairStates = getStoredPairStates();
    const preActiveOpportunities = getActiveOpportunities();
    console.log(`Initial in-memory counts: pairStates=${preStoredPairStates.length}, activeOpportunities=${preActiveOpportunities.length}`);

    // 4. Run Hydration for the first time
    console.log("Running hydratePairStatesFromDb() [First Run]...");
    const result1 = await hydratePairStatesFromDb();
    assert(result1.success === true, "Hydration execution successful");
    console.log(`Hydrated signals: ${result1.hydratedSignals}`);

    const postPairStates1 = getStoredPairStates();
    const postOpportunities1 = getActiveOpportunities();
    console.log(`Post-hydration counts: pairStates=${postPairStates1.length}, activeOpportunities=${postOpportunities1.length}`);

    assert(postPairStates1.length > 0, "pairStates Map populated after hydration");
    assert(postOpportunities1.length > 0, "Active Opportunities populated after hydration");

    // 5. Run Hydration for the second time (Verification of Idempotency)
    console.log("Running hydratePairStatesFromDb() [Second Run / Idempotency Check]...");
    const result2 = await hydratePairStatesFromDb();
    assert(result2.success === true, "Hydration execution successful on second run");

    const postPairStates2 = getStoredPairStates();
    const postOpportunities2 = getActiveOpportunities();
    assert(postPairStates2.length === postPairStates1.length, "Idempotency: pairStates count matches first run exactly");
    assert(postOpportunities2.length === postOpportunities1.length, "Idempotency: activeOpportunities count matches first run exactly");

    // 6. Verify Database counts remained exactly unchanged
    const postParsedSignalCount = await ParsedSignal.countDocuments();
    const postSignalOutcomeCount = await SignalOutcome.countDocuments();
    console.log(`Post-test Database Counts: ParsedSignals=${postParsedSignalCount}, SignalOutcomes=${postSignalOutcomeCount}`);

    assert(postParsedSignalCount === preParsedSignalCount, "No new ParsedSignals created (Database is read-only during hydration)");
    assert(postSignalOutcomeCount === preSignalOutcomeCount, "No new SignalOutcomes created (Database is read-only during hydration)");

  } catch (error) {
    console.error("Hydration test execution encountered an error:", error);
    failedTests++;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }

  console.log("\n=== STARTUP HYDRATION TEST RUN SUMMARY ===");
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runVerification().catch(console.error);
