import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateRisk } from "../services/riskEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/risk-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Risk Engine Verification Suite...\n");

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`Executing Test Case #${i + 1}: "${tc.description}"`);
  
  const result = evaluateRisk(tc.decision);
  
  if (result.riskGrade === tc.expectedGrade) {
    console.log(`  PASS: Risk Grade evaluated correctly as "${result.riskGrade}"`);
  } else {
    console.error(`  FAIL: Expected Risk Grade "${tc.expectedGrade}", received "${result.riskGrade}"`);
    passed = false;
  }
  
  if (Math.abs(result.rewardToRiskRatio - tc.expectedRatio) < 0.01) {
    console.log(`  PASS: Reward-to-Risk ratio calculated correctly as ${result.rewardToRiskRatio}`);
  } else {
    console.error(`  FAIL: Expected RRR ${tc.expectedRatio}, received ${result.rewardToRiskRatio}`);
    passed = false;
  }
}

// 5. Verify HOLD defaults to NONE
{
  console.log("\nVerifying default to NONE risk grade on HOLD...");
  const result = evaluateRisk({ decision: "HOLD" });
  if (result.riskGrade === "NONE" && result.rewardToRiskRatio === 0) {
    console.log("  PASS: HOLD decision correctly graded as NONE with RRR 0");
  } else {
    console.error("  FAIL: Expected NONE risk grade, received:", result);
    passed = false;
  }
}

// 6. Verify snapshot immutability
{
  console.log("\nVerifying risk assessment recursive immutability...");
  const result = evaluateRisk(testCases[0].decision);
  
  if (Object.isFrozen(result) && Object.isFrozen(result.validationNotes)) {
    console.log("  PASS: Risk assessment object and nested properties are strictly frozen");
    try {
      result.validationNotes.push("hack");
      console.error("  FAIL: Mutating frozen properties succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted mutation correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Returned risk assessment was not recursively frozen");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL RISK ENGINE TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME RISK ENGINE TESTS FAILED!\n");
  process.exit(1);
}
