import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  setCachedPrice,
  getCachedPrice,
  resetCache,
  getDiagnostics,
  isCacheStale
} from "../services/priceCacheService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/price-cache-fixtures.json");
const testCases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running Price Cache Verification Suite...\n");

resetCache();

// 1. Verify Multiple Trading Pairs Coexist Correctly
console.log("Verifying multiple trading pairs coexistence...");
const tc1 = testCases[0];
const tc2 = testCases[1];

setCachedPrice(tc1.pair, tc1.payload, 60000);
setCachedPrice(tc2.pair, tc2.payload, 60000);

let eur = getCachedPrice("EURUSD");
let gbp = getCachedPrice("GBPUSD");

if (eur && eur.price === 1.0820 && gbp && gbp.price === 1.2530) {
  console.log("  PASS: Multiple trading pairs exist in the cache simultaneously");
} else {
  console.error("  FAIL: Simultaneous caching failed");
  passed = false;
}

// 2. Verify Deep Freeze Prevents Nested Mutations
console.log("\nVerifying deep freeze nested mutations protection...");
if (Object.isFrozen(eur) && Object.isFrozen(eur.meta)) {
  console.log("  PASS: Deep freeze applied recursively to nested properties");
  try {
    eur.meta.providerPriority = 99;
    console.error("  FAIL: Nested mutation did not throw!");
    passed = false;
  } catch (err) {
    console.log("  PASS: Mutating nested property correctly threw an exception");
  }
} else {
  console.error("  FAIL: Deep freeze was not applied to nested properties!");
  passed = false;
}

// 3. Verify Expired Reads Increment staleRead Metrics
console.log("\nVerifying cache expiration and stale reads increments...");
setCachedPrice("EURUSD", tc1.payload, 100); // 100ms TTL

let ready = getCachedPrice("EURUSD");
if (ready) {
  console.log("  PASS: Fresh cache read succeeded");
} else {
  console.error("  FAIL: Fresh cache read returned null");
  passed = false;
}

// Wait for expiration
console.log("  Waiting 150ms for TTL expiration...");
await new Promise(resolve => setTimeout(resolve, 150));

let expired = getCachedPrice("EURUSD");
if (expired === null) {
  console.log("  PASS: Expired cache returned null");
} else {
  console.error("  FAIL: Expired cache returned non-null payload!");
  passed = false;
}

if (isCacheStale("EURUSD")) {
  console.log("  PASS: isCacheStale correctly reported true");
} else {
  console.error("  FAIL: isCacheStale reported false");
  passed = false;
}

let diag = getDiagnostics();
if (diag.staleReads === 1) {
  console.log("  PASS: Expired reads correctly incremented staleReads diagnostics counter");
} else {
  console.error(`  FAIL: Expected staleReads = 1, received: ${diag.staleReads}`);
  passed = false;
}

// 4. Verify Cache Reset Removes Every Entry
console.log("\nVerifying cache reset...");
resetCache();
diag = getDiagnostics();

if (diag.totalEntries === 0 && getCachedPrice("GBPUSD") === null && diag.cacheHits === 0) {
  console.log("  PASS: Cache reset cleared all entries and reset diagnostic stats successfully");
} else {
  console.error("  FAIL: Cache reset did not clear stats cleanly:", diag);
  passed = false;
}

if (passed) {
  console.log("\nALL PRICE CACHE TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME PRICE CACHE TESTS FAILED!\n");
  process.exit(1);
}
