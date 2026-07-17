import { isMarketClosed, isHoliday, getCurrentTradingSession } from "../services/tradingSessionService.js";
import { evaluateMarketOpportunity } from "../services/decisionEngine.js";

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
  } else {
    console.error(`  FAIL: ${message}`);
    process.exit(1);
  }
}

console.log("=== STARTING NEW SESSION LOGIC VERIFICATION ===");

// 1. Test Weekends
console.log("\n[Test 1] Verifying Weekend (Market Closed) detection...");
// Friday 21:00 UTC (Saturday 02:30 IST) -> Market Open
const friOpen = new Date("2026-07-17T21:00:00Z"); 
assert(isMarketClosed(friOpen) === false, "Friday 21:00 UTC is open");

// Friday 23:00 UTC (Saturday 04:30 IST) -> Market Closed
const friClosed = new Date("2026-07-17T23:00:00Z"); 
assert(isMarketClosed(friClosed) === true, "Friday 23:00 UTC is closed");

// Saturday 12:00 UTC -> Market Closed
const satClosed = new Date("2026-07-18T12:00:00Z"); 
assert(isMarketClosed(satClosed) === true, "Saturday 12:00 UTC is closed");

// Sunday 21:00 UTC (Monday 02:30 IST) -> Market Closed
const sunClosed = new Date("2026-07-19T21:00:00Z");
assert(isMarketClosed(sunClosed) === true, "Sunday 21:00 UTC is closed");

// Sunday 23:00 UTC (Monday 04:30 IST) -> Market Open
const sunOpen = new Date("2026-07-19T23:00:00Z");
assert(isMarketClosed(sunOpen) === false, "Sunday 23:00 UTC is open");

// 2. Test Holidays
console.log("\n[Test 2] Verifying Holiday detection...");
// Christmas Day
const christmas = new Date("2026-12-25T10:00:00Z");
assert(isHoliday(christmas) === true, "Christmas Dec 25 is holiday");

// New Year's Day
const newYear = new Date("2026-01-01T12:00:00Z");
assert(isHoliday(newYear) === true, "New Year Jan 1 is holiday");

// Standard Weekday
const regularDay = new Date("2026-07-15T12:00:00Z");
assert(isHoliday(regularDay) === false, "Regular day July 15 is not holiday");

// 3. Test Session Times (IST)
console.log("\n[Test 3] Verifying Dynamic Session IST mappings...");
// 18:30 IST (13:00 UTC) -> London/NY Overlap (17:30 to 21:30)
const overlapTime = new Date("2026-07-15T13:00:00Z"); 
assert(getCurrentTradingSession(overlapTime) === "London/NY Overlap", `18:30 IST resolves to London/NY Overlap (Actual: ${getCurrentTradingSession(overlapTime)})`);

// 15:00 IST (09:30 UTC) -> London (13:30 to 17:30)
const londonTime = new Date("2026-07-15T09:30:00Z");
assert(getCurrentTradingSession(londonTime) === "London", `15:00 IST resolves to London (Actual: ${getCurrentTradingSession(londonTime)})`);

// 22:30 IST (17:00 UTC) -> New York (21:30 to 02:30)
const nyTime = new Date("2026-07-15T17:00:00Z");
assert(getCurrentTradingSession(nyTime) === "New York", `22:30 IST resolves to New York (Actual: ${getCurrentTradingSession(nyTime)})`);

// 08:30 IST (03:00 UTC) -> Asian (02:30 to 13:30)
const asianTime = new Date("2026-07-15T03:00:00Z");
assert(getCurrentTradingSession(asianTime) === "Asian", `08:30 IST resolves to Asian (Actual: ${getCurrentTradingSession(asianTime)})`);

// 4. Test Holiday confidence penalty in Decision Engine
console.log("\n[Test 4] Verifying Holiday confidence score penalty...");
const baseInputs = {
  timestamp: regularDay.toISOString(), // Regular day (London Session)
  parsedSignals: [
    { action: "BUY", timestamp: regularDay.toISOString(), entry: 2030, stopLoss: 2020, targets: [2045, 2050] }
  ],
  pairState: { direction: "BUY", valuationZone: "Discount", mtfTrend: "Strong Bullish" },
  consensus: { buyConfidence: 100, sellConfidence: 0 },
  marketState: { currentPrice: 2030, volatility: "Low", spread: 1.2, marketClosed: false },
  riskAssessment: { blocked: false, riskGrade: "LOW_RISK", rrr: 2.0 }
};

async function runDecisionTests() {
  const regularResult = await evaluateMarketOpportunity(baseInputs);
  console.log(`  Regular setup score: ${regularResult.score}`);

  const holidayInputs = {
    ...baseInputs,
    timestamp: christmas.toISOString() // Holiday (Christmas Day)
  };

  const holidayResult = await evaluateMarketOpportunity(holidayInputs);
  console.log(`  Holiday setup score: ${holidayResult.score}`);

  assert(holidayResult.score <= regularResult.score - 20, "Holiday setup score is penalized by at least 20 points compared to a normal day");
  assert(holidayResult.warnings.some(w => w.includes("Holiday")), "Holiday warning is pushed in warnings list");

  console.log("\n=== ALL NEW SESSION LOGIC TESTS PASSED ===");
}

runDecisionTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
