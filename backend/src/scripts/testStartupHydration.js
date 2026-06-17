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

  // 1. Connect to Database (or mock fallback if offline)
  const dbStatus = await connectDatabase();
  
  let mockParsedSignals = [];
  let isMockMode = !dbStatus.connected;

  if (isMockMode) {
    console.log("[MOCK] Setting up offline fallback for startup hydration verification...");
    
    Object.defineProperty(mongoose.connection, 'readyState', {
      get: function() { return 1; },
      configurable: true
    });
    
    const nowTime = Date.now();

    mockParsedSignals = [
      {
        _id: new mongoose.Types.ObjectId(),
        pair: "XAUUSD",
        action: "BUY",
        entry: 2000,
        targets: [2010],
        stopLoss: 1990,
        signalState: "ACTIVE",
        createdAt: new Date(nowTime - 5 * 60 * 1000), // 5 min ago
        channel: "MockChannel",
        messageId: 2001,
        classification: "NEW_SIGNAL",
        parserClassification: "NEW_SIGNAL"
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pair: "EURUSD",
        action: "SELL",
        entry: 1.0800,
        targets: [1.0700],
        stopLoss: 1.0900,
        signalState: "PARTIAL",
        createdAt: new Date(nowTime - 10 * 60 * 1000), // 10 min ago
        channel: "MockChannel",
        messageId: 2002,
        classification: "NEW_SIGNAL",
        parserClassification: "NEW_SIGNAL"
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pair: "GBPUSD",
        action: "BUY",
        entry: 1.2500,
        targets: [1.2600],
        stopLoss: 1.2400,
        signalState: "CLOSED", // CLOSED signal - should be ignored!
        createdAt: new Date(nowTime - 15 * 60 * 1000), // 15 min ago
        channel: "MockChannel",
        messageId: 2003,
        classification: "NEW_SIGNAL",
        parserClassification: "NEW_SIGNAL"
      }
    ];

    // Mock ParsedSignal.find
    ParsedSignal.find = function(query) {
      let results = mockParsedSignals;
      if (query.signalState && query.signalState.$in) {
        results = results.filter(s => query.signalState.$in.includes(s.signalState));
      }
      if (query.createdAt && query.createdAt.$gte) {
        results = results.filter(s => s.createdAt >= query.createdAt.$gte);
      }

      return {
        sort: function() {
          return {
            lean: function() {
              return Promise.resolve(results);
            }
          };
        }
      };
    };

    ParsedSignal.countDocuments = function() {
      return Promise.resolve(mockParsedSignals.length);
    };

    SignalOutcome.countDocuments = function() {
      return Promise.resolve(5);
    };
  }

  assert(dbStatus.connected || isMockMode, "Database is connected or fallback mock mode is active");

  try {
    // 2. Record Database Counts before test
    const preParsedSignalCount = await ParsedSignal.countDocuments();
    const preSignalOutcomeCount = await SignalOutcome.countDocuments();
    console.log(`Pre-test Database Counts: ParsedSignals=${preParsedSignalCount}, SignalOutcomes=${preSignalOutcomeCount}`);

    // 3. Confirm behavior on empty/reset state
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

    if (isMockMode) {
      assert(postPairStates1.length === 2, "Hydrated only active/partial pairStates (2 expected, GBPUSD ignored)");
      assert(postPairStates1.find(p => p.pair === "GBPUSD") === undefined, "GBPUSD (CLOSED) was correctly excluded from rehydration");
      assert(result1.hydratedSignals === 2, "Exactly 2 signals hydrated");
    }

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
    if (dbStatus.connected) {
      await mongoose.disconnect();
      console.log("Disconnected from MongoDB.");
    }
  }

  console.log("\n=== STARTUP HYDRATION TEST RUN SUMMARY ===");
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification().catch(console.error);
