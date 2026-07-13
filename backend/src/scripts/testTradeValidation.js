import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { validateTrade } from "../services/tradeValidationEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/validation-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Trade Validation Verification Suite...\n");

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`Executing Test Case #${i + 1}: "${tc.description}"`);
  
  const result = validateTrade(
    tc.decision,
    tc.riskAssessment,
    tc.positionSizing
  );
  
  if (result.status === tc.expectedStatus) {
    console.log(`  PASS: Trade Status resolved correctly to "${result.status}"`);
  } else {
    console.error(`  FAIL: Expected Status "${tc.expectedStatus}", received "${result.status}"`);
    passed = false;
  }
  
  if (result.rejectionReason === tc.expectedReason) {
    console.log(`  PASS: Rejection reason resolved correctly to "${result.rejectionReason}"`);
  } else {
    console.error(`  FAIL: Expected Reason "${tc.expectedReason}", received "${result.rejectionReason}"`);
    passed = false;
  }
}

// 5. Verify rejectHighRisk option flags
{
  console.log("\nVerifying rejectHighRisk options rule configuration...");
  const decision = { pair: "EURUSD", decision: "BUY" };
  const risk = { isValidStructure: true, riskGrade: "HIGH_RISK" };
  const sizing = { lotSize: 0.10 };
  
  // A. High risk accepted by default
  let result = validateTrade(decision, risk, sizing, { rejectHighRisk: false });
  if (result.status === "APPROVED") {
    console.log("  PASS: HIGH_RISK accepted when rejectHighRisk is false");
  } else {
    console.error("  FAIL: HIGH_RISK rejected by default. Result:", result);
    passed = false;
  }
  
  // B. High risk rejected when flag active
  result = validateTrade(decision, risk, sizing, { rejectHighRisk: true });
  if (result.status === "REJECTED" && result.rejectionReason === "UNACCEPTABLE_RISK") {
    console.log("  PASS: HIGH_RISK correctly rejected when rejectHighRisk is true");
  } else {
    console.error("  FAIL: rejectHighRisk flag not respected. Result:", result);
    passed = false;
  }
}

// 6. Verify snapshot immutability
{
  console.log("\nVerifying trade validation snapshot recursive immutability...");
  const result = validateTrade(
    testCases[0].decision,
    testCases[0].riskAssessment,
    testCases[0].positionSizing
  );
  
  if (Object.isFrozen(result)) {
    console.log("  PASS: Validation snapshot is strictly frozen");
    try {
      result.status = "APPROVED_BY_HACKER";
      console.error("  FAIL: Mutation succeeded without throwing!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted mutation correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Validation snapshot was not frozen");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL TRADE VALIDATION TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME TRADE VALIDATION TESTS FAILED!\n");
  process.exit(1);
}
