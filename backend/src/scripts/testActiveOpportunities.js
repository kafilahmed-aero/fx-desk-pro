import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  savePairState,
  resetPairStateStore
} from "../services/pairStateStore.js";
import { getActiveOpportunities } from "../services/activeOpportunityService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/active-opportunities-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`\nReplaying Test Case #${i + 1}: "${tc.description}"`);
  
  resetPairStateStore();
  
  // Populate pairState map
  for (const pairState of tc.pairStates) {
    if (pairState.activeSignals) {
      for (const signal of pairState.activeSignals) {
        signal.timestamp = new Date();
      }
    }
    savePairState(pairState);
  }
  
  const opportunities = getActiveOpportunities();
  
  if (opportunities.length !== tc.expectedOpportunities.length) {
    console.error(`FAIL: expected ${tc.expectedOpportunities.length} opportunities, received ${opportunities.length}`);
    passed = false;
    continue;
  }
  
  for (let j = 0; j < opportunities.length; j++) {
    const actual = opportunities[j];
    const expected = tc.expectedOpportunities[j];
    
    // Check specific keys
    for (const [key, val] of Object.entries(expected)) {
      const actualVal = actual[key];
      if (actualVal === val) {
        console.log(`  PASS: Opportunity #${j + 1} ${key} = ${JSON.stringify(val)}`);
      } else {
        console.error(`  FAIL: Opportunity #${j + 1} ${key} expected ${JSON.stringify(val)}, received ${JSON.stringify(actualVal)}`);
        passed = false;
      }
    }
  }
}

if (passed) {
  console.log("\nALL ACTIVE OPPORTUNITIES TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME ACTIVE OPPORTUNITIES TESTS FAILED!\n");
  process.exit(1);
}
