import fs from "fs";
import path from "url";
import { fileURLToPath } from "url";
import { validateAccountType, executeDemoValidation } from "../services/demoTradingValidation.js";
import { resetPairStateStore } from "../services/pairStateEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.fileURLToPath(new URL(".", import.meta.url));
const fixturesPath = path.fileURLToPath(new URL("../../test-messages/demo-validation-fixtures.json", import.meta.url));
const testFixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
const e2eFixturesPath = path.fileURLToPath(new URL("../../test-messages/e2e-pipeline-fixtures.json", import.meta.url));
const e2eFixtures = JSON.parse(fs.readFileSync(e2eFixturesPath, "utf8"));

let passed = true;

console.log("Running Demo Trading Validation Subsystem Verification Suite...\n");

// 1. Assert account check validations (Demo vs Live)
{
  console.log("[Test 1] Asserting account parameter validation filters...");

  // Demo validation check
  const check1 = validateAccountType(testFixtures.validDemoAccount);
  if (check1.isDemo === true && check1.reason === null) {
    console.log("  PASS: Approved valid demo connection successfully");
  } else {
    console.error("  FAIL: Rejected valid demo account:", check1);
    passed = false;
  }

  // Live broker rejection check
  const check2 = validateAccountType(testFixtures.liveBrokerAccount);
  if (check2.isDemo === false && check2.reason === "LIVE_ACCOUNT_DETECTED") {
    console.log("  PASS: Successfully blocked live broker name registration");
  } else {
    console.error("  FAIL: Allowed live broker registration:", check2);
    passed = false;
  }

  // Live server rejection check
  const check3 = validateAccountType(testFixtures.liveServerAccount);
  if (check3.isDemo === false && check3.reason === "LIVE_ACCOUNT_DETECTED") {
    console.log("  PASS: Successfully blocked live server name registration");
  } else {
    console.error("  FAIL: Allowed live server registration:", check3);
    passed = false;
  }

  // Live tradeMode rejection check
  const check4 = validateAccountType(testFixtures.liveTradeModeAccount);
  if (check4.isDemo === false && check4.reason === "LIVE_ACCOUNT_DETECTED") {
    console.log("  PASS: Successfully blocked explicit Real/Live trade mode");
  } else {
    console.error("  FAIL: Allowed explicit Real/Live trade mode:", check4);
    passed = false;
  }
}

// 2. Assert Demo pipeline execution orchestration
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 2] Asserting E2E pipeline execution under verified demo settings...");

    const mockPrice = { price: 2030, status: "HEALTHY", source: "MOCK" };
    const report = await executeDemoValidation(
      e2eFixtures.validBuySignal,
      testFixtures.validDemoAccount,
      {
        mockMarketPrice: mockPrice,
        mockActiveOpportunities: ["XAUUSD"],
        accountState: { balance: 10000, maxRiskPercent: 1.0, maxLotLimit: 10.0 }
      }
    );

    if (
      report.status === "SUCCESS" &&
      report.accountType === "DEMO" &&
      report.pipelineReport !== null &&
      report.pipelineReport.status === "SUCCESS" &&
      report.pipelineReport.mt5Payload !== null &&
      report.pipelineReport.mt5Payload.sl === 2020
    ) {
      console.log("  PASS: Executed pipeline and built correct MT5 payload under demo");
    } else {
      console.error("  FAIL: Execution report mismatch:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Demo execution threw exception:", err);
    passed = false;
  }
})();

// 3. Assert live account block overrides downstream processing
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 3] Asserting live account blocks occur BEFORE downstream execution...");

    const report = await executeDemoValidation(
      e2eFixtures.validBuySignal,
      testFixtures.liveBrokerAccount
    );

    if (
      report.status === "BLOCKED" &&
      report.accountType === "LIVE_BLOCKED" &&
      report.pipelineReport === null // Bypassed downstream processing entirely!
    ) {
      console.log("  PASS: Blocked live execution early; bypassed downstream stages");
    } else {
      console.error("  FAIL: Did not block live execution early:", report);
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Live override test threw exception:", err);
    passed = false;
  }
})();

// 4. Assert report snapshot immutability
(async () => {
  try {
    resetPairStateStore();
    console.log("\n[Test 4] Asserting validation report snapshot immutability...");

    const report = await executeDemoValidation(
      e2eFixtures.validBuySignal,
      testFixtures.validDemoAccount,
      {
        mockActiveOpportunities: ["XAUUSD"]
      }
    );

    if (Object.isFrozen(report) && Object.isFrozen(report.validationNotes)) {
      console.log("  PASS: Validation report snapshot is deeply frozen");
      try {
        report.status = "MUTATED";
        console.error("  FAIL: Mutation on validation report snapshot succeeded!");
        passed = false;
      } catch (err) {
        console.log("  PASS: Direct write mutation blocked successfully");
      }
    } else {
      console.error("  FAIL: Report snapshot is not frozen");
      passed = false;
    }
  } catch (err) {
    console.error("  FAIL: Immutability check threw exception:", err);
    passed = false;
  }
})();

// Summary checks
setTimeout(() => {
  if (passed) {
    console.log("\nALL DEMO VALIDATION TESTS PASSED!\n");
    process.exit(0);
  } else {
    console.error("\nSOME DEMO VALIDATION TESTS FAILED!\n");
    process.exit(1);
  }
}, 500);
