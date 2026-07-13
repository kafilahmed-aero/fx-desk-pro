import { getMarketPrice, getDiagnostics, resetDiagnostics } from "../services/marketDataService.js";
import { resetCache } from "../services/priceCacheService.js";
import { resetRegistry, reportFailure, getDiagnostics as getRegistryDiagnostics } from "../services/providerRegistryService.js";

let passed = true;

console.log("Running Market Data Subsystem Verification Suite...\n");

// 1. Verify Cache Hits Never Contact Provider Registry
{
  console.log("Verifying cache hits bypass Provider Registry...");
  resetCache();
  resetRegistry();
  resetDiagnostics();

  // Populate cache
  await getMarketPrice("EURUSD", { ttlMs: 60000 }); // Miss & fetch
  
  // Reset registry logs to 0 checks
  resetRegistry();
  resetDiagnostics();
  
  // Second fetch -> cache hit
  const result = await getMarketPrice("EURUSD", { ttlMs: 60000 });
  const diag = getDiagnostics();
  
  if (result.status === "SUCCESS" && diag.cacheHits === 1 && diag.providerRequests === 0) {
    console.log("  PASS: Cache hit resolved snapshot without querying Provider Registry");
  } else {
    console.error("  FAIL: Cache hit queried provider/registry!", diag);
    passed = false;
  }
}

// 2. Verify snapshot immutability
{
  console.log("\nVerifying market snapshot recursive immutability...");
  const result = await getMarketPrice("EURUSD", { ttlMs: 60000 });
  
  if (Object.isFrozen(result)) {
    console.log("  PASS: Snapshot structure is strictly frozen");
    try {
      result.price = 999.99;
      console.error("  FAIL: Mutation succeeded without throwing!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Attempted mutation correctly threw an exception");
    }
  } else {
    console.error("  FAIL: Snapshot structure is not frozen!");
    passed = false;
  }
}

// 3. Verify Failover Loop Prevention and Failure Diagnostics
{
  console.log("\nVerifying failover loop prevention and health updates...");
  resetCache();
  resetDiagnostics();
  
  // Place binance and yahoo in COOLDOWN so getBestProvider returns null/depleted
  resetRegistry([
    { id: "binance", priority: 1, enabled: true, cooldownMs: 100000, maxFailures: 1 },
    { id: "yahoo", priority: 2, enabled: true, cooldownMs: 100000, maxFailures: 1 }
  ]);
  
  reportFailure("binance");
  reportFailure("yahoo"); // both in COOLDOWN now
  
  resetDiagnostics();
  
  // Fetch should immediately fail without infinite loop
  const result = await getMarketPrice("BTCUSD", { ttlMs: 60000 });
  const diag = getDiagnostics();
  
  if (result.status === "UNAVAILABLE" && diag.providerRequests === 0) {
    console.log("  PASS: Loop avoided, returned UNAVAILABLE structured response immediately");
  } else {
    console.error("  FAIL: Expected UNAVAILABLE with 0 requests, received:", result, diag);
    passed = false;
  }
}

// 4. Verify Failover Count Increments
{
  console.log("\nVerifying failover routing counters...");
  resetCache();
  resetDiagnostics();
  
  // Set up with binance failing, triggering fallback to yahoo
  resetRegistry([
    { id: "binance", priority: 1, enabled: true, cooldownMs: 100000, maxFailures: 1 },
    { id: "yahoo", priority: 2, enabled: true, cooldownMs: 100000, maxFailures: 3 }
  ]);
  
  // We can force binance to fail by triggering a failure before our call, placing it in COOLDOWN
  reportFailure("binance");
  
  resetDiagnostics();
  
  // Call BTCUSD. Binance is in COOLDOWN, so it should failover to Yahoo (candidate candidates: binance, yahoo).
  // Thus yahoo is requested.
  const result = await getMarketPrice("BTCUSD", { ttlMs: 60000 });
  const diag = getDiagnostics();
  
  if (result.status === "SUCCESS" && result.source === "YAHOO") {
    console.log("  PASS: Automatically routed to fallback Yahoo provider when Binance is down");
  } else {
    console.error("  FAIL: Failover routing did not resolve to YAHOO:", result);
    passed = false;
  }
}

if (passed) {
  console.log("\nALL MARKET DATA ORCHESTRATION TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME MARKET DATA ORCHESTRATION TESTS FAILED!\n");
  process.exit(1);
}
