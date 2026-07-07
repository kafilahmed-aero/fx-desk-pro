import mongoose from "mongoose";
import * as geminiAdvisor from "../services/geminiAdvisorService.js";
import { priceHistoryCache, updatePriceCacheAndHistory } from "../services/priceIngestionService.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { MarketPrice } from "../models/marketPriceModel.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { config } from "../config/env.js";

async function run() {
  console.log("=== RUNNING ADVANCED MARKET CONTEXT UNIT TESTS ===");

  // Set mock API key
  config.geminiApiKey = "mock-api-key";

  // Stub readyState to be 1 so getActiveXauusdSignals queries ParsedSignal model
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => 1,
    configurable: true
  });

  // Stub ParsedSignal.find to return our mock signals
  let mockActiveSignals = [];
  ParsedSignal.find = () => {
    return {
      lean: async () => mockActiveSignals
    };
  };

  // Stub MarketPrice.findById to return null immediately to avoid connection buffering timeouts
  MarketPrice.findById = () => {
    return {
      lean: async () => null
    };
  };

  // Stub Mongoose Model prototype save to avoid buffering timeouts
  mongoose.Model.prototype.save = async function() {
    return this;
  };

  // Stub Mongoose Model create returning mock object with toObject method
  AiRecommendationOutcome.create = async (doc) => {
    return {
      ...doc,
      toObject: () => doc
    };
  };

  // Stub AiRecommendationOutcome query methods to return chainable stubs immediately
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
        };
      },
      lean: async () => []
    };
  };

  // Intercept global fetch to capture the Gemini prompt
  let capturedPrompt = null;
  const originalFetch = global.fetch;
  
  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(options.body);
      capturedPrompt = body.contents[0].parts[0].text;
      
      // Return a mock valid response
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      pair: "XAUUSD",
                      direction: "BUY",
                      entryMin: 2000,
                      entryMax: 2002,
                      sl: 1990,
                      tp: 2010,
                      moderateTp: 2020,
                      highRiskTp: 2030,
                      tradeQuality: "Good",
                      confidence: 85,
                      estimatedHoldingTime: "30-60 min",
                      tradeStyle: "Intraday",
                      reasoning: ["Consensus BUY"]
                    })
                  }
                ]
              }
            }
          ]
        })
      };
    }
    
    // Return empty responses for calendar/news endpoints
    if (url.includes("ffcal") || url.includes("headline") || url.includes("rss")) {
      return {
        ok: true,
        status: 200,
        text: async () => "<rss></rss>",
        json: async () => []
      };
    }
    
    return { ok: false, status: 404 };
  };

  // Run Test 1: Empty history check
  console.log("\n[Test 1] Testing degradation with empty price history buffer...");
  mockActiveSignals = [];
  priceHistoryCache.clear();

  // Populate only the current price cache (no history)
  updatePriceCacheAndHistory("XAUUSD", {
    price: 2006,
    bid: 2005.8,
    ask: 2006.1,
    lastUpdated: new Date(),
    source: "YAHOO"
  });
  // Clear the history recorded by updatePriceCacheAndHistory
  priceHistoryCache.clear();

  const rec1 = await geminiAdvisor.getXauusdRecommendation("MANUAL");
  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt is empty.");
    process.exit(1);
  }

  // Verify prompt contains SECTION 7 with default/fallback values
  const hasSection7 = capturedPrompt.includes("SECTION 7: ADVANCED MARKET CONTEXT");
  const hasSpreadAvailable = capturedPrompt.includes("- Current Spread: 0.3"); // spread is available from cache
  const hasAtrUnavailable = capturedPrompt.includes("- ATR (Average True Range): Unavailable");
  const hasSupportUnavailable = capturedPrompt.includes("- Nearest Support Level: Unavailable");
  
  if (hasSection7 && hasSpreadAvailable && hasAtrUnavailable && hasSupportUnavailable) {
    console.log("-> PASS: Fallback degradation values successfully written to prompt under empty history.");
  } else {
    console.error("-> FAIL: Prompt fallbacks not correct:\n", capturedPrompt);
    process.exit(1);
  }

  // Test Case 2: Structured history calculation checks
  console.log("\n[Test 2] Testing calculations with populated price history...");
  capturedPrompt = null;

  // Populate mock price history cache (spans 5 elements)
  const now = Date.now();
  priceHistoryCache.set("XAUUSD", [
    { price: 2000, timestamp: now - 5 * 60 * 1000 },
    { price: 2008, timestamp: now - 4 * 60 * 1000 },
    { price: 2004, timestamp: now - 3 * 60 * 1000 },
    { price: 2012, timestamp: now - 2 * 60 * 1000 },
    { price: 2006, timestamp: now - 1 * 60 * 1000 }
  ]);

  // Mock active signals: two signals to form a primary entry cluster near 2002
  mockActiveSignals = [
    {
      _id: "6a4c645146bbc7e674eff432",
      pair: "XAUUSD",
      action: "BUY",
      entry: 2001.9,
      stopLoss: 1995,
      targets: [{ target: 2015 }],
      signalState: "ACTIVE",
      timestamp: new Date()
    },
    {
      _id: "6a4c645146bbc7e674eff433",
      pair: "XAUUSD",
      action: "BUY",
      entry: 2002.1,
      stopLoss: 1995,
      targets: [{ target: 2015 }],
      signalState: "ACTIVE",
      timestamp: new Date()
    }
  ];

  // Set price cache by calling updatePriceCacheAndHistory and stripping the appended entry
  updatePriceCacheAndHistory("XAUUSD", {
    price: 2006,
    bid: 2005.8,
    ask: 2006.1,
    lastUpdated: new Date(),
    source: "YAHOO"
  });
  const hist = priceHistoryCache.get("XAUUSD");
  if (hist && hist.length > 0) {
    hist.pop();
  }

  const rec2 = await geminiAdvisor.getXauusdRecommendation("MANUAL");
  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt is empty.");
    process.exit(1);
  }

  console.log("Captured SECTION 7 segment from prompt:\n");
  const sec7Index = capturedPrompt.indexOf("SECTION 7: ADVANCED MARKET CONTEXT");
  const sec8Index = capturedPrompt.indexOf("SECTION 8: MACROECONOMIC HIGH-IMPACT EVENTS & MARKET NEWS");
  const sec7Text = capturedPrompt.slice(sec7Index, sec8Index);
  console.log(sec7Text);

  let failed = false;
  // Nearest Support should detect cluster boundary (2002.1)
  if (!sec7Text.includes("- Nearest Support Level: 2002.1")) {
    console.error("-> FAIL: support level is not 2002.1");
    failed = true;
  }
  if (!sec7Text.includes("- Nearest Resistance Level: 2012")) {
    console.error("-> FAIL: resistance level is not 2012");
    failed = true;
  }
  if (!sec7Text.includes("- 24-hour High: 2012")) {
    console.error("-> FAIL: 24h High is not 2012");
    failed = true;
  }
  if (!sec7Text.includes("- 24-hour Low: 2000")) {
    console.error("-> FAIL: 24h Low is not 2000");
    failed = true;
  }
  if (!sec7Text.includes("- Current Daily Range: 12")) {
    console.error("-> FAIL: Daily Range is not 12");
    failed = true;
  }
  if (!sec7Text.includes("- Distance to Daily High: 6")) {
    console.error("-> FAIL: Distance to High is not 6");
    failed = true;
  }
  if (!sec7Text.includes("- Distance to Daily Low: 6")) {
    console.error("-> FAIL: Distance to Low is not 6");
    failed = true;
  }
  if (!sec7Text.includes("- ATR (Average True Range): 6.5")) {
    console.error("-> FAIL: ATR is not 6.5");
    failed = true;
  }
  if (!sec7Text.includes("- Current Spread: 0.3")) {
    console.error("-> FAIL: Spread is not 0.3");
    failed = true;
  }
  if (!sec7Text.includes("- Distance to Entry Zone: 3.9 USD") && !sec7Text.includes("- Distance to Entry Zone: 4 USD")) {
    console.error("-> FAIL: Distance to Entry Zone is not ~4 USD");
    failed = true;
  }

  // Restore global state
  global.fetch = originalFetch;

  if (failed) {
    console.error("=== ADVANCED MARKET CONTEXT TESTS FAILED ===");
    process.exit(1);
  } else {
    console.log("-> PASS: All market context calculations match expected analytical outcomes!");
    console.log("=== ADVANCED MARKET CONTEXT TESTS PASSED ===");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
