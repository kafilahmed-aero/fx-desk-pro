import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateDecision } from "../services/decisionEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/decision-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Decision Engine Verification Suite...\n");

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`Executing Test Case #${i + 1}: "${tc.description}"`);
  
  const result = evaluateDecision(
    tc.pair,
    tc.pairState,
    tc.activeOpportunities,
    tc.marketPrice
  );
  
  if (result.decision === tc.expectedDecision) {
    console.log(`  PASS: Direction evaluated correctly as "${result.decision}"`);
  } else {
    console.error(`  FAIL: Expected direction "${tc.expectedDecision}", received "${result.decision}"`);
    passed = false;
  }
  
  if (result.confidence === tc.expectedConfidence) {
    console.log(`  PASS: Confidence score calculated correctly as ${result.confidence}%`);
  } else {
    console.error(`  FAIL: Expected confidence ${tc.expectedConfidence}%, received ${result.confidence}%`);
    passed = false;
  }
}

// 3. Verify Safe Defaulting on Unavailable Market Data
{
  console.log("\nVerifying safe fallback to HOLD on unavailable inputs...");
  const result = evaluateDecision("EURUSD", testCases[0].pairState, ["EURUSD"], { status: "UNAVAILABLE" });
  if (result.decision === "HOLD" && result.confidence === 0) {
    console.log("  PASS: UNAVAILABLE market price correctly defaults to HOLD with 0% confidence");
  } else {
    console.error("  FAIL: Did not default safely on UNAVAILABLE price. Result:", result);
    passed = false;
  }
}

// 4. Verify Recursive Immutability
{
  console.log("\nVerifying recursive immutability of decision snapshots...");
  const result = evaluateDecision(
    testCases[0].pair,
    testCases[0].pairState,
    testCases[0].activeOpportunities,
    testCases[0].marketPrice
  );
  
  if (Object.isFrozen(result) && Object.isFrozen(result.entryRange)) {
    console.log("  PASS: Decision object and nested properties are strictly frozen");
    try {
      result.entryRange.low = 9.99;
      console.error("  FAIL: Nested mutation did not throw!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted mutation correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Returned object was not recursively frozen");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL DECISION ENGINE TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME DECISION ENGINE TESTS FAILED!\n");
  process.exit(1);
}
