import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  updatePairStateFromSignal,
  getPairState,
  resetPairStateStore
} from "../services/pairStateEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/pair-state-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`\nReplaying Test Case #${i + 1}: "${tc.description}"`);
  
  resetPairStateStore();
  
  let lastPairState = null;
  for (const signal of tc.signals) {
    lastPairState = updatePairStateFromSignal(signal);
  }
  
  const pair = tc.signals[0].pair;
  const actualState = getPairState(pair);
  
  if (!actualState) {
    console.error(`FAIL: No pair state created for ${pair}`);
    passed = false;
    continue;
  }
  
  // Verify expected metrics
  const expected = tc.expectedMetrics;
  for (const [key, val] of Object.entries(expected)) {
    const actualVal = actualState[key];
    
    let isMatch = false;
    if (typeof val === "object" && val !== null) {
      isMatch = JSON.stringify(actualVal) === JSON.stringify(val);
    } else {
      isMatch = actualVal === val;
    }
    
    if (isMatch) {
      console.log(`  PASS: ${key} = ${JSON.stringify(val)}`);
    } else {
      console.error(`  FAIL: ${key} expected ${JSON.stringify(val)}, received ${JSON.stringify(actualVal)}`);
      passed = false;
    }
  }
}

if (passed) {
  console.log("\nALL PAIR STATE ENGINE TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME PAIR STATE ENGINE TESTS FAILED!\n");
  process.exit(1);
}
