import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initializeOutcome,
  updateOutcomeStatus,
  processSignalUpdate
} from "../services/signalOutcomeEngine.js";
import { getOutcomeByMessageKey } from "../services/signalOutcomeStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/signal-lifecycle-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`\nReplaying Test Case #${i + 1}: "${tc.description}"`);
  
  // 1. Initialize the initial signal outcome
  const signal = tc.initialSignal;
  const initialOutcome = await initializeOutcome(signal);
  if (!initialOutcome) {
    console.error(`FAIL: Failed to initialize outcome for signal ID ${signal._id}`);
    passed = false;
    continue;
  }
  
  const messageKey = `${signal.channel}:${signal.messageId}`;
  
  // 2. Process updates
  for (const update of tc.updates) {
    if (update.classification === "CANCEL_SIGNAL" || update.classification === "UPDATE_SIGNAL" || update.classification === "RESULT_SIGNAL") {
      // Simulate raw parser cancel/update processing via processSignalUpdate
      await processSignalUpdate(update);
    } else {
      // Direct lifecycle event update
      await updateOutcomeStatus(messageKey, update.status, update.reason);
    }
  }
  
  // 3. Assert final status
  const finalOutcome = await getOutcomeByMessageKey(messageKey);
  if (!finalOutcome) {
    console.error(`FAIL: Outcome not found after updates for key ${messageKey}`);
    passed = false;
    continue;
  }
  
  if (finalOutcome.status === tc.expectedStatus) {
    console.log(`  PASS: Final status matches expected "${tc.expectedStatus}"`);
  } else {
    console.error(`  FAIL: Final status is "${finalOutcome.status}", expected "${tc.expectedStatus}"`);
    passed = false;
  }
}

if (passed) {
  console.log("\nALL SIGNAL LIFECYCLE TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME SIGNAL LIFECYCLE TESTS FAILED!\n");
  process.exit(1);
}
