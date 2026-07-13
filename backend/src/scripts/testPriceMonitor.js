import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluatePriceCrossovers } from "../services/priceMonitoringScheduler.js";
import { setTestEventListener } from "../services/lifecycleEventDispatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/price-monitor-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;
let capturedEvent = null;

// Register test event listener to intercept dispatched events
setTestEventListener((event) => {
  capturedEvent = event;
});

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`\nReplaying Test Case #${i + 1}: "${tc.description}"`);
  
  // Clone outcome state for test case
  const outcome = JSON.parse(JSON.stringify(tc.outcome));
  
  for (const tick of tc.ticks) {
    capturedEvent = null;
    
    // Evaluate crossover
    await evaluatePriceCrossovers(outcome, tick.price, new Date());
    
    if (tick.expectedEvent) {
      if (capturedEvent && capturedEvent.eventType === tick.expectedEvent) {
        console.log(`  PASS: Price ${tick.price} triggered expected event "${tick.expectedEvent}"`);
        
        // Mutate local mock outcome state as engine would, to verify subsequent targets
        if (capturedEvent.eventType === "ENTRY_FILLED") {
          outcome.status = "ACTIVE";
        } else if (capturedEvent.eventType === "PARTIAL_TP") {
          outcome.status = "PARTIAL_TP";
          const target = outcome.targets.find(t => t.targetNumber === capturedEvent.targetNumber);
          if (target) target.isHit = true;
        } else if (capturedEvent.eventType === "SL_HIT") {
          outcome.status = "SL_HIT";
        } else if (capturedEvent.eventType === "FULL_TP") {
          outcome.status = "FULL_TP";
        }
      } else {
        console.error(`  FAIL: Price ${tick.price} expected event "${tick.expectedEvent}", received "${capturedEvent?.eventType || "none"}"`);
        passed = false;
      }
    } else {
      if (!capturedEvent) {
        console.log(`  PASS: Price ${tick.price} correctly triggered no event`);
      } else {
        console.error(`  FAIL: Price ${tick.price} expected no event, received "${capturedEvent.eventType}"`);
        passed = false;
      }
    }
  }
}

// Clean up listener
setTestEventListener(null);

if (passed) {
  console.log("\nALL PRICE MONITOR TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME PRICE MONITOR TESTS FAILED!\n");
  process.exit(1);
}
