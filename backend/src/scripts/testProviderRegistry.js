import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  resetRegistry,
  getBestProvider,
  reportSuccess,
  reportFailure,
  getDiagnostics
} from "../services/providerRegistryService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/provider-registry-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Provider Registry Verification Suite...\n");

// 1. Test Case 1: Standard Priorities & Cooldown Rules
{
  const tc = testCases[0];
  console.log(`Executing: "${tc.description}"`);
  
  resetRegistry(tc.config);
  
  // A. Initial state check (should be healthy)
  let best = getBestProvider(["binance", "yahoo"]);
  if (best && best.id === "binance") {
    console.log("  PASS: Priority 1 (binance) selected successfully on start");
  } else {
    console.error(`  FAIL: Expected binance, selected: ${best?.id || "none"}`);
    passed = false;
  }
  
  // B. Single failure -> DEGRADED state (still selected)
  reportFailure("binance");
  let diagnostics = getDiagnostics();
  let binanceDiag = diagnostics.find(d => d.providerId === "binance");
  if (binanceDiag && binanceDiag.state === "DEGRADED" && binanceDiag.consecutiveFailures === 1) {
    console.log("  PASS: Single failure transitioned binance state to DEGRADED");
  } else {
    console.error(`  FAIL: Expected DEGRADED state, received: ${binanceDiag?.state}`);
    passed = false;
  }
  
  best = getBestProvider(["binance", "yahoo"]);
  if (best && best.id === "binance") {
    console.log("  PASS: DEGRADED provider is still usable and selected");
  } else {
    console.error("  FAIL: DEGRADED provider skipped prematurely!");
    passed = false;
  }
  
  // C. Multiple failures -> COOLDOWN state
  reportFailure("binance");
  reportFailure("binance"); // Total 3 failures, maxLimit reached
  
  diagnostics = getDiagnostics();
  binanceDiag = diagnostics.find(d => d.providerId === "binance");
  if (binanceDiag && binanceDiag.state === "COOLDOWN") {
    console.log("  PASS: Exceeding failure threshold transitioned binance to COOLDOWN");
  } else {
    console.error(`  FAIL: Expected COOLDOWN state, received: ${binanceDiag?.state}`);
    passed = false;
  }
  
  // D. Failover selection (should select yahoo now)
  best = getBestProvider(["binance", "yahoo"]);
  if (best && best.id === "yahoo") {
    console.log("  PASS: Failed over to priority 2 (yahoo) correctly");
  } else {
    console.error(`  FAIL: Failed-over incorrectly, selected: ${best?.id || "none"}`);
    passed = false;
  }
  
  // E. Report success -> Reset consecutive failures
  reportFailure("yahoo");
  reportSuccess("yahoo");
  diagnostics = getDiagnostics();
  let yahooDiag = diagnostics.find(d => d.providerId === "yahoo");
  if (yahooDiag && yahooDiag.state === "HEALTHY" && yahooDiag.consecutiveFailures === 0 && yahooDiag.totalSuccesses === 1) {
    console.log("  PASS: Success report reset failures and verified HEALTHY state");
  } else {
    console.error(`  FAIL: Success did not reset counters. Diag:`, yahooDiag);
    passed = false;
  }
  
  // F. Return null when all providers are down (No yahoo default override)
  reportFailure("yahoo");
  reportFailure("yahoo");
  reportFailure("yahoo"); // both yahoo and binance now in COOLDOWN
  
  best = getBestProvider(["binance", "yahoo"]);
  if (best === null) {
    console.log("  PASS: getBestProvider returned null when all providers are in cooldown");
  } else {
    console.error(`  FAIL: Expected null, selected: ${best?.id}`);
    passed = false;
  }
  
  // G. Cooldown recovery timeout
  console.log("  Waiting for cooldown (1100ms)...");
  await new Promise(resolve => setTimeout(resolve, 1100));
  
  best = getBestProvider(["binance", "yahoo"]);
  if (best && best.id === "binance") {
    console.log("  PASS: Binance recovered after cooldown and was re-selected");
  } else {
    console.error(`  FAIL: Recovery failed, selected: ${best?.id || "none"}`);
    passed = false;
  }
}

// 2. Test Case 2: Equal-priority & skipping disabled providers
{
  const tc = testCases[1];
  console.log(`\nExecuting: "${tc.description}"`);
  
  resetRegistry(tc.config);
  
  // A. Equal priority deterministic alphabetical check (binance before yahoo)
  let best = getBestProvider(["binance", "yahoo"]);
  if (best && best.id === "binance") {
    console.log("  PASS: Equal-priority providers resolved deterministically by ID (binance)");
  } else {
    console.error(`  FAIL: Equal-priority resolved incorrectly, selected: ${best?.id}`);
    passed = false;
  }
  
  // B. Skip disabled providers
  // Temporarily disable binance config
  tc.config[1].enabled = false; // index 1 is binance in config
  resetRegistry(tc.config);
  
  best = getBestProvider(["binance", "yahoo"]);
  if (best && best.id === "yahoo") {
    console.log("  PASS: Disabled provider (binance) was correctly skipped");
  } else {
    console.error(`  FAIL: Disabled provider was selected: ${best?.id || "none"}`);
    passed = false;
  }
}

if (passed) {
  console.log("\nALL PROVIDER REGISTRY TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME PROVIDER REGISTRY TESTS FAILED!\n");
  process.exit(1);
}
