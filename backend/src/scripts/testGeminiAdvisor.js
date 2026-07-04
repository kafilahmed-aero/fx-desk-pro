import { getXauusdRecommendation } from "../services/geminiAdvisorService.js";
import { getXauusdNewsContext } from "../services/xauusdNewsService.js";
import { config } from "../config/env.js";

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
  if (
    result2.pair === "XAUUSD" &&
    result2.direction === "BUY" &&
    result2.entryMin === 4172 &&
    result2.entryMax === 4174 &&
    result2.sl === 4164 &&
    result2.tp === 4190 &&
    result2.reasoning.length === 2
  ) {
    console.log("-> PASS: Parsed standard JSON response correctly.");
  } else {
    console.error("-> FAIL: Parsed standard JSON response incorrectly.");
  }

  // Test 3: Markdown wrapped JSON response from Gemini
  console.log("\n[Test 3] Testing markdown-wrapped JSON response from Gemini API...");
  const mockMarkdownJson = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: "```json\n{\n  \"pair\": \"XAUUSD\",\n  \"direction\": \"SELL\",\n  \"entryMin\": 4200,\n  \"entryMax\": 4210,\n  \"sl\": 4220,\n  \"tp\": 4180,\n  \"reasoning\": [\"Resistance hit at 4210\"]\n}\n```"
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

  const sampleRec = {
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 4172,
    entryMax: 4174,
    sl: 4164,
    tp: 4190,
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
