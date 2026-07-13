import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config/env.js";
import { getConfig, updateConfig, registerListener } from "../config/systemConfigManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/system-config-fixtures.json");
const testFixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running System Configuration Subsystem Verification Suite...\n");

// 1. Assert baseline config matches default values
{
  console.log("[Test 1] Asserting baseline configuration values...");
  const active = getConfig();
  
  if (
    active.port === 5000 &&
    active.signalExpirationMinutes === 60 &&
    active.autoTrade &&
    active.autoTrade.lotSize === 0.01 &&
    active.autoTrade.minConfidence === 75
  ) {
    console.log("  PASS: Baseline configurations mapped successfully");
  } else {
    console.error("  FAIL: Baseline config values mismatch:", active);
    passed = false;
  }
}

// 2. Assert Valid Update merges correctly
{
  console.log("\n[Test 2] Asserting valid config update merges correctly...");
  const originalConfig = getConfig();
  
  const updated = updateConfig(testFixtures.validUpdate);
  
  if (
    updated.signalExpirationMinutes === 90 &&
    updated.autoTrade.lotSize === 0.05 &&
    updated.autoTrade.minConfidence === 80 &&
    updated.port === 5000 // Unchanged
  ) {
    console.log("  PASS: Config updates merged successfully");
  } else {
    console.error("  FAIL: Merged update mismatch:", updated);
    passed = false;
  }

  // Restore original configuration
  updateConfig({
    signalExpirationMinutes: originalConfig.signalExpirationMinutes,
    autoTrade: {
      lotSize: originalConfig.autoTrade.lotSize,
      minConfidence: originalConfig.autoTrade.minConfidence
    }
  });
}

// 3. Assert Range and Schema Validations
{
  console.log("\n[Test 3] Asserting schema boundaries and range validations...");
  
  // Test invalid lot size (> 100.0)
  try {
    updateConfig(testFixtures.invalidLotSize);
    console.error("  FAIL: Allowed invalid lot size update!");
    passed = false;
  } catch (err) {
    if (err.code === "VALIDATION_FAILED" && err.errors.some(e => e.includes("Lot size must be a number between"))) {
      console.log("  PASS: Correctly rejected invalid lot size > 100.0");
    } else {
      console.error("  FAIL: Unexpected error on lot size validation:", err);
      passed = false;
    }
  }

  // Test invalid confidence (< 0)
  try {
    updateConfig(testFixtures.invalidConfidence);
    console.error("  FAIL: Allowed invalid confidence update!");
    passed = false;
  } catch (err) {
    if (err.code === "VALIDATION_FAILED" && err.errors.some(e => e.includes("Confidence must be a number between"))) {
      console.log("  PASS: Correctly rejected negative confidence");
    } else {
      console.error("  FAIL: Unexpected error on confidence validation:", err);
      passed = false;
    }
  }

  // Test invalid type (string signalExpirationMinutes)
  try {
    updateConfig(testFixtures.invalidType);
    console.error("  FAIL: Allowed invalid string type update!");
    passed = false;
  } catch (err) {
    if (err.code === "VALIDATION_FAILED" && err.errors.some(e => e.includes("Expiration must be a positive integer"))) {
      console.log("  PASS: Correctly rejected string input type for signalExpirationMinutes");
    } else {
      console.error("  FAIL: Unexpected error on type validation:", err);
      passed = false;
    }
  }
}

// 4. Assert Listener notification callbacks
{
  console.log("\n[Test 4] Asserting change listener notification...");
  let listenerCalled = false;
  let receivedConfig = null;

  registerListener((newConfig) => {
    listenerCalled = true;
    receivedConfig = newConfig;
  });

  updateConfig({ signalExpirationMinutes: 120 });

  if (listenerCalled && receivedConfig && receivedConfig.signalExpirationMinutes === 120) {
    console.log("  PASS: Config change listener executed and received updated config");
  } else {
    console.error("  FAIL: Config change listener was not invoked properly");
    passed = false;
  }

  // Restore
  updateConfig({ signalExpirationMinutes: 60 });
}

// 5. Assert dynamic Proxy reads on config export
{
  console.log("\n[Test 5] Asserting Dynamic JS Proxy resolution...");
  
  // Verify reading default value
  if (config.signalExpirationMinutes === 60) {
    console.log("  PASS: Proxy read default value correctly");
  } else {
    console.error("  FAIL: Proxy read default mismatch:", config.signalExpirationMinutes);
    passed = false;
  }

  // Perform updates and verify proxy updates immediately
  updateConfig({ signalExpirationMinutes: 75 });
  
  if (config.signalExpirationMinutes === 75) {
    console.log("  PASS: Proxy dynamically returned updated configuration at runtime!");
  } else {
    console.error("  FAIL: Proxy read updated value mismatch:", config.signalExpirationMinutes);
    passed = false;
  }

  // Assert proxy is read-only
  try {
    config.signalExpirationMinutes = 80;
    console.error("  FAIL: Modification on proxy succeeded!");
    passed = false;
  } catch (err) {
    console.log("  PASS: Proxy successfully blocked direct write access");
  }

  // Restore
  updateConfig({ signalExpirationMinutes: 60 });
}

// 6. Assert Config Snapshot Immutability (deep freeze)
{
  console.log("\n[Test 6] Asserting diagnostics snapshot immutability...");
  const active = getConfig();

  if (Object.isFrozen(active) && Object.isFrozen(active.autoTrade)) {
    console.log("  PASS: Configuration snapshot is deeply frozen");
    try {
      active.port = 9000;
      console.error("  FAIL: Mutation on configuration snapshot succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Mutation on snapshot correctly threw exception");
    }

    try {
      active.autoTrade.lotSize = 9.99;
      console.error("  FAIL: Mutation on nested snapshot property succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Mutation on nested properties correctly threw exception");
    }
  } else {
    console.error("  FAIL: Configuration snapshot is NOT frozen");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL SYSTEM CONFIGURATION TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME SYSTEM CONFIGURATION TESTS FAILED!\n");
  process.exit(1);
}
