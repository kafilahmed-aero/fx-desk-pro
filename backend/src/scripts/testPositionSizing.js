import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculatePositionSize } from "../services/positionSizingService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/position-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Position Sizing Verification Suite...\n");

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`Executing Test Case #${i + 1}: "${tc.description}"`);
  
  const result = calculatePositionSize(
    tc.decision,
    tc.riskAssessment,
    tc.accountState
  );
  
  if (Math.abs(result.lotSize - tc.expectedLots) < 0.01) {
    console.log(`  PASS: Lot size resolved correctly to ${result.lotSize}`);
  } else {
    console.error(`  FAIL: Expected lot size ${tc.expectedLots}, received ${result.lotSize}`);
    passed = false;
  }
}

// 4. Verify boundary clamps below minimum lot size
{
  console.log("\nVerifying boundary clamps below minimum lot size...");
  const tc = testCases[0];
  const tinyAccountState = {
    balance: 100, // Very small balance
    maxRiskPercent: 1.0,
    maxLotLimit: 10.00
  };
  
  const result = calculatePositionSize(tc.decision, tc.riskAssessment, tinyAccountState);
  if (result.lotSize === 0) {
    console.log("  PASS: Lot size below 0.01 correctly clamped to 0");
  } else {
    console.error("  FAIL: Tiny position size did not clamp to 0. Received:", result.lotSize);
    passed = false;
  }
}

// 5. Verify snapshot immutability
{
  console.log("\nVerifying position sizing recursive immutability...");
  const result = calculatePositionSize(
    testCases[0].decision,
    testCases[0].riskAssessment,
    testCases[0].accountState
  );
  
  if (Object.isFrozen(result)) {
    console.log("  PASS: Sizing snapshot is strictly frozen");
    try {
      result.lotSize = 9.99;
      console.error("  FAIL: Mutation succeeded without throwing!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted mutation correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Sizing snapshot was not frozen");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL POSITION SIZING TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME POSITION SIZING TESTS FAILED!\n");
  process.exit(1);
}
