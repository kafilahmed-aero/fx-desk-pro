import mongoose from "mongoose";
import * as geminiAdvisor from "../services/geminiAdvisorService.js";
import { priceHistoryCache, updatePriceCacheAndHistory, resetPriceCache } from "../services/priceIngestionService.js";
import { buildCandles } from "../services/multiTimeframeIntelligenceService.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { MarketPrice } from "../models/marketPriceModel.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { config } from "../config/env.js";

function generateTicksForAsset(baseTime, intervalMin, points) {
  const ticks = [];
  points.forEach((p, k) => {
    const startTime = baseTime + k * intervalMin * 60000;
    ticks.push({ price: p, timestamp: startTime });
    ticks.push({ price: p * 1.001, timestamp: startTime + 5 * 60000 });
    ticks.push({ price: p * 0.999, timestamp: startTime + 10 * 60000 });
    ticks.push({ price: p, timestamp: startTime + 14 * 60000 });
  });
  return ticks;
}

async function run() {
  console.log("=== RUNNING MULTI-ASSET MACRO INTELLIGENCE TESTS ===");

  config.geminiApiKey = "mock-api-key";

  // Stub readyState to be 1 so getActiveXauusdSignals queries ParsedSignal model
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true
  });

  ParsedSignal.find = () => ({ lean: async () => [] });
  MarketPrice.findById = () => ({ lean: async () => null });
  mongoose.Model.prototype.save = async function() { return this; };

  // Stub AiRecommendationOutcome query methods directly
  const mockQuery = {
    sort: () => mockQuery,
    lean: async () => null
  };
  AiRecommendationOutcome.findOne = () => mockQuery;
  AiRecommendationOutcome.findOneAndUpdate = () => mockQuery;
  AiRecommendationOutcome.find = () => {
    return {
      sort: () => {
        return {
          lean: async () => []
        }
      },
      lean: async () => []
    };
  };

  // Stub AiRecommendationOutcome.create
  AiRecommendationOutcome.create = async (doc) => {
    return {
      ...doc,
      toObject: () => doc
    };
  };

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
            reasoning: ["Hold"]
          }) }] } }]
        })
      };
    }
    return { ok: true, status: 200, text: async () => "<rss></rss>", json: async () => [] };
  };

  const baseTime = Math.floor(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000) - 20 * 15 * 60 * 1000;

  // Clear previous cache
  priceHistoryCache.clear();

  // Generate price points representing positive alignment
  // Gold climbs: 2000 to 2020
  const goldPoints = [2000, 2002, 2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020];
  // DXY falls: 104 to 102 (negative correlation, bullish influence on Gold)
  const dxyPoints = [104.0, 103.8, 103.6, 103.4, 103.2, 103.0, 102.8, 102.6, 102.4, 102.2, 102.0];
  // US10Y falls: 4.2 to 4.0 (negative correlation, bullish influence on Gold)
  const us10yPoints = [4.2, 4.18, 4.16, 4.14, 4.12, 4.10, 4.08, 4.06, 4.04, 4.02, 4.0];
  // Silver climbs: 28 to 30 (positive correlation, bullish influence on Gold)
  const silverPoints = [28.0, 28.2, 28.4, 28.6, 28.8, 29.0, 29.2, 29.4, 29.6, 29.8, 30.0];
  // EURUSD climbs: 1.08 to 1.09 (positive correlation, bullish influence)
  const eurPoints = [1.08, 1.081, 1.082, 1.083, 1.084, 1.085, 1.086, 1.087, 1.088, 1.089, 1.09];
  // USDJPY falls: 155 to 153 (negative correlation, bullish influence)
  const jpyPoints = [155.0, 154.8, 154.6, 154.4, 154.2, 154.0, 153.8, 153.6, 153.4, 153.2, 153.0];
  // S&P 500 flat/sideways (Neutral influence)
  const spxPoints = [5200, 5200, 5200, 5200, 5200, 5200, 5200, 5200, 5200, 5200, 5200];
  // VIX flat/sideways
  const vixPoints = [14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 14.0, 14.0];
  // BTCUSD flat/sideways
  const btcPoints = [65000, 65000, 65000, 65000, 65000, 65000, 65000, 65000, 65000, 65000, 65000];

  priceHistoryCache.set("XAUUSD", generateTicksForAsset(baseTime, 15, goldPoints));
  priceHistoryCache.set("DXY", generateTicksForAsset(baseTime, 15, dxyPoints));
  priceHistoryCache.set("US10Y", generateTicksForAsset(baseTime, 15, us10yPoints));
  priceHistoryCache.set("XAGUSD", generateTicksForAsset(baseTime, 15, silverPoints));
  priceHistoryCache.set("EURUSD", generateTicksForAsset(baseTime, 15, eurPoints));
  priceHistoryCache.set("USDJPY", generateTicksForAsset(baseTime, 15, jpyPoints));
  priceHistoryCache.set("SPX500", generateTicksForAsset(baseTime, 15, spxPoints));
  priceHistoryCache.set("^VIX", generateTicksForAsset(baseTime, 15, vixPoints));
  priceHistoryCache.set("BTCUSD", generateTicksForAsset(baseTime, 15, btcPoints));

  // Update current prices
  updatePriceCacheAndHistory("XAUUSD", { price: 2020, bid: 2019.8, ask: 2020.2, lastUpdated: new Date() });
  updatePriceCacheAndHistory("DXY", { price: 102.0, bid: 101.9, ask: 102.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("US10Y", { price: 4.0, bid: 3.99, ask: 4.01, lastUpdated: new Date() });
  updatePriceCacheAndHistory("XAGUSD", { price: 30.0, bid: 29.9, ask: 30.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("EURUSD", { price: 1.09, bid: 1.089, ask: 1.091, lastUpdated: new Date() });
  updatePriceCacheAndHistory("USDJPY", { price: 153.0, bid: 152.9, ask: 153.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("SPX500", { price: 5200, bid: 5199, ask: 5201, lastUpdated: new Date() });
  updatePriceCacheAndHistory("^VIX", { price: 14.0, bid: 13.9, ask: 14.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("BTCUSD", { price: 65000, bid: 64999, ask: 65001, lastUpdated: new Date() });

  // Test Case 1: Aligned Bullish Macro
  console.log("\n[Test 1] Testing Aligned Bullish Macro Alignment...");
  const candlesGold = buildCandles(priceHistoryCache.get("XAUUSD"), 15);
  const candlesDxy = buildCandles(priceHistoryCache.get("DXY"), 15);
  console.log("candlesGold close prices:", candlesGold.map(c => ({ timestamp: c.timestamp, close: c.close })));
  console.log("candlesDxy close prices:", candlesDxy.map(c => ({ timestamp: c.timestamp, close: c.close })));

  await geminiAdvisor.getXauusdRecommendation("MANUAL");

  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt is empty.");
    process.exit(1);
  }

  const startIdx = capturedPrompt.indexOf("MULTI-ASSET MACRO INTELLIGENCE");
  const endIdx = capturedPrompt.indexOf("SECTION 8");
  const segment = capturedPrompt.slice(startIdx, endIdx);
  console.log("Captured Macro Intelligence Block:\n");
  console.log(segment);

  let failed = false;

  if (!segment.includes("Gold Macro Bias: Bullish")) {
    console.error("-> FAIL: Gold macro bias is not Bullish");
    failed = true;
  } else {
    console.log("-> PASS: Aligned Bullish Bias correctly detected.");
  }

  if (segment.includes("Perfect Bullish Alignment") || segment.includes("Strong Bullish Alignment")) {
    console.log("-> PASS: Macro Alignment Score contains positive alignment rating.");
  } else {
    console.error("-> FAIL: Macro Alignment Score rating missing.");
    failed = true;
  }

  if (!segment.includes("Macro Conflict Level: Low")) {
    console.error("-> FAIL: Expected Low Conflict Level");
    failed = true;
  } else {
    console.log("-> PASS: Low Conflict Level verified.");
  }

  // Test Case 2: opposing Tier 1 Drivers (High Conflict)
  console.log("\n[Test 2] Testing opposing Tier 1 Drivers (High Conflict)...");
  capturedPrompt = null;

  // DXY falls: correlation with Gold is negative, direction is DOWN => influence is Bullish
  const opposingDxyPoints = [104.0, 103.8, 103.6, 103.4, 103.2, 103.0, 102.8, 102.6, 102.4, 102.2, 102.0];
  priceHistoryCache.set("DXY", generateTicksForAsset(baseTime, 15, opposingDxyPoints));
  updatePriceCacheAndHistory("DXY", { price: 102.0, bid: 101.9, ask: 102.1, lastUpdated: new Date() });

  // US10Y is mostly falling (negative correlation) but has a positive final change (first 4.5, last 4.6 => direction is UP)
  // Therefore, r < -0.3 and direction is UP => influence is Bearish
  const opposingUs10yPoints = [4.5, 4.2, 3.9, 3.6, 3.3, 3.0, 2.7, 2.4, 2.1, 1.8, 4.6];
  priceHistoryCache.set("US10Y", generateTicksForAsset(baseTime, 15, opposingUs10yPoints));
  updatePriceCacheAndHistory("US10Y", { price: 4.6, bid: 4.59, ask: 4.61, lastUpdated: new Date() });

  await geminiAdvisor.getXauusdRecommendation("MANUAL");
  const opposingSegment = capturedPrompt.slice(capturedPrompt.indexOf("MULTI-ASSET MACRO INTELLIGENCE"), capturedPrompt.indexOf("SECTION 8"));
  console.log("Captured Opposing Macro Block:\n");
  console.log(opposingSegment);

  if (opposingSegment.includes("Macro Conflict Level: High") || opposingSegment.includes("Macro Conflict Level: Moderate")) {
    console.log("-> PASS: Opposing Tier 1 drivers triggered High/Moderate Conflict Level.");
  } else {
    console.error("-> FAIL: Opposing drivers did not trigger conflict.");
    failed = true;
  }

  // Test Case 3: Graceful Degradation (DXY unavailable)
  console.log("\n[Test 3] Testing Graceful Degradation when DXY is unavailable...");
  capturedPrompt = null;
  
  priceHistoryCache.delete("DXY");
  resetPriceCache();

  // Re-populate everything except DXY
  updatePriceCacheAndHistory("XAUUSD", { price: 2020, bid: 2019.8, ask: 2020.2, lastUpdated: new Date() });
  updatePriceCacheAndHistory("US10Y", { price: 4.0, bid: 3.99, ask: 4.01, lastUpdated: new Date() });
  updatePriceCacheAndHistory("XAGUSD", { price: 30.0, bid: 29.9, ask: 30.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("EURUSD", { price: 1.09, bid: 1.089, ask: 1.091, lastUpdated: new Date() });
  updatePriceCacheAndHistory("USDJPY", { price: 153.0, bid: 152.9, ask: 153.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("SPX500", { price: 5200, bid: 5199, ask: 5201, lastUpdated: new Date() });
  updatePriceCacheAndHistory("^VIX", { price: 14.0, bid: 13.9, ask: 14.1, lastUpdated: new Date() });
  updatePriceCacheAndHistory("BTCUSD", { price: 65000, bid: 64999, ask: 65001, lastUpdated: new Date() });
  
  await geminiAdvisor.getXauusdRecommendation("MANUAL");
  const degradationSegment = capturedPrompt.slice(capturedPrompt.indexOf("MULTI-ASSET MACRO INTELLIGENCE"), capturedPrompt.indexOf("SECTION 8"));
  console.log("Captured Degradation Block:\n");
  console.log(degradationSegment);

  if (degradationSegment.includes("DXY (Unavailable)")) {
    console.log("-> PASS: DXY correctly marked as Unavailable without breaking the pipeline.");
  } else {
    console.error("-> FAIL: DXY was not gracefully degraded to Unavailable.");
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\n=== ALL MULTI-ASSET MACRO INTELLIGENCE TESTS PASSED ===");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
