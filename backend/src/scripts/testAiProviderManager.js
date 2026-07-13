import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initializeRegistry,
  setProviderConfig,
  getPrioritizedProviders,
  reportSuccess,
  reportFailure,
  getDiagnostics
} from "../services/aiProviderManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/provider-manager-fixtures.json");
const testConfigs = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running AI Provider Manager Verification Suite...\n");

// 1. Initialize with fixtures configuration
console.log("Initializing registry with fixtures...");
initializeRegistry(testConfigs);

// 2. Assert Priority Sorting
{
  console.log("\n[Test 1] Asserting priority sorting order...");
  const prioritized = getPrioritizedProviders();
  if (
    prioritized.length === 2 &&
    prioritized[0].id === "gemini" &&
    prioritized[0].priority === 1 &&
    prioritized[1].id === "mock" &&
    prioritized[1].priority === 2
  ) {
    console.log("  PASS: Providers sorted correctly (gemini first, mock second)");
  } else {
    console.error("  FAIL: Sorted list mismatch:", prioritized);
    passed = false;
  }
}

// 3. Assert Runtime Settings Update (enable/disable)
{
  console.log("\n[Test 2] Asserting runtime settings update (disabling gemini)...");
  setProviderConfig("gemini", { enabled: false });
  
  const prioritized = getPrioritizedProviders();
  if (prioritized.length === 1 && prioritized[0].id === "mock") {
    console.log("  PASS: Gemini disabled successfully at runtime, mock resolved as primary candidate");
  } else {
    console.error("  FAIL: Disabling Gemini did not shift prioritized list correctly:", prioritized);
    passed = false;
  }

  // Restore Gemini
  setProviderConfig("gemini", { enabled: true });
}

// 4. Assert Circuit Breaker state transitions (Success/Failure reporting)
{
  console.log("\n[Test 3] Asserting health state transitions (Circuit Breaker triggers cooldown)...");
  // Set Gemini max failures to 2 and cooldown to 1 second for fast testing
  setProviderConfig("gemini", { maxFailures: 2, cooldownMs: 1000 });

  // Report first failure
  reportFailure("gemini");
  let diags = getDiagnostics();
  let geminiDiag = diags.find(d => d.providerId === "gemini");
  
  if (geminiDiag.status === "DEGRADED" && geminiDiag.consecutiveFailures === 1) {
    console.log("  PASS: First failure correctly degraded provider status to DEGRADED");
  } else {
    console.error("  FAIL: First failure did not degrade status properly:", geminiDiag);
    passed = false;
  }

  // Report second failure (hitting limit)
  reportFailure("gemini");
  diags = getDiagnostics();
  geminiDiag = diags.find(d => d.providerId === "gemini");

  if (geminiDiag.status === "COOLDOWN" && geminiDiag.consecutiveFailures === 2 && geminiDiag.cooldownUntil !== null) {
    console.log("  PASS: Hitting failure limit successfully triggered COOLDOWN state");
  } else {
    console.error("  FAIL: Cooldown status not triggered properly:", geminiDiag);
    passed = false;
  }

  // Cooldown status prevents it from resolving in getPrioritizedProviders
  const prioritized = getPrioritizedProviders();
  if (prioritized.length === 1 && prioritized[0].id === "mock") {
    console.log("  PASS: Cooled-down provider correctly excluded from prioritization resolution");
  } else {
    console.error("  FAIL: Cooled-down provider was incorrectly included:", prioritized);
    passed = false;
  }
}

// 5. Assert Cooldown Auto-recovery
{
  console.log("\n[Test 4] Asserting cooldown auto-recovery...");
  // Wait for 1.1 seconds for cooldown recovery
  setTimeout(() => {
    const prioritized = getPrioritizedProviders();
    const diags = getDiagnostics();
    const geminiDiag = diags.find(d => d.providerId === "gemini");

    if (
      prioritized.length === 2 &&
      prioritized[0].id === "gemini" &&
      geminiDiag.status === "HEALTHY" &&
      geminiDiag.consecutiveFailures === 0
    ) {
      console.log("  PASS: Cooled-down provider automatically recovered to HEALTHY state after cooldown expiration");
    } else {
      console.error("  FAIL: Provider failed to recover automatically:", geminiDiag, prioritized);
      passed = false;
    }

    runImmutabilityChecks();
  }, 1100);
}

// 6. Assert Immutability Locks
function runImmutabilityChecks() {
  console.log("\n[Test 5] Asserting diagnostics snapshot immutability...");
  const diags = getDiagnostics();

  if (Object.isFrozen(diags)) {
    console.log("  PASS: Diagnostics list is frozen");
    try {
      diags[0] = { hacked: true };
      console.error("  FAIL: Mutation on diagnostics list succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted list mutation correctly threw exception");
    }
  } else {
    console.error("  FAIL: Diagnostics list is NOT frozen");
    passed = false;
  }

  if (diags[0] && Object.isFrozen(diags[0])) {
    console.log("  PASS: Diagnostics item is frozen");
    try {
      diags[0].status = "HACKED_HEALTH";
      console.error("  FAIL: Mutation on diagnostics item succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted item property mutation correctly threw exception");
    }
  } else {
    console.error("  FAIL: Diagnostics item is NOT frozen");
    passed = false;
  }

  finalizeTests();
}

function finalizeTests() {
  if (passed) {
    console.log("\nALL AI PROVIDER MANAGER TESTS PASSED!\n");
    process.exit(0);
  } else {
    console.error("\nSOME AI PROVIDER MANAGER TESTS FAILED!\n");
    process.exit(1);
  }
}
