import mongoose from "mongoose";
import { config } from "../config/env.js";
import {
  validateTradeRequest,
  saveRiskAuditToLedger,
  getRiskAudits,
  localPhoenixRiskAudits
} from "../services/riskManagerService.js";
import { RISK_MANAGER_POLICY } from "../config/riskManagerPolicy.js";
import { PhoenixRiskAudit } from "../models/phoenixRiskAuditModel.js";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log("=== RUNNING PHOENIX RISK MANAGER TESTS ===\n");

  let isMongoAvailable = false;
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
    isMongoAvailable = true;
    console.log("  CONNECTED to MongoDB database!");
  } catch (err) {
    console.log("  OFFLINE mode active (MongoDB unavailable). Testing local caching capabilities...");
  }

  // Clear caches
  localPhoenixRiskAudits.clear();
  if (isMongoAvailable) {
    try {
      await mongoose.connection.db.collection("phoenixRiskAudit").deleteMany({});
    } catch (e) {}
  }

  // Force offline state for local cache checks
  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, "readyState", { value: 0, writable: true });

  const validRequest = {
    recommendationId: "REC-RISK-TEST-001",
    symbol: "XAUUSD",
    action: "BUY",
    volume: 0.1,
    entry: 2000.00
  };

  // 1. Trading Disabled Gate check
  console.log("\n[Test 1] Testing Trading Disabled Check...");
  RISK_MANAGER_POLICY.tradingEnabled = false;
  const res1 = await validateTradeRequest(validRequest);
  assert(res1.decision === "REJECTED", "Trade is REJECTED when tradingEnabled is false");
  assert(res1.reason === "TRADING_DISABLED", "Rejection reason is TRADING_DISABLED");
  
  // Restore trading status
  RISK_MANAGER_POLICY.tradingEnabled = true;

  // 2. Maximum Open Positions Gate check
  console.log("\n[Test 2] Testing Maximum Open Positions limit...");
  const mockActivePositions = [
    { pair: "XAUUSD", direction: "BUY" },
    { pair: "XAUUSD", direction: "SELL" },
    { pair: "XAUUSD", direction: "BUY" }
  ];
  const res2 = await validateTradeRequest(validRequest, { mockActivePositions });
  assert(res2.decision === "REJECTED", "Trade is REJECTED when open positions count equals max limit (3)");
  assert(res2.reason === "MAX_POSITIONS_EXCEEDED", "Rejection reason is MAX_POSITIONS_EXCEEDED");

  // 3. Duplicate Position Check Gate check
  console.log("\n[Test 3] Testing Duplicate Position Check...");
  const mockActiveDuplicate = [
    { pair: "XAUUSD", direction: "BUY" }
  ];
  const res3 = await validateTradeRequest(validRequest, { mockActiveTrades: mockActiveDuplicate });
  assert(res3.decision === "REJECTED", "Trade is REJECTED when a position in the same direction is already active");
  assert(res3.reason === "DUPLICATE_POSITION", "Rejection reason is DUPLICATE_POSITION");

  // 4. Spread Check Gate check
  console.log("\n[Test 4] Testing Spread Check limit...");
  const res4 = await validateTradeRequest(validRequest, { spread: 6.5 }); // threshold is 5.0
  assert(res4.decision === "REJECTED", "Trade is REJECTED when spread is above threshold");
  assert(res4.reason === "EXCESSIVE_SPREAD", "Rejection reason is EXCESSIVE_SPREAD");

  // 5. Lot Size Validation Gate check
  console.log("\n[Test 5] Testing Lot Size Validation bounds...");
  const invalidRequestUnder = { ...validRequest, volume: 0.005 };
  const res5Under = await validateTradeRequest(invalidRequestUnder);
  assert(res5Under.decision === "REJECTED", "Trade is REJECTED when volume is below minimum lot size (0.01)");
  
  const invalidRequestOver = { ...validRequest, volume: 10.0 };
  const res5Over = await validateTradeRequest(invalidRequestOver);
  assert(res5Over.decision === "REJECTED", "Trade is REJECTED when volume exceeds maximum lot size (5.0)");
  assert(res5Over.reason === "INVALID_LOT_SIZE", "Rejection reason is INVALID_LOT_SIZE");

  // 6. Margin Availability Gate check
  console.log("\n[Test 6] Testing Margin Availability limits...");
  const res6 = await validateTradeRequest(validRequest, { balance: 210.00, marginUsed: 0.0 }); // Margin = 0.1 * 2000 = 200 USD. Ratio = 200/210 = 95%. Max ratio is 85%.
  assert(res6.decision === "REJECTED", "Trade is REJECTED when free margin ratio violates policy safety buffer");
  assert(res6.reason === "INSUFFICIENT_MARGIN", "Rejection reason is INSUFFICIENT_MARGIN");

  // 7. Symbol Validation Gate check
  console.log("\n[Test 7] Testing Symbol Validation allowed list...");
  const invalidSymbolRequest = { ...validRequest, symbol: "EURUSD" };
  const res7 = await validateTradeRequest(invalidSymbolRequest);
  assert(res7.decision === "REJECTED", "Trade is REJECTED when symbol is not in allowed list");
  assert(res7.reason === "INVALID_SYMBOL", "Rejection reason is INVALID_SYMBOL");

  // 8. Daily Risk Limits Gate check
  console.log("\n[Test 8] Testing Daily Risk Limits check...");
  // Simulated list of 11 trades today (Max is 10)
  const mockDailyTradesCount = Array(11).fill({ result: { netProfit: 10.0 } });
  const res8Count = await validateTradeRequest(validRequest, { mockDailyTrades: mockDailyTradesCount });
  assert(res8Count.decision === "REJECTED", "Trade is REJECTED when daily trades limit is exceeded");
  
  // Simulated daily loss of 600 USD (Max is 500)
  const mockDailyLoss = [
    { result: { netProfit: -400.0 } },
    { result: { netProfit: -200.0 } }
  ];
  const res8Loss = await validateTradeRequest(validRequest, { mockDailyTrades: mockDailyLoss });
  assert(res8Loss.decision === "REJECTED", "Trade is REJECTED when daily net loss threshold is exceeded");
  assert(res8Loss.reason === "DAILY_LIMITS_EXCEEDED", "Rejection reason is DAILY_LIMITS_EXCEEDED");

  // 9. Successful Approval check
  console.log("\n[Test 9] Testing Successful Approval...");
  const resApproved = await validateTradeRequest(validRequest, { balance: 10000.00, marginUsed: 0.00, spread: 1.2 });
  assert(resApproved.decision === "APPROVED", "Trade is APPROVED when all safety gates pass");
  assert(resApproved.reason === null, "Approved request has no failure reason");
  assert(resApproved.evaluations.length === 9, "Evaluated exactly 9 safety check gates");
  assert(resApproved.policyVersion === RISK_MANAGER_POLICY.policyVersion, "Preserves correct policyVersion");

  // 10. Offline Caching audit check
  console.log("\n[Test 10] Testing Offline Caching audit ledger...");
  const saved = await saveRiskAuditToLedger(resApproved);
  assert(localPhoenixRiskAudits.size === 1, "Audit saved to local offline map cache");
  assert(localPhoenixRiskAudits.has(resApproved.auditId), "Local cache maps correct auditId");

  const queriedLocal = await getRiskAudits({ decision: "APPROVED" });
  assert(queriedLocal.length === 1, "getRiskAudits retrieves logs from local cache in offline mode");

  // 11. Mongoose database audit checks (if database connected)
  if (isMongoAvailable) {
    console.log("\n[Test 11] Testing Mongoose Database Integration...");
    Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

    try {
      await saveRiskAuditToLedger(resApproved);
      
      const queried = await getRiskAudits({ decision: "APPROVED" });
      assert(queried.length > 0, "getRiskAudits retrieves logs from MongoDB database");

      // Verify immutability
      try {
        await PhoenixRiskAudit.updateOne({ auditId: resApproved.auditId }, { $set: { decision: "REJECTED" } });
        assert(false, "Mongoose allowed updating append-only risk audit decision");
      } catch (e) {
        assert(e.message.includes("prohibited"), `updateOne blocked modifications (Message: ${e.message})`);
      }

      try {
        await PhoenixRiskAudit.deleteOne({ auditId: resApproved.auditId });
        assert(false, "Mongoose allowed deleting append-only risk audit record");
      } catch (e) {
        assert(e.message.includes("prohibited"), `deleteOne blocked deletions (Message: ${e.message})`);
      }
    } catch (e) {
      console.error("  FAIL: Online validation failed", e);
      failCount++;
    }
  }

  // Restore state
  Object.defineProperty(mongoose.connection, "readyState", { value: originalState, writable: true });

  console.log(`\n==============================================`);
  console.log(`TEST RUN COMPLETE: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log(`==============================================`);
  
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
