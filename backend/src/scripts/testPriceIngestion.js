import { getCurrentPrice, fetchWithRetry } from "../services/priceIngestionService.js";

let passed = true;

console.log("Starting Price Ingestion Reliability Tests...");

// 1. Verify Immutability Locks (Object.freeze)
try {
  console.log("\nVerifying object freeze locks on getCurrentPrice...");
  const priceInfo = await getCurrentPrice("EURUSD");
  
  if (!priceInfo) {
    console.error("  FAIL: EURUSD price info is null");
    passed = false;
  } else {
    console.log(`  Received: price=${priceInfo.price}, source=${priceInfo.source}`);
    
    // Assert fields
    if (typeof priceInfo.price !== "number" || isNaN(priceInfo.price)) {
      console.error("  FAIL: price is not a valid number");
      passed = false;
    }
    
    // Check freeze
    if (!Object.isFrozen(priceInfo)) {
      console.error("  FAIL: Returned priceInfo object is not frozen!");
      passed = false;
    } else {
      console.log("  PASS: Returned priceInfo object is strictly frozen");
      
      // Attempt mutation to confirm it throws in strict mode
      try {
        priceInfo.price = 999.99;
        console.error("  FAIL: Mutating frozen object succeeded without throwing!");
        passed = false;
      } catch (mutateErr) {
        console.log("  PASS: Attempted mutation correctly threw an exception");
      }
    }
  }
} catch (err) {
  console.error("  FAIL: Exception during getCurrentPrice verification:", err.message);
  passed = false;
}

// 2. Verify fetchWithRetry Exponential Backoff
try {
  console.log("\nVerifying fetchWithRetry exponential backoff retries...");
  const startTime = Date.now();
  
  // Call an invalid domain that throws ENOTFOUND, configuring 2 retries (total 3 attempts)
  let threw = false;
  try {
    await fetchWithRetry("https://invalid-domain-does-not-exist-12345.com", {}, 2, 100);
  } catch (retryErr) {
    threw = true;
    console.log("  Caught expected retry error:", retryErr.message);
  }
  
  const elapsed = Date.now() - startTime;
  
  if (!threw) {
    console.error("  FAIL: fetchWithRetry did not throw on invalid URL");
    passed = false;
  } else {
    // Delays should be:
    // Attempt 1: fails
    // Delay 1: 100 * 2^0 = 100ms
    // Attempt 2: fails
    // Delay 2: 100 * 2^1 = 200ms
    // Attempt 3: fails -> throws
    // Total delay time: ~300ms + request timeouts
    console.log(`  Elapsed time for retries: ${elapsed}ms`);
    if (elapsed >= 300) {
      console.log("  PASS: Backoff delay was correctly enforced between retries");
    } else {
      console.error("  FAIL: Backoff delay was not correctly enforced!");
      passed = false;
    }
  }
} catch (err) {
  console.error("  FAIL: Exception during fetchWithRetry verification:", err.message);
  passed = false;
}

if (passed) {
  console.log("\nALL PRICE INGESTION TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME PRICE INGESTION TESTS FAILED!\n");
  process.exit(1);
}
