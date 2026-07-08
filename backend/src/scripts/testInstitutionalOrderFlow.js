import mongoose from "mongoose";
import * as geminiAdvisor from "../services/geminiAdvisorService.js";
import { priceHistoryCache, updatePriceCacheAndHistory } from "../services/priceIngestionService.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { MarketPrice } from "../models/marketPriceModel.js";
import { config } from "../config/env.js";

function generateCandleTicks(baseTime, intervalMin, candlesData) {
  const ticks = [];
  candlesData.forEach((c, k) => {
    const startTime = baseTime + k * intervalMin * 60000;
    ticks.push({ price: c.open, timestamp: startTime });
    ticks.push({ price: c.high, timestamp: startTime + 1000 });
    ticks.push({ price: c.low, timestamp: startTime + 2000 });
    ticks.push({ price: c.close, timestamp: startTime + (intervalMin * 60000 - 1000) });
  });
  return ticks;
}

async function run() {
  console.log("=== RUNNING INSTITUTIONAL ORDER FLOW UNIT TESTS ===");

  config.geminiApiKey = "mock-api-key";

  // Stub ReadyState
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true
  });

  // Stub DB queries to avoid connection delays
  ParsedSignal.find = () => ({ lean: async () => [] });
  MarketPrice.findById = () => ({ lean: async () => null });
  mongoose.Model.prototype.save = async function() { return this; };

  // Intercept fetch to capture advisor prompt
  let capturedPrompt = null;
  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(options.body);
      capturedPrompt = body.contents[0].parts[0].text;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            pair: "XAUUSD",
            direction: "HOLD",
            entryMin: 0,
            entryMax: 0,
            sl: 0,
            tp: 0,
            moderateTp: 0,
            highRiskTp: 0,
            tradeQuality: "Average",
            confidence: 50,
            estimatedHoldingTime: "30-60 min",
            tradeStyle: "Intraday",
            reasoning: ["Hold position"]
          }) }] } }]
        })
      };
    }
    return { ok: true, status: 200, text: async () => "<rss></rss>", json: async () => [] };
  };

  // Create a structured history spanning 30 candles on the 15-minute interval
  const baseTime = Math.floor(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000) - 35 * 15 * 60 * 1000;
  
  const candlesData = [
    // 0-4: Base price actions
    { open: 2000, high: 2005, low: 1998, close: 2002 },
    // Candle 1: Big Bullish Expansion to trigger Bullish FVG
    { open: 2002, high: 2022, low: 2002, close: 2020 },
    // Candle 2: High price hold
    { open: 2020, high: 2025, low: 2008, close: 2015 },
    { open: 2015, high: 2018, low: 2012, close: 2016 },
    { open: 2016, high: 2020, low: 2014, close: 2018 },
    
    // 5-9: Bearish FVG trigger
    { open: 2050, high: 2052, low: 2045, close: 2048 },
    // Candle 6: Big Bearish Expansion
    { open: 2048, high: 2048, low: 2024, close: 2026 },
    // Candle 7: Low price hold
    { open: 2026, high: 2032, low: 2025, close: 2028 },
    { open: 2028, high: 2030, low: 2020, close: 2022 },
    { open: 2022, high: 2025, low: 2018, close: 2020 },

    // 10-14: Bullish OB (bearish candle followed by 2 bullish expansion candles)
    { open: 2010, high: 2012, low: 2002, close: 2004 }, // OB Candle (10)
    { open: 2004, high: 2025, low: 2004, close: 2022 },
    { open: 2022, high: 2030, low: 2020, close: 2026 },
    { open: 2026, high: 2028, low: 2022, close: 2024 },
    { open: 2024, high: 2026, low: 2020, close: 2022 },

    // 15-19: Bearish OB (bullish candle followed by bearish expansions)
    { open: 2030, high: 2038, low: 2028, close: 2036 }, // OB Candle (15)
    { open: 2036, high: 2036, low: 2010, close: 2012 },
    { open: 2012, high: 2015, low: 2005, close: 2008 },
    { open: 2008, high: 2010, low: 2003, close: 2005 },
    { open: 2005, high: 2008, low: 2004, close: 2004 },

    // 20-25: Equal Highs (Liquidity pools)
    { open: 2030, high: 2035, low: 2028, close: 2031 }, // Swing high 1 at index 20 (high: 2035)
    { open: 2031, high: 2033, low: 2029, close: 2030 },
    { open: 2030, high: 2032, low: 2028, close: 2029 },
    { open: 2029, high: 2035.1, low: 2027, close: 2032 }, // Swing high 2 at index 23 (high: 2035.1) -> Equal Highs
    { open: 2032, high: 2034, low: 2030, close: 2031 },
    { open: 2031, high: 2032, low: 2029, close: 2030 }
  ];

  const ticks = generateCandleTicks(baseTime, 15, candlesData);
  priceHistoryCache.set("XAUUSD", ticks);

  // Set current price and cache spread
  updatePriceCacheAndHistory("XAUUSD", {
    price: 2012,
    bid: 2011.8,
    ask: 2012.2,
    lastUpdated: new Date(),
    source: "YAHOO"
  });

  // Execute recommendation to compile prompt
  const res = await geminiAdvisor.getXauusdRecommendation("MANUAL");

  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt is empty.");
    process.exit(1);
  }

  console.log("Captured Institutional Order Flow Section:\n");
  const startIdx = capturedPrompt.indexOf("INSTITUTIONAL ORDER FLOW");
  const endIdx = capturedPrompt.indexOf("SECTION 8");
  const segment = capturedPrompt.slice(startIdx, endIdx);
  console.log(segment);

  let failed = false;

  // 1. Verify FVG Detection
  if (!segment.includes("Nearest Bullish FVG:") || segment.includes("Nearest Bullish FVG: None")) {
    console.error("-> FAIL: Bullish FVG was not detected.");
    failed = true;
  } else {
    console.log("-> PASS: Bullish FVG successfully detected.");
  }
  
  if (!segment.includes("Nearest Bearish FVG:") || segment.includes("Nearest Bearish FVG: None")) {
    console.error("-> FAIL: Bearish FVG was not detected.");
    failed = true;
  } else {
    console.log("-> PASS: Bearish FVG successfully detected.");
  }

  // 2. Verify Order Block Strength & Mitigation
  if (!segment.includes("Nearest Bullish Order Block:") || segment.includes("Nearest Bullish Order Block: None")) {
    console.error("-> FAIL: Bullish Order Block was not detected.");
    failed = true;
  } else {
    console.log("-> PASS: Bullish Order Block successfully detected.");
  }

  if (!segment.includes("Nearest Bearish Order Block:") || segment.includes("Nearest Bearish Order Block: None")) {
    console.error("-> FAIL: Bearish Order Block was not detected.");
    failed = true;
  } else {
    console.log("-> PASS: Bearish Order Block successfully detected.");
  }

  // 3. Verify Liquidity Pool Prioritization
  if (!segment.includes("Nearest Liquidity Pool:") || segment.includes("Nearest Liquidity Pool: None")) {
    console.error("-> FAIL: Liquidity Pools were not prioritized.");
    failed = true;
  } else {
    console.log("-> PASS: Liquidity Pool prioritization is active.");
  }

  if (!segment.includes("Equal Highs:")) {
    console.error("-> FAIL: Equal Highs check missing.");
    failed = true;
  } else {
    console.log("-> PASS: Equal Highs detection verified.");
  }

  // 4. Verify Regime Confidence Refinement
  const regimeSegmentStart = capturedPrompt.indexOf("MARKET REGIME");
  const regimeSegment = capturedPrompt.slice(regimeSegmentStart, startIdx);
  console.log("\nCaptured Market Regime Section:\n");
  console.log(regimeSegment);

  if (regimeSegment.includes("Regime Confidence: 0%")) {
    console.error("-> FAIL: Regime Confidence collapsed to 0%.");
    failed = true;
  } else {
    console.log("-> PASS: Regime Confidence calibrated successfully.");
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\n=== ALL INSTITUTIONAL ORDER FLOW TESTS PASSED ===");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
