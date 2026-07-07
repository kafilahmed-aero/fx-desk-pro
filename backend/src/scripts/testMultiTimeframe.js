import { buildCandles, buildMultiTimeframeContext } from "../services/multiTimeframeIntelligenceService.js";
import { priceHistoryCache } from "../services/priceIngestionService.js";

async function run() {
  console.log("=== RUNNING MULTI-TIMEFRAME INTELLIGENCE UNIT TESTS ===");

  let failed = false;

  // Test Case 1: Candle Aggregation
  console.log("\n[Test 1] Testing Candle Aggregation...");
  // Align baseTime to the exact start of a minute (second 0) to ensure exact minute grouping
  const baseTime = Math.floor(Date.now() / 60000) * 60000;
  const ticks = [
    { price: 100, timestamp: baseTime },
    { price: 105, timestamp: baseTime + 10 * 1000 },
    { price: 95, timestamp: baseTime + 20 * 1000 },
    { price: 102, timestamp: baseTime + 50 * 1000 }, // 1m group 1 (minute 0)
    { price: 110, timestamp: baseTime + 70 * 1000 },
    { price: 112, timestamp: baseTime + 80 * 1000 },
    { price: 108, timestamp: baseTime + 110 * 1000 }, // 1m group 2 (minute 1)
  ];

  const candles1m = buildCandles(ticks, 1);
  if (candles1m.length !== 2) {
    console.error(`-> FAIL: Expected 2 candles, got ${candles1m.length}`);
    failed = true;
  } else {
    const c1 = candles1m[0];
    const c2 = candles1m[1];
    if (c1.open !== 100 || c1.high !== 105 || c1.low !== 95 || c1.close !== 102) {
      console.error("-> FAIL: Candle 1 OHLC is incorrect", c1);
      failed = true;
    } else if (c2.open !== 110 || c2.high !== 112 || c2.low !== 108 || c2.close !== 108) {
      console.error("-> FAIL: Candle 2 OHLC is incorrect", c2);
      failed = true;
    } else {
      console.log("-> PASS: Candle aggregation successfully groups tick sequences.");
    }
  }

  // Test Case 2: Insufficient History Handling
  console.log("\n[Test 2] Testing Insufficient History Handling (< 10 candles)...");
  priceHistoryCache.clear();
  // Provide only 5 ticks spaced by 1 minute
  const ticksShort = [];
  for (let i = 0; i < 5; i++) {
    ticksShort.push({ price: 2000 + i, timestamp: baseTime + i * 60 * 1000 });
  }
  priceHistoryCache.set("XAUUSD", ticksShort);

  const contextShort = buildMultiTimeframeContext("XAUUSD");
  const m1Short = contextShort["1m"];
  if (m1Short.status !== "INSUFFICIENT_HISTORY") {
    console.error(`-> FAIL: Expected status INSUFFICIENT_HISTORY, got ${m1Short.status}`);
    failed = true;
  } else if (m1Short.currentPrice !== null || m1Short.trendDirection !== null) {
    console.error("-> FAIL: Expected null metrics under insufficient history condition");
    failed = true;
  } else if (m1Short.historyCoverage !== Math.round((5 / 30) * 100)) {
    console.error(`-> FAIL: History coverage incorrect, got ${m1Short.historyCoverage}%`);
    failed = true;
  } else {
    console.log("-> PASS: Insufficient history correctly returns fallback null variables.");
  }

  // Test Case 3: Robust Calculations (Trend, ATR, Volatility, Phase)
  console.log("\n[Test 3] Testing Robust Timeframe Indicator Calculations...");
  priceHistoryCache.clear();
  const ticksLong = [];
  // Generate 35 minutes of ticks with a distinct bullish trend
  for (let i = 0; i < 35; i++) {
    const time = baseTime + i * 60 * 1000;
    const basePrice = 2000 + i;
    ticksLong.push({ price: basePrice - 0.5, timestamp: time });
    ticksLong.push({ price: basePrice + 1.0, timestamp: time + 15 * 1000 });
    ticksLong.push({ price: basePrice, timestamp: time + 30 * 1000 });
  }
  priceHistoryCache.set("XAUUSD", ticksLong);

  const contextLong = buildMultiTimeframeContext("XAUUSD");
  const m1Long = contextLong["1m"];

  console.log("Calculated 1m timeframe metrics:\n", JSON.stringify(m1Long, null, 2));

  if (m1Long.status !== "OK") {
    console.error(`-> FAIL: Expected status OK, got ${m1Long.status}`);
    failed = true;
  } else {
    if (m1Long.currentPrice !== 2034) {
      console.error(`-> FAIL: Current price incorrect, expected 2034, got ${m1Long.currentPrice}`);
      failed = true;
    }
    if (m1Long.highestPrice !== 2035) {
      console.error(`-> FAIL: Highest price incorrect, expected 2035, got ${m1Long.highestPrice}`);
      failed = true;
    }
    if (m1Long.lowestPrice !== 1999.5) {
      console.error(`-> FAIL: Lowest price incorrect, expected 1999.5, got ${m1Long.lowestPrice}`);
      failed = true;
    }
    if (m1Long.ATR <= 0) {
      console.error(`-> FAIL: ATR incorrect, expected positive value, got ${m1Long.ATR}`);
      failed = true;
    }
    if (m1Long.trendDirection !== "Bullish" || m1Long.trendScore <= 0) {
      console.error(`-> FAIL: Trend direction/score incorrect, got Direction: ${m1Long.trendDirection}, Score: ${m1Long.trendScore}`);
      failed = true;
    }
    if (m1Long.momentum !== "Bullish" || m1Long.momentumScore <= 0) {
      console.error(`-> FAIL: Momentum incorrect, got Momentum: ${m1Long.momentum}, Score: ${m1Long.momentumScore}`);
      failed = true;
    }
    if (m1Long.volatilityValue <= 0) {
      console.error(`-> FAIL: Volatility value incorrect, got ${m1Long.volatilityValue}`);
      failed = true;
    }
    if (!["Trending", "Ranging", "Breakout", "Pullback", "Reversal"].includes(m1Long.marketPhase)) {
      console.error(`-> FAIL: Market phase is invalid, got ${m1Long.marketPhase}`);
      failed = true;
    }
    if (m1Long.marketPhaseConfidence <= 0 || m1Long.marketPhaseConfidence > 100) {
      console.error(`-> FAIL: Confidence incorrect, got ${m1Long.marketPhaseConfidence}`);
      failed = true;
    }
    if (m1Long.historyCoverage !== 100) {
      console.error(`-> FAIL: Expected history coverage 100%, got ${m1Long.historyCoverage}%`);
      failed = true;
    }

    if (!failed) {
      console.log("-> PASS: All metrics (ATR, scores, volatility, phase confidence) correctly computed.");
    }
  }

  if (failed) {
    console.error("\n=== MULTI-TIMEFRAME INTELLIGENCE UNIT TESTS FAILED ===");
    process.exit(1);
  } else {
    console.log("\n=== ALL MULTI-TIMEFRAME INTELLIGENCE UNIT TESTS PASSED ===");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
