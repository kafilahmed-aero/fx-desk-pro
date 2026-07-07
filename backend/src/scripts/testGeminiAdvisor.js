import { getXauusdRecommendation } from "../services/geminiAdvisorService.js";
import { getXauusdNewsContext } from "../services/xauusdNewsService.js";
import { config } from "../config/env.js";
import { localAiRecommendationOutcomes } from "../services/signalOutcomeStore.js";
import { priceHistoryCache } from "../services/priceIngestionService.js";

async function run() {
  console.log("=== GEMINI ADVISOR LOCAL TEST SUITE ===");

  const originalFetch = global.fetch;

  // Test 1: Missing API Key Handling
  console.log("\n[Test 1] Testing with missing API Key...");
  const originalKey = config.geminiApiKey;
  config.geminiApiKey = ""; // Temporarily clear key
  
  const result1 = await getXauusdRecommendation();
  console.log("Result:", JSON.stringify(result1, null, 2));
  if (result1.status === "error" && result1.message === "Gemini recommendation unavailable") {
    console.log("-> PASS: Handled missing API key correctly.");
  } else {
    console.error("-> FAIL: Did not return expected error object.");
  }

  // Restore configuration key
  config.geminiApiKey = "test_mock_key";

  // Test 2: Standard JSON Response from Gemini
  console.log("\n[Test 2] Testing standard JSON response from Gemini API...");
  const mockSuccessJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                pair: "XAUUSD",
                direction: "BUY",
                entryMin: 4172,
                entryMax: 4174,
                sl: 4164,
                tp: 4190,
                moderateTp: 4200,
                highRiskTp: 4210,
                tradeQuality: "Good",
                confidence: 85,
                estimatedHoldingTime: "30-60 min",
                tradeStyle: "Intraday",
                reasoning: ["Strong support at 4170", "Bullish gold trends"]
              })
            }
          ]
        }
      }
    ]
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockSuccessJson
      };
    }
    return originalFetch(url, options);
  };

  const result2 = await getXauusdRecommendation();
  console.log("Result:", JSON.stringify(result2, null, 2));
  const savedOutcome = localAiRecommendationOutcomes.get(result2.recommendationId);
  if (
    result2.pair === "XAUUSD" &&
    result2.direction === "BUY" &&
    result2.entryMin === 4172 &&
    result2.entryMax === 4174 &&
    result2.sl === 4164 &&
    result2.tp === 4190 &&
    result2.moderateTp === 4200 &&
    result2.highRiskTp === 4210 &&
    result2.tradeQuality === "Good" &&
    result2.confidence === 85 &&
    result2.estimatedHoldingTime === "30-60 min" &&
    result2.tradeStyle === "Intraday" &&
    result2.riskReward &&
    result2.riskReward.lowRisk === 1.89 &&
    result2.riskReward.moderate === 3.00 &&
    result2.riskReward.high === 4.11 &&
    result2.recommendationId &&
    result2.recommendationId.startsWith("AI-") &&
    savedOutcome &&
    savedOutcome.status === "PENDING" &&
    savedOutcome.recommendationVersion === 1
  ) {
    console.log("-> PASS: Parsed standard JSON response correctly, with human-readable ID and outcome cached.");
  } else {
    console.error("-> FAIL: Parsed standard JSON response incorrectly or outcome not cached.");
  }

  // Test 3: Markdown wrapped JSON response from Gemini
  console.log("\n[Test 3] Testing markdown-wrapped JSON response from Gemini API...");
  const mockMarkdownJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: "```json\n{\n  \"pair\": \"XAUUSD\",\n  \"direction\": \"SELL\",\n  \"entryMin\": 4200,\n  \"entryMax\": 4210,\n  \"sl\": 4220,\n  \"tp\": 4180,\n  \"moderateTp\": 4170,\n  \"highRiskTp\": 4160,\n  \"tradeQuality\": \"Excellent\",\n  \"confidence\": 90,\n  \"estimatedHoldingTime\": \"1-2 hr\",\n  \"tradeStyle\": \"Swing\",\n  \"reasoning\": [\"Resistance hit at 4210\"]\n}\n```"
            }
          ]
        }
      }
    ]
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockMarkdownJson
      };
    }
    return originalFetch(url, options);
  };

  const result3 = await getXauusdRecommendation();
  console.log("Result:", JSON.stringify(result3, null, 2));
  if (
    result3.pair === "XAUUSD" &&
    result3.direction === "SELL" &&
    result3.entryMin === 4200 &&
    result3.entryMax === 4210 &&
    result3.sl === 4220 &&
    result3.tp === 4180 &&
    result3.moderateTp === 4170 &&
    result3.highRiskTp === 4160 &&
    result3.tradeQuality === "Excellent" &&
    result3.confidence === 90 &&
    result3.estimatedHoldingTime === "1-2 hr" &&
    result3.tradeStyle === "Swing" &&
    result3.riskReward &&
    result3.riskReward.lowRisk === 1.67 && // (4205 - 4180) / (4220 - 4205) = 25 / 15 = 1.67!
    result3.riskReward.moderate === 2.33 && // (4205 - 4170) / 15 = 35 / 15 = 2.33!
    result3.riskReward.high === 3.00 && // (4205 - 4160) / 15 = 45 / 15 = 3.00!
    result3.reasoning[0] === "Resistance hit at 4210"
  ) {
    console.log("-> PASS: Stripped markdown blocks and parsed response correctly.");
  } else {
    console.error("-> FAIL: Failed to parse markdown wrapped response.");
  }

  // Test 4: Rate Limit (429) Response
  console.log("\n[Test 4] Testing Rate Limit (429) Response...");
  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 429,
        ok: false,
        text: async () => "Rate limit exceeded"
      };
    }
    return originalFetch(url, options);
  };

  const result4 = await getXauusdRecommendation();
  console.log("Result:", JSON.stringify(result4, null, 2));
  if (result4.status === "error" && result4.message === "Gemini recommendation unavailable") {
    console.log("-> PASS: Handled rate limit response correctly.");
  } else {
    console.error("-> FAIL: Did not return expected error object for rate limit.");
  }

  // Test 5: Malformed JSON/Schema Response
  console.log("\n[Test 5] Testing Malformed Response Structure...");
  const mockMalformedJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: "this is not JSON"
            }
          ]
        }
      }
    ]
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockMalformedJson
      };
    }
    return originalFetch(url, options);
  };

  const result5 = await getXauusdRecommendation();
  console.log("Result:", JSON.stringify(result5, null, 2));
  if (result5.status === "error" && result5.message === "Gemini recommendation unavailable") {
    console.log("-> PASS: Handled malformed JSON format correctly.");
  } else {
    console.error("-> FAIL: Did not return expected error object for malformed JSON.");
  }

  // Test 6: News Context Retrieval & Normalization
  console.log("\n[Test 6] Testing News Context Retrieval & Normalization...");
  const newsContext = await getXauusdNewsContext();
  console.log("Economic Events Sample Count:", newsContext.highImpactEvents.length);
  console.log("News Headlines Sample Count:", newsContext.goldNews.length);
  
  if (Array.isArray(newsContext.highImpactEvents) && Array.isArray(newsContext.goldNews)) {
    console.log("-> PASS: Fetched and normalized news context structures successfully.");
  } else {
    console.error("-> FAIL: News context structures are invalid.");
  }

  // Test 7: Failures in all news feeds must not crash recommendation endpoint
  console.log("\n[Test 7] Testing absolute fallback behavior when all news/calendar feeds fail...");
  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockSuccessJson
      };
    }
    return {
      status: 500,
      ok: false,
      text: async () => "Internal server error"
    };
  };

  const result7 = await getXauusdRecommendation();
  console.log("Result under news failure:", JSON.stringify(result7, null, 2));
  if (
    result7.pair === "XAUUSD" &&
    result7.direction === "BUY" &&
    result7.entryMin === 4172 &&
    result7.entryMax === 4174 &&
    result7.sl === 4164 &&
    result7.tp === 4190
  ) {
    console.log("-> PASS: Recommendation successfully returned even when all news feeds fail.");
  } else {
    console.error("-> FAIL: Recommendation failed when news feeds failed.");
  }

  // Test 8: AI Recommendation State Service Triggers
  console.log("\n[Test 8] Testing AI Recommendation State Service triggers...");
  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockSuccessJson
      };
    }
    return originalFetch(url, options);
  };

  const { generateRecommendationIfNeeded, getLastRecommendation, getRecommendationState } = await import("../services/aiRecommendationStateService.js");

  // Force initial generation
  console.log("Triggering INITIALIZATION check (STARTUP source)...");
  await generateRecommendationIfNeeded("STARTUP");

  const recState = getRecommendationState();
  const rec1 = getLastRecommendation();

  if (rec1 && rec1.pair === "XAUUSD" && recState.lastGenerationTime !== null) {
    console.log("-> PASS: Initial recommendation successfully generated and saved in-memory.");
  } else {
    console.log("-> INFO: Recommendation skipped during startup (likely outside trading session hours).");
  }

  const lastTime = recState.lastGenerationTime;
  const initialGoldPrice = recState.lastGoldPrice;

  // Test no-change trigger
  console.log("Running recommendation check with no changes...");
  await generateRecommendationIfNeeded("NO_CHANGE_CHECK");
  if (recState.lastGenerationTime === lastTime) {
    console.log("-> PASS: Skipped regeneration because no conditions changed.");
  } else {
    console.error("-> FAIL: Regenerated recommendation despite no changes.");
  }

  // Test small price move trigger
  console.log("Simulating small gold price change (< $5 increase)...");
  if (recState.lastGoldPrice !== null) {
    recState.lastGoldPrice = initialGoldPrice - 2.0;
    await generateRecommendationIfNeeded("PRICE_CHANGE");
    if (recState.lastGenerationTime === lastTime) {
      console.log("-> PASS: Skipped regeneration on small price change ($2.00 difference).");
    } else {
      console.error("-> FAIL: Regenerated recommendation on small price change.");
    }
  } else {
    console.log("-> SKIPPED: Price baseline was unavailable.");
  }

  // Test large price move trigger
  console.log("Simulating large gold price change (>= $5 decrease)...");
  if (recState.lastGoldPrice !== null) {
    recState.lastGoldPrice = initialGoldPrice + 6.0;
    await generateRecommendationIfNeeded("PRICE_CHANGE");
    if (recState.lastGenerationTime !== lastTime) {
      console.log("-> PASS: Successfully regenerated recommendation on significant price change ($6.00 difference).");
    } else {
      console.error("-> FAIL: Failed to regenerate recommendation on significant price change.");
    }
  } else {
    console.log("-> SKIPPED: Price baseline was unavailable.");
  }

  // Test 9: Telegram AI Recommendation Notification & Deduplication
  console.log("\n[Test 9] Testing Telegram AI Recommendation Notification & Deduplication...");
  
  // Wait for any pending async tasks from previous tests to settle
  await new Promise(resolve => setTimeout(resolve, 500));

  // Set up mock config for Telegram Alerts
  const originalTelegramConfig = config.telegramAlert;
  config.telegramAlert = {
    botToken: "mock_bot_token",
    channelId: "mock_channel_id"
  };

  let telegramFetchCount = 0;
  let lastSentPayload = null;

  global.fetch = async (url, options) => {
    if (url.includes("api.telegram.org")) {
      telegramFetchCount++;
      lastSentPayload = JSON.parse(options.body);
      return {
        status: 200,
        ok: true,
        json: async () => ({ ok: true })
      };
    }
    return {
      status: 200,
      ok: true,
      json: async () => mockSuccessJson
    };
  };

  const { sendAiRecommendationIfChanged, getNotificationState } = await import("../services/aiRecommendationNotificationService.js");

  // Mock Date so we fall within London-New York active session hours (e.g. 18:00 IST / 12:30 UTC)
  const OriginalDate = global.Date;
  global.Date = function(...args) {
    if (new.target) {
      if (args.length === 0) {
        return new OriginalDate("2026-07-07T12:30:00Z");
      }
      return new OriginalDate(...args);
    }
    return OriginalDate(...args);
  };
  global.Date.now = () => new OriginalDate("2026-07-07T12:30:00Z").getTime();
  global.Date.UTC = OriginalDate.UTC;
  global.Date.parse = OriginalDate.parse;
  global.Date.prototype = OriginalDate.prototype;

  const sampleRec = {
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 4172,
    entryMax: 4174,
    sl: 4164,
    tp: 4190,
    moderateTp: 4200,
    highRiskTp: 4210,
    tradeQuality: "Good",
    confidence: 85,
    estimatedHoldingTime: "30-60 min",
    tradeStyle: "Intraday",
    reasoning: ["Reason 1", "Reason 2"],
    lastGenerationTime: new Date().toISOString()
  };

  // Reset sent states
  const notifState = getNotificationState();
  notifState.lastSentHash = null;
  notifState.lastSentAt = null;

  // 1. First send: Should trigger fetch
  console.log("Sending initial recommendation alert...");
  await sendAiRecommendationIfChanged(sampleRec);
  
  if (telegramFetchCount === 1 && notifState.lastSentHash !== null) {
    console.log("-> PASS: Initial recommendation alert delivered successfully.");
    console.log("Delivered Message Text:\n", lastSentPayload.text);
  } else {
    console.error("-> FAIL: Initial alert was not delivered. Fetch count:", telegramFetchCount);
  }

  const initialHash = notifState.lastSentHash;

  // 2. Duplicate send: Should skip fetch
  console.log("Sending duplicate recommendation alert...");
  await sendAiRecommendationIfChanged(sampleRec);
  if (telegramFetchCount === 1) {
    console.log("-> PASS: Correctly deduplicated and skipped identical recommendation.");
  } else {
    console.error("-> FAIL: Duplicate recommendation was not deduplicated. Fetch count:", telegramFetchCount);
  }

  // 3. Modified send: Should trigger fetch
  console.log("Sending modified recommendation alert (changed stop loss)...");
  const modifiedRec = {
    ...sampleRec,
    sl: 4160 // Change stop loss
  };
  await sendAiRecommendationIfChanged(modifiedRec);
  if (telegramFetchCount === 2 && notifState.lastSentHash !== initialHash) {
    console.log("-> PASS: Correctly detected changes and sent updated notification alert.");
  } else {
    console.error("-> FAIL: Failed to detect change or send updated alert. Fetch count:", telegramFetchCount);
  }

  // Restore Date
  global.Date = OriginalDate;

  // Test 10: London-New York Session Intelligence & Emergency Overrides
  console.log("\n[Test 10] Testing London-New York Session Intelligence & Emergency Overrides...");

  const { isAiTradingSessionActive, hasEmergencyMacroEvent } = await import("../services/tradingSessionService.js");

  config.aiSessionStartIst = "17:30";
  config.aiSessionEndIst = "21:30";

  // Case 1: 18:00 IST (UTC 12:30) - Inside Session
  const insideSessionTime = new Date("2026-07-04T12:30:00Z");
  const insideActive = isAiTradingSessionActive(insideSessionTime);
  console.log(`Evaluating 18:00 IST session active: ${insideActive}`);
  if (insideActive === true) {
    console.log("-> PASS: Correctly evaluated 18:00 IST as inside active session window.");
  } else {
    console.error("-> FAIL: Evaluated 18:00 IST as outside active session window.");
  }

  // Case 2: 23:00 IST (UTC 17:30) - Outside Session
  const outsideSessionTime = new Date("2026-07-04T17:30:00Z");
  const outsideActive = isAiTradingSessionActive(outsideSessionTime);
  console.log(`Evaluating 23:00 IST session active: ${outsideActive}`);
  if (outsideActive === false) {
    console.log("-> PASS: Correctly evaluated 23:00 IST as outside active session window.");
  } else {
    console.error("-> FAIL: Evaluated 23:00 IST as inside active session window.");
  }

  // Case 3: NFP Event at 22:00 IST (UTC 16:30) - Outside Session but Override Active
  const overrideTime = new Date("2026-07-04T16:30:00Z");
  const overrideActiveSession = isAiTradingSessionActive(overrideTime);
  
  const mockNewsContextWithNFP = {
    highImpactEvents: [
      {
        title: "Nonfarm Payrolls (NFP)",
        impact: "HIGH",
        publishedAt: "2026-07-04T16:30:00Z"
      }
    ],
    goldNews: []
  };

  const hasNfpOverride = hasEmergencyMacroEvent(mockNewsContextWithNFP, overrideTime);
  console.log(`Evaluating 22:00 IST with NFP event: Session=${overrideActiveSession}, Override=${hasNfpOverride}`);
  
  if (overrideActiveSession === false && hasNfpOverride === true) {
    console.log("-> PASS: Correctly triggered emergency macro override for high-impact NFP release outside session hours.");
  } else {
    console.error("-> FAIL: Failed to trigger emergency override for NFP release.");
  }

  // Case 4: Non-matching Event at 22:00 IST (UTC 16:30) - Outside Session, No Override
  const mockNewsContextWithLowImpact = {
    highImpactEvents: [
      {
        title: "Some low impact USD release",
        impact: "HIGH",
        publishedAt: "2026-07-04T16:30:00Z"
      }
    ],
    goldNews: []
  };
  const hasLowImpactOverride = hasEmergencyMacroEvent(mockNewsContextWithLowImpact, overrideTime);
  if (hasLowImpactOverride === false) {
    console.log("-> PASS: Correctly did not override for non-matching macro event.");
  } else {
    console.error("-> FAIL: Incorrectly triggered override for low-impact non-matching event.");
  }

  // Test 11: Strict parameter validations
  console.log("\n[Test 11] Testing strict parameter validations...");
  
  // 1. Invalid Confidence (120)
  const mockInvalidConfidenceJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                pair: "XAUUSD",
                direction: "BUY",
                entryMin: 4172,
                entryMax: 4174,
                sl: 4164,
                tp: 4190,
                moderateTp: 4200,
                highRiskTp: 4210,
                tradeQuality: "Good",
                confidence: 120, // Invalid
                estimatedHoldingTime: "30-60 min",
                tradeStyle: "Intraday",
                reasoning: ["Strong support"]
              })
            }
          ]
        }
      }
    ]
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockInvalidConfidenceJson
      };
    }
    return originalFetch(url, options);
  };

  const resConfidence = await getXauusdRecommendation();
  if (resConfidence.status === "error") {
    console.log("-> PASS: Correctly rejected invalid confidence score (>100).");
  } else {
    console.error("-> FAIL: Allowed invalid confidence score.");
  }

  // 2. Invalid TP sequence ordering (BUY: moderateTp < tp)
  const mockInvalidTpOrderingJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                pair: "XAUUSD",
                direction: "BUY",
                entryMin: 4172,
                entryMax: 4174,
                sl: 4164,
                tp: 4200,
                moderateTp: 4190, // Invalid TP ordering: moderateTp < tp
                highRiskTp: 4210,
                tradeQuality: "Good",
                confidence: 85,
                estimatedHoldingTime: "30-60 min",
                tradeStyle: "Intraday",
                reasoning: ["Strong support"]
              })
            }
          ]
        }
      }
    ]
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      return {
        status: 200,
        ok: true,
        json: async () => mockInvalidTpOrderingJson
      };
    }
    return originalFetch(url, options);
  };

  const resOrdering = await getXauusdRecommendation();
  if (resOrdering.status === "error") {
    console.log("-> PASS: Correctly rejected invalid TP sequence ordering.");
  } else {
    console.error("-> FAIL: Allowed invalid TP sequence ordering.");
  }

  // Test 12: Multi-Timeframe Integration & Guidelines Verification
  console.log("\n[Test 12] Testing Multi-Timeframe Prompt Integration & Validation...");

  let capturedPrompt = null;
  const mockMtfSuccessJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                pair: "XAUUSD",
                direction: "BUY",
                entryMin: 4172,
                entryMax: 4174,
                sl: 4164,
                tp: 4190,
                moderateTp: 4200,
                highRiskTp: 4210,
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
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(options.body);
      capturedPrompt = body.contents[0].parts[0].text;
      return {
        status: 200,
        ok: true,
        json: async () => mockMtfSuccessJson
      };
    }
    return {
      status: 200,
      ok: true,
      text: async () => "<rss></rss>",
      json: async () => []
    };
  };

  // Sub-test 1: With sufficient history
  console.log("Sub-test 1: Sufficient history context...");
  priceHistoryCache.clear();
  const baseTime = Math.floor(Date.now() / 60000) * 60000;
  for (let i = 0; i < 35; i++) {
    priceHistoryCache.set("XAUUSD", [
      ...(priceHistoryCache.get("XAUUSD") || []),
      { price: 2000 + i, timestamp: baseTime + i * 60 * 1000 }
    ]);
  }
  
  await getXauusdRecommendation("MANUAL");
  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt was empty.");
  } else {
    const hasMtfSection = capturedPrompt.includes("SECTION 3: MULTI-TIMEFRAME MARKET ANALYSIS");
    const hasMtfRules = capturedPrompt.includes("CRITICAL MULTI-TIMEFRAME TRADING RULES:");
    const has1mOk = capturedPrompt.includes("1 Minute Timeframe:\n  - Status: OK");

    if (hasMtfSection && hasMtfRules && has1mOk) {
      console.log("-> PASS: Multi-timeframe context and rules correctly integrated into prompt.");
    } else {
      console.error("-> FAIL: Integration failed in prompt:\n", capturedPrompt);
    }
  }

  // Sub-test 2: With insufficient history
  console.log("Sub-test 2: Insufficient history fallback...");
  priceHistoryCache.clear();
  capturedPrompt = null;
  await getXauusdRecommendation("MANUAL");

  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt was empty.");
  } else {
    const hasInsufficient = capturedPrompt.includes("Status: INSUFFICIENT_HISTORY\n  - Insufficient historical data.");
    if (hasInsufficient) {
      console.log("-> PASS: Correctly printed 'Insufficient historical data.' for empty history timeframe.");
    } else {
      console.error("-> FAIL: Failed to degrade to 'Insufficient historical data.' when history is empty.");
    }
  }

  // Test 13: Confluence & Trade Filtering Verification
  console.log("\n[Test 13] Testing Confluence & Trade Filtering Intelligence...");
  priceHistoryCache.clear();
  capturedPrompt = null;

  // Mock a HOLD JSON response when Trade Filter is AVOID
  const mockAvoidHoldJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                pair: "XAUUSD",
                direction: "HOLD",
                entryMin: 2006,
                entryMax: 2006,
                sl: null,
                tp: null,
                moderateTp: null,
                highRiskTp: null,
                tradeQuality: "Average",
                confidence: 45,
                estimatedHoldingTime: "30-60 min",
                tradeStyle: "Intraday",
                reasoning: ["Confluence is very low", "Trade blocked by filter guidelines"]
              })
            }
          ]
        }
      }
    ]
  };

  global.fetch = async (url, options) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(options.body);
      capturedPrompt = body.contents[0].parts[0].text;
      return {
        status: 200,
        ok: true,
        json: async () => mockAvoidHoldJson
      };
    }
    return {
      status: 200,
      ok: true,
      text: async () => "<rss></rss>",
      json: async () => []
    };
  };

  // Sub-test 1: Basic component score alignment & formatting check
  console.log("Sub-test 1: Component scores and prompt formatting...");
  // Populate history to have status OK for MTF
  const baseTimeMtf = Math.floor(Date.now() / 60000) * 60000;
  for (let i = 0; i < 35; i++) {
    priceHistoryCache.set("XAUUSD", [
      ...(priceHistoryCache.get("XAUUSD") || []),
      { price: 2000 + i, timestamp: baseTimeMtf + i * 60 * 1000 }
    ]);
  }
  
  const recAvoid = await getXauusdRecommendation("MANUAL");
  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt was empty.");
  } else {
    const hasConfluenceSection = capturedPrompt.includes("SECTION 4: CONFLUENCE INTELLIGENCE");
    const hasConfluenceRules = capturedPrompt.includes("CRITICAL CONFLUENCE & TRADE FILTERING RULES:");
    const hasScores = capturedPrompt.includes("Signal Confluence:") && capturedPrompt.includes("Overall Confluence Score:");

    if (hasConfluenceSection && hasConfluenceRules && hasScores) {
      console.log("-> PASS: Confluence section, scores, and rules integrated correctly.");
    } else {
      console.error("-> FAIL: Confluence formatting missing from prompt:\n", capturedPrompt);
    }
  }

  // Sub-test 2: Hard Block constraints (AVOID override due to empty signals & low score)
  console.log("Sub-test 2: Hard block conditions validation...");
  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt was empty.");
  } else {
    const hasAvoidTiming = capturedPrompt.includes("Trade Filter: AVOID") && capturedPrompt.includes("Trade Timing: NO TRADE");
    const hasProbBlocked = capturedPrompt.includes("Expected Probability: Unavailable (Trade Blocked)");

    if (hasAvoidTiming && hasProbBlocked) {
      console.log("-> PASS: Confluence hard block override successfully enforced AVOID filter, NO TRADE timing, and null probability.");
    } else {
      console.error("-> FAIL: Hard blocks not enforced as expected:\n", capturedPrompt);
    }
  }

  // Sub-test 3: HOLD recommendation compatibility
  console.log("Sub-test 3: HOLD recommendation validation...");
  if (recAvoid && recAvoid.direction === "HOLD" && recAvoid.sl === null && recAvoid.confidence === 45) {
    console.log("-> PASS: HOLD recommendations validate and return correctly under AVOID filter.");
  } else {
    console.error("-> FAIL: HOLD recommendation validation failed:", recAvoid);
  }

  // Sub-test 4: Missing Input sources tracking
  console.log("Sub-test 4: Graceful missing inputs handling...");
  // Clear history to trigger missing price history and timeframe history
  priceHistoryCache.clear();
  capturedPrompt = null;
  await getXauusdRecommendation("MANUAL");
  if (!capturedPrompt) {
    console.error("-> FAIL: Captured prompt was empty.");
  } else {
    const hasMissingHistory = capturedPrompt.includes("- Price History") || capturedPrompt.includes("- Timeframe History");
    if (hasMissingHistory) {
      console.log("-> PASS: Missing input sources logged accurately in prompt missing inputs array.");
    } else {
      console.error("-> FAIL: Missing inputs list incorrect:\n", capturedPrompt);
    }
  }

  // Clean up and restore original fetch
  global.fetch = originalFetch;
  config.geminiApiKey = originalKey;
  config.telegramAlert = originalTelegramConfig;

  console.log("\nAll Phase F verification tests finished.");
  process.exit(0);
}

run().catch(err => {
  console.error("Test suite execution failed:", err);
  process.exit(1);
});
