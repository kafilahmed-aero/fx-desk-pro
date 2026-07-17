import fs from "fs";
import path from "url";
import { fileURLToPath } from "url";
import { config } from "../config/env.js";
import { updateConfig } from "../config/systemConfigManager.js";
import { executePipelineE2E } from "../services/pipelineIntegration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.fileURLToPath(new URL(".", import.meta.url));
const fixturesPath = path.fileURLToPath(new URL("../../test-messages/e2e-pipeline-fixtures.json", import.meta.url));
const e2eFixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

async function runTests() {
  console.log("=== Execution Mode Router Verification Suite ===\n");
  let passed = true;

  // Test 1: Validate DEFAULT/DECISION Mode
  try {
    console.log("[Test 1] Asserting Decision Mode (Default)...");
    updateConfig({ executionMode: "decision" });

    if (config.executionMode !== "decision") {
      throw new Error(`Execution mode config did not update to 'decision'. Got: ${config.executionMode}`);
    }

    const report = await executePipelineE2E(e2eFixtures.validBuySignal, {
      mockMarketPrice: { price: 2030, status: "HEALTHY", source: "MOCK" },
      mockActiveOpportunities: ["XAUUSD"]
    });

    // In Decision Mode, the pipeline evaluations occur (e.g. Risk, Sizing, MT5 Payload generation)
    if (
      report.status === "SUCCESS" &&
      report.mt5Payload !== null &&
      report.signalValidationReport === undefined &&
      report.steps.some(s => s.step === "DECISION_EVALUATION")
    ) {
      console.log("  PASS: Properly executed Decision Engine and generated MT5 payload.");
    } else {
      console.error("  FAIL: Decision Mode pipeline structure mismatch:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Decision Mode test:", err);
    passed = false;
  }

  // Test 2: Validate SIGNAL_VALIDATION Mode
  try {
    console.log("\n[Test 2] Asserting Signal Validation Mode...");
    updateConfig({ executionMode: "signal_validation" });

    if (config.executionMode !== "signal_validation") {
      throw new Error(`Execution mode config did not update to 'signal_validation'. Got: ${config.executionMode}`);
    }

    const report = await executePipelineE2E(e2eFixtures.validBuySignal, {
      mockMarketPrice: { price: 2030, status: "HEALTHY", source: "MOCK" },
      mockActiveOpportunities: ["XAUUSD"]
    });

    // In Signal Validation Mode, the decision engine & risk assessment must be bypassed.
    const hasDecisionStep = report.steps.some(s => s.step === "DECISION_EVALUATION");
    const hasRiskStep = report.steps.some(s => s.step === "RISK_ASSESSMENT");
    const hasRouterStep = report.steps.some(s => s.step === "SIGNAL_VALIDATION_ROUTER");

    if (
      report.status === "SUCCESS" &&
      report.mt5Payload === null &&
      report.signalValidationReport !== undefined &&
      report.signalValidationReport.status === "SUCCESS" &&
      report.signalValidationReport.message === "Signal Validation Mode Active - Pipeline Placeholder" &&
      hasRouterStep &&
      !hasDecisionStep &&
      !hasRiskStep
    ) {
      console.log("  PASS: Successfully bypassed Decision Engine and routed to Signal Validation Pipeline.");
    } else {
      console.error("  FAIL: Signal Validation Mode pipeline structure mismatch:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in Signal Validation Mode test:", err);
    passed = false;
  }

  // Clean up config to default decision mode
  updateConfig({ executionMode: "decision" });

  console.log("\n==========================================");
  if (passed) {
    console.log("ALL EXECUTION ROUTER TESTS PASSED!");
    process.exit(0);
  } else {
    console.error("EXECUTION ROUTER TESTS FAILED!");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
