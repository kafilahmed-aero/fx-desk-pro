import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateExecutionRequest } from "../services/tradeExecutionEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/execution-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Trade Execution Verification Suite...\n");

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`Executing Test Case #${i + 1}: "${tc.description}"`);
  
  const result = generateExecutionRequest(
    tc.validationResult,
    tc.decision,
    tc.riskAssessment,
    tc.positionSizing
  );
  
  if (result.status === tc.expectedStatus) {
    console.log(`  PASS: Execution Status resolved correctly to "${result.status}"`);
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

  if (tc.expectedStatus === "APPROVED") {
    if (result.symbol === tc.expectedSymbol) {
      console.log(`  PASS: Symbol resolved correctly to "${result.symbol}"`);
    } else {
      console.error(`  FAIL: Expected Symbol "${tc.expectedSymbol}", received "${result.symbol}"`);
      passed = false;
    }

    if (result.action === tc.expectedAction) {
      console.log(`  PASS: Action resolved correctly to "${result.action}"`);
    } else {
      console.error(`  FAIL: Expected Action "${tc.expectedAction}", received "${result.action}"`);
      passed = false;
    }

    if (result.volume === tc.expectedVolume) {
      console.log(`  PASS: Volume (lotSize) resolved correctly to "${result.volume}"`);
    } else {
      console.error(`  FAIL: Expected Volume "${tc.expectedVolume}", received "${result.volume}"`);
      passed = false;
    }

    if (Math.abs(result.entry - tc.expectedEntry) < 1e-7) {
      console.log(`  PASS: Entry price resolved correctly to "${result.entry}"`);
    } else {
      console.error(`  FAIL: Expected Entry "${tc.expectedEntry}", received "${result.entry}"`);
      passed = false;
    }
  }
}

// Verify recursive freeze (deep freeze)
{
  console.log("\nVerifying execution request snapshot recursive immutability...");
  const tc = testCases[0]; // Clean approved BUY
  const result = generateExecutionRequest(
    tc.validationResult,
    tc.decision,
    tc.riskAssessment,
    tc.positionSizing
  );

  if (Object.isFrozen(result)) {
    console.log("  PASS: Execution request root is frozen");
    try {
      result.status = "APPROVED_BY_HACKER";
      console.error("  FAIL: Mutation on root succeeded without throwing!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Mutation on root correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Execution request root is NOT frozen");
    passed = false;
  }

  if (result.metadata && Object.isFrozen(result.metadata)) {
    console.log("  PASS: Execution request metadata is frozen");
    try {
      result.metadata.confidence = 999;
      console.error("  FAIL: Mutation on metadata succeeded without throwing!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Mutation on metadata correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Execution request metadata is NOT frozen");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL TRADE EXECUTION TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME TRADE EXECUTION TESTS FAILED!\n");
  process.exit(1);
}
