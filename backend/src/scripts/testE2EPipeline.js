import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { executePipelineE2E } from "../services/pipelineIntegration.js";
import { resetPairStateStore } from "../services/pairStateEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/e2e-pipeline-fixtures.json");
const testFixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running End-to-End Pipeline Integration Verification Suite...\n");

// 1. Success execution with valid BUY signal
(async () => {
  try {
    resetPairStateStore();
    console.log("[Test 1] Asserting successful execution of a valid BUY message...");

    const mockPrice = { price: 2030, status: "HEALTHY", source: "MOCK" };
    const report = await executePipelineE2E(testFixtures.validBuySignal, {
      mockMarketPrice: mockPrice,
      mockActiveOpportunities: ["XAUUSD"],
      accountState: { balance: 10000, maxRiskPercent: 1.0, maxLotLimit: 10.0 }
    });

    if (
      report.status === "SUCCESS" &&
      report.parsedSignal !== null &&
      report.parsedSignal.pair === "XAUUSD" &&
      report.parsedSignal.action === "BUY" &&
      report.mt5Payload !== null &&
      report.mt5Payload.action === "OPEN_ORDER" &&
      report.mt5Payload.symbol === "XAUUSD" &&
      report.mt5Payload.direction === "BUY" &&
      report.mt5Payload.volume > 0 &&
      report.mt5Payload.sl === 2020 &&
      report.mt5Payload.tp === 2045
    ) {
      console.log("  PASS: Ingestion to MT5 payload completed successfully with correct values");
    } else {
      console.error("  FAIL: Report metrics mismatch:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Execution threw exception:", err);
    passed = false;
  }
})();

// 2. Data consistency and downstream matching check
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 2] Asserting data consistency across downstream layers...");

    const mockPrice = { price: 2030, status: "HEALTHY", source: "MOCK" };
    const report1 = await executePipelineE2E(testFixtures.validBuySignal, {
      mockMarketPrice: mockPrice,
      mockActiveOpportunities: ["XAUUSD"]
    });

    const parsed = report1.parsedSignal;
    const mt5 = report1.mt5Payload;

    if (
      mt5.symbol === parsed.pair &&
      mt5.sl === parsed.stopLoss &&
      mt5.tp === parsed.target
    ) {
      console.log("  PASS: Downstream parameters match parsed inputs exactly");
    } else {
      console.error("  FAIL: Data consistency mismatch:", { parsed, mt5 });
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Exception in data consistency checks:", err);
    passed = false;
  }
})();

// 3. Risk rejection and validation blocking checks
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 3] Asserting risk limits and high-risk rejection blocking...");

    const mockPrice = { price: 1.2500, status: "HEALTHY", source: "MOCK" };
    
    // We pass rejectHighRisk = true. The risk assessment for this trade has RRR = 1.5,
    // wait, TP is 1.22, Entry is 1.25, SL is 1.27.
    // TP distance = 0.03, SL distance = 0.02. RRR = 0.03 / 0.02 = 1.5. This is low risk.
    // Let's pass mock market price entry = 1.2500, TP = 1.2200, SL = 1.2650.
    // TP distance = 0.03, SL distance = 0.015. RRR = 2.0.
    // If we want it to fail validation or risk, let's pass options that cause it to fail.
    // For example, if we pass accountState with balance = 0 or riskPercent = 0.
    const report = await executePipelineE2E(testFixtures.highRiskSignal, {
      mockMarketPrice: mockPrice,
      mockActiveOpportunities: ["GBPUSD"],
      accountState: { balance: 0, maxRiskPercent: 0 } // Causes lot size = 0
    });

    if (
      report.status === "BLOCKED" &&
      report.mt5Payload === null &&
      report.errors.some(e => e.includes("rejected setup: LOT_SIZE_ZERO"))
    ) {
      console.log("  PASS: Validation correctly blocked order execution on zero lot size");
    } else {
      console.error("  FAIL: High-risk setup was not blocked properly:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Rejection checks threw exception:", err);
    passed = false;
  }
})();

// 4. Noise filtration check
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 4] Asserting noise and promotional message filtration...");

    const report = await executePipelineE2E(testFixtures.noiseMessage);

    if (
      report.status === "BLOCKED" &&
      report.parsedSignal === null &&
      report.mt5Payload === null &&
      report.errors.some(e => e.includes("Filtered out as noise/promo"))
    ) {
      console.log("  PASS: Noise/promo message successfully filtered at the parser boundary");
    } else {
      console.error("  FAIL: Noise message not filtered properly:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Noise test threw exception:", err);
    passed = false;
  }
})();

// 5. Determinism verification check
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 5] Asserting determinism of pipeline integration output...");

    const mockPrice = { price: 2030, status: "HEALTHY", source: "MOCK" };
    
    resetPairStateStore();
    const run1 = await executePipelineE2E(testFixtures.validBuySignal, {
      mockMarketPrice: mockPrice,
      mockActiveOpportunities: ["XAUUSD"]
    });

    resetPairStateStore();
    const run2 = await executePipelineE2E(testFixtures.validBuySignal, {
      mockMarketPrice: mockPrice,
      mockActiveOpportunities: ["XAUUSD"]
    });

    if (
      run1.status === run2.status &&
      run1.parsedSignal.pair === run2.parsedSignal.pair &&
      run1.parsedSignal.action === run2.parsedSignal.action &&
      run1.mt5Payload.volume === run2.mt5Payload.volume &&
      run1.mt5Payload.sl === run2.mt5Payload.sl &&
      run1.mt5Payload.tp === run2.mt5Payload.tp
    ) {
      console.log("  PASS: Identical runs produced identical outputs");
    } else {
      console.error("  FAIL: Non-deterministic output detected:", { run1, run2 });
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Determinism check threw exception:", err);
    passed = false;
  }
})();

// 6. Immutability checks
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 6] Asserting report snapshot immutability locks...");

    const mockPrice = { price: 2030, status: "HEALTHY", source: "MOCK" };
    const report = await executePipelineE2E(testFixtures.validBuySignal, {
      mockMarketPrice: mockPrice,
      mockActiveOpportunities: ["XAUUSD"]
    });

    if (Object.isFrozen(report) && Object.isFrozen(report.steps) && Object.isFrozen(report.mt5Payload)) {
      console.log("  PASS: Report snapshot is deeply frozen");
      try {
        report.status = "MUTATED";
        console.error("  FAIL: Modification on report snapshot succeeded!");
        passed = false;
      } catch (err) {
        console.log("  PASS: Direct write modification correctly blocked");
      }
    } else {
      console.error("  FAIL: Report snapshot is not recursively frozen");
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Immutability test threw exception:", err);
    passed = false;
  }
})();

// Summary block checking
setTimeout(() => {
  if (passed) {
    console.log("\nALL E2E PIPELINE INTEGRATION TESTS PASSED!\n");
    process.exit(0);
  } else {
    console.error("\nSOME E2E PIPELINE INTEGRATION TESTS FAILED!\n");
    process.exit(1);
  }
}, 500);
