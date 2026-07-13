import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { translateToMt5Payload } from "../services/mt5ExecutionAdapter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../../test-messages/mt5-adapter-fixtures.json");
const testFixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let passed = true;

console.log("Running MT5 Execution Adapter Verification Suite...\n");

// 1. Assert Valid BUY translation
{
  console.log("[Test 1] Asserting valid BUY request translation...");
  const result = translateToMt5Payload(testFixtures.validBuy);

  if (
    result.status === "TRANSLATED" &&
    result.payload &&
    result.payload.action === "OPEN_ORDER" &&
    result.payload.symbol === "XAUUSD" &&
    result.payload.direction === "BUY" &&
    result.payload.volume === 0.05 &&
    result.payload.price === 4110.0 &&
    result.payload.sl === 4100.0 &&
    result.payload.tp === 4130.0 &&
    result.errors === null
  ) {
    console.log("  PASS: Standard BUY request mapped successfully");
  } else {
    console.error("  FAIL: BUY request translation mismatch:", result);
    passed = false;
  }
}

// 2. Assert Valid SELL translation
{
  console.log("\n[Test 2] Asserting valid SELL request translation...");
  const result = translateToMt5Payload(testFixtures.validSell);

  if (
    result.status === "TRANSLATED" &&
    result.payload &&
    result.payload.action === "OPEN_ORDER" &&
    result.payload.symbol === "GBPUSD" &&
    result.payload.direction === "SELL" &&
    result.payload.volume === 0.1 &&
    result.payload.price === 1.2500 &&
    result.payload.sl === 1.2550 &&
    result.payload.tp === 1.2400 &&
    result.errors === null
  ) {
    console.log("  PASS: Standard SELL request mapped successfully");
  } else {
    console.error("  FAIL: SELL request translation mismatch:", result);
    passed = false;
  }
}

// 3. Assert Non-APPROVED Upstream request gets rejected
{
  console.log("\n[Test 3] Asserting non-APPROVED status gets rejected...");
  const result = translateToMt5Payload(testFixtures.rejectedStatus);

  if (
    result.status === "REJECTED" &&
    result.payload === null &&
    result.errors &&
    result.errors.length > 0 &&
    result.errors[0].includes("Upstream request status is not APPROVED")
  ) {
    console.log("  PASS: Rejected status intercepted correctly");
  } else {
    console.error("  FAIL: Non-approved request was not correctly rejected:", result);
    passed = false;
  }
}

// 4. Assert Invalid Volume bounds get rejected
{
  console.log("\n[Test 4] Asserting volume lot size boundaries...");
  const result = translateToMt5Payload(testFixtures.invalidVolume);

  if (
    result.status === "REJECTED" &&
    result.payload === null &&
    result.errors &&
    result.errors.some(err => err.includes("out of broker bounds"))
  ) {
    console.log("  PASS: Invalid volume rejected correctly");
  } else {
    console.error("  FAIL: Volume size check failed:", result);
    passed = false;
  }
}

// 5. Assert Invalid SL Direction Rules get rejected
{
  console.log("\n[Test 5] Asserting directional Stop Loss rules...");
  const buySlResult = translateToMt5Payload(testFixtures.wrongBuySl);
  const sellSlResult = translateToMt5Payload(testFixtures.wrongSellSl);

  const buyPass = buySlResult.status === "REJECTED" && buySlResult.errors.some(err => err.includes("must be strictly less than entry"));
  const sellPass = sellSlResult.status === "REJECTED" && sellSlResult.errors.some(err => err.includes("must be strictly greater than entry"));

  if (buyPass && sellPass) {
    console.log("  PASS: Wrong SL directions rejected successfully for both BUY and SELL");
  } else {
    console.error("  FAIL: SL direction rules check failed. BuyResult:", buySlResult, "SellResult:", sellSlResult);
    passed = false;
  }
}

// 6. Assert Invalid TP Direction Rules get rejected
{
  console.log("\n[Test 6] Asserting directional Take Profit rules...");
  const buyTpResult = translateToMt5Payload(testFixtures.wrongBuyTp);
  const sellTpResult = translateToMt5Payload(testFixtures.wrongSellTp);

  const buyPass = buyTpResult.status === "REJECTED" && buyTpResult.errors.some(err => err.includes("must be strictly greater than entry"));
  const sellPass = sellTpResult.status === "REJECTED" && sellTpResult.errors.some(err => err.includes("must be strictly less than entry"));

  if (buyPass && sellPass) {
    console.log("  PASS: Wrong TP directions rejected successfully for both BUY and SELL");
  } else {
    console.error("  FAIL: TP direction rules check failed. BuyResult:", buyTpResult, "SellResult:", sellTpResult);
    passed = false;
  }
}

// 7. Assert Output Snapshots are strictly immutable
{
  console.log("\n[Test 7] Asserting diagnostics snapshot immutability...");
  const result = translateToMt5Payload(testFixtures.validBuy);

  if (Object.isFrozen(result) && Object.isFrozen(result.payload)) {
    console.log("  PASS: Output result and nested payload structures are deeply frozen");
    try {
      result.status = "MUTATED";
      console.error("  FAIL: Result modification succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Result modification correctly threw exception");
    }

    try {
      result.payload.price = 9999.9;
      console.error("  FAIL: Nested payload price modification succeeded!");
      passed = false;
    } catch (err) {
      console.log("  PASS: Nested payload property modification correctly threw exception");
    }
  } else {
    console.error("  FAIL: Result or payload was not frozen correctly");
    passed = false;
  }
}

if (passed) {
  console.log("\nALL MT5 EXECUTION ADAPTER TESTS PASSED!\n");
  process.exit(0);
} else {
  console.error("\nSOME MT5 EXECUTION ADAPTER TESTS FAILED!\n");
  process.exit(1);
}
