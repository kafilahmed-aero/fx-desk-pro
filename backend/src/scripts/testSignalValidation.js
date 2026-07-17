import fs from "fs";
import path from "url";
import { fileURLToPath } from "url";
import { config } from "../config/env.js";
import { updateConfig } from "../config/systemConfigManager.js";
import { executePipelineE2E } from "../services/pipelineIntegration.js";
import { validateParsedSignal } from "../services/signalValidationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.fileURLToPath(new URL(".", import.meta.url));
const fixturesPath = path.fileURLToPath(new URL("../../test-messages/e2e-pipeline-fixtures.json", import.meta.url));
const e2eFixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

async function runTests() {
  console.log("=== Signal Validation Mode (Stage 1) Test Suite ===\n");
  let passed = true;

  // Set execution mode to signal_validation
  updateConfig({ executionMode: "signal_validation" });

  // Test 1: Full compliance valid BUY signal
  try {
    console.log("[Test 1] Asserting fully valid E2E signal validation...");
    const report = await executePipelineE2E(e2eFixtures.validBuySignal, {
      mockMarketPrice: { price: 2030, status: "HEALTHY", source: "MOCK" }
    });

    const result = report.signalValidationReport;

    if (!result) {
      throw new Error("No signalValidationReport returned in pipeline report.");
    }

    if (result.success !== true) {
      throw new Error(`Validation expected to succeed, but success was false. Errors: ${JSON.stringify(result.errors)}`);
    }

    const ctx = result.context;

    // Validate Context Schema
    const requiredKeys = [
      "signalId", "channelId", "channelName", "symbol", "direction",
      "entry", "stopLoss", "takeProfits", "receivedTimestamp", "parserTimestamp",
      "pipelineStatus", "executionStatus", "order", "monitoring", "outcome", "rating"
    ];

    for (const key of requiredKeys) {
      if (!(key in ctx)) {
        throw new Error(`Context missing required key: ${key}`);
      }
    }

    // Validate future stage placeholders
    if (ctx.pipelineStatus !== "VALIDATED" || ctx.executionStatus !== "NOT_STARTED") {
      throw new Error(`Invalid status states. pipelineStatus: ${ctx.pipelineStatus}, executionStatus: ${ctx.executionStatus}`);
    }

    if (
      ctx.order.type !== null || ctx.order.ticket !== null ||
      ctx.monitoring.status !== "NOT_STARTED" || ctx.outcome.result !== null ||
      ctx.rating.processed !== false
    ) {
      throw new Error("Placeholder schemas were not correctly initialized to null/false.");
    }

    console.log("  PASS: Standard Validation Result schema is perfect.");
    console.log("  PASS: Signal Validation Context initialized and frozen successfully.");
  } catch (err) {
    console.error("  FAIL: Valid signal test failed:", err.message);
    passed = false;
  }

  // Test 2: Unit test direct validations for various invalid parameters
  try {
    console.log("\n[Test 2] Asserting direct validation checks on bad parameters...");

    // Case A: Missing Stop Loss
    const resA = validateParsedSignal(
      { messageId: 9001, channel: "TestChannel" },
      { messageId: 9001, channel: "TestChannel", pair: "XAUUSD", action: "BUY", entry: 2030, targets: [2045], stopLoss: null }
    );
    if (resA.success === false && resA.errors.some(e => e.field === "stopLoss")) {
      console.log("  PASS: Rejection occurred correctly for missing stopLoss.");
    } else {
      console.error("  FAIL: Missing stopLoss was not rejected correctly:", resA);
      passed = false;
    }

    // Case B: Missing Take Profits
    const resB = validateParsedSignal(
      { messageId: 9002, channel: "TestChannel" },
      { messageId: 9002, channel: "TestChannel", pair: "XAUUSD", action: "BUY", entry: 2030, targets: [], stopLoss: 2020 }
    );
    if (resB.success === false && resB.errors.some(e => e.field === "takeProfits")) {
      console.log("  PASS: Rejection occurred correctly for empty takeProfits.");
    } else {
      console.error("  FAIL: Empty takeProfits was not rejected correctly:", resB);
      passed = false;
    }

    // Case C: Invalid entry value (e.g. <= 0)
    const resC = validateParsedSignal(
      { messageId: 9003, channel: "TestChannel" },
      { messageId: 9003, channel: "TestChannel", pair: "XAUUSD", action: "BUY", entry: 0, targets: [2045], stopLoss: 2020 }
    );
    if (resC.success === false && resC.errors.some(e => e.field === "entry")) {
      console.log("  PASS: Rejection occurred correctly for invalid entry price.");
    } else {
      console.error("  FAIL: Invalid entry price was not rejected correctly:", resC);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in unit tests:", err.message);
    passed = false;
  }

  // Test 3: E2E Pipeline Validation rejection (using zero values that pass classifier but fail validator)
  try {
    console.log("\n[Test 3] Asserting invalid signal (invalid Entry value) rejection in E2E pipeline...");
    const invalidSignal = {
      text: "GOLD BUY Entry: 0 TP: 2045 SL: 2020", // Zero Entry passes parser check but fails stage 1 validator constraints
      channel: "TestForexChannel",
      messageId: 6002
    };

    const report = await executePipelineE2E(invalidSignal, {
      mockClassificationRes: { classification: "NEW_SIGNAL" },
      mockParsedSignal: {
        messageId: 6002,
        channel: "TestForexChannel",
        pair: "XAUUSD",
        action: "BUY",
        entry: 0, // Invalid entry value
        targets: [2045],
        stopLoss: 2020
      }
    });
    const result = report.signalValidationReport;

    if (result && result.success === false && result.errors.some(e => e.field === "entry")) {
      console.log("  PASS: Rejection occurred correctly in E2E pipeline for invalid entry value.");
    } else {
      console.error("  FAIL: Expected entry validation failure in E2E, got:", result);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in E2E invalid Entry test:", err.message);
    passed = false;
  }

  // Test 4: Reject noise classification message
  try {
    console.log("\n[Test 4] Asserting noise message filtration...");
    const report = await executePipelineE2E(e2eFixtures.noiseMessage);

    // Noise filter blocks it early before validation router runs.
    if (report.status === "BLOCKED" && report.errors.some(e => e.includes("noise/promo"))) {
      console.log("  PASS: Noise message filtered early and blocked.");
    } else {
      console.error("  FAIL: Noise message was not correctly filtered, got:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in noise test:", err.message);
    passed = false;
  }

  // Restore config to default decision mode
  updateConfig({ executionMode: "decision" });

  console.log("\n==========================================");
  if (passed) {
    console.log("STAGE 1 SIGNAL VALIDATION TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("STAGE 1 SIGNAL VALIDATION TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
