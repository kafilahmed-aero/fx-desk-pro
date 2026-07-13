import { aiProviderRegistry } from "../services/aiProviderRegistry.js";
import { BaseAiProvider } from "../services/aiProvider.js";
import { GeminiProvider } from "../services/geminiProvider.js";
import { MockProvider } from "../services/mockProvider.js";
import { callGeminiWithFallback, getModelManagerDiagnostics, deepFreeze } from "../services/aiModelManager.js";
import { config } from "../config/env.js";
import mongoose from "mongoose";

let passed = true;

console.log("Running AI Abstraction Layer Verification Suite...\n");

// Mock global.fetch to prevent real network requests and avoid libuv process exit crashes
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (url && url.includes("generativelanguage.googleapis.com")) {
    return {
      status: 403,
      ok: false,
      text: async () => JSON.stringify({
        error: {
          code: 403,
          message: "Mocked Permission Denied for testing",
          status: "PERMISSION_DENIED"
        }
      })
    };
  }
  return originalFetch(url, options);
};

// 1. Assert BaseAiProvider cannot be constructed directly
try {
  console.log("Asserting BaseAiProvider cannot be constructed directly...");
  new BaseAiProvider("test");
  console.error("  FAIL: BaseAiProvider constructor did not throw!");
  passed = false;
} catch (err) {
  if (err instanceof TypeError && err.message.includes("Cannot construct BaseAiProvider")) {
    console.log("  PASS: BaseAiProvider correctly throws on direct instantiation");
  } else {
    console.error("  FAIL: Threw unexpected error:", err);
    passed = false;
  }
}

// 2. Assert Registry operations
{
  console.log("\nAsserting Registry operations...");
  const tempMock = new MockProvider();
  aiProviderRegistry.registerProvider("temp-mock", tempMock);
  const resolved = aiProviderRegistry.getProvider("temp-mock");
  
  if (resolved === tempMock) {
    console.log("  PASS: Provider registered and resolved correctly");
  } else {
    console.error("  FAIL: Resolved provider mismatch");
    passed = false;
  }

  // Clear temp provider
  aiProviderRegistry.providers.delete("temp-mock");
}

// 3. Assert MockProvider generation
{
  console.log("\nAsserting MockProvider generation...");
  const customResponse = JSON.stringify({ pair: "XAUUSD", direction: "BUY" });
  const mock = new MockProvider({
    mockResponses: { "test-prompt": customResponse }
  });

  mock.generateContent("test-prompt").then((res) => {
    if (res.textResponse === customResponse && res.modelUsed === "mock-model") {
      console.log("  PASS: MockProvider generated predefined prompt content correctly");
    } else {
      console.error("  FAIL: MockProvider generated unexpected output:", res);
      passed = false;
    }
  }).catch((err) => {
    console.error("  FAIL: MockProvider threw exception:", err);
    passed = false;
  });
}

// 4. Assert Model Fallback routing and mock fallback response
{
  console.log("\nAsserting Model Manager fallback routing to mock provider...");
  const originalPrimary = config.models.primary;
  const originalSecondary = config.models.secondary;
  const originalFallback = config.enableModelFallback;

  config.models.primary = "mock-primary";
  config.models.secondary = "mock-secondary";
  config.enableModelFallback = true;

  const mockResponse = JSON.stringify({
    pair: "XAUUSD",
    direction: "SELL",
    entryMin: 4100,
    entryMax: 4110,
    sl: 4120,
    tp: 4080,
    moderateTp: 4070,
    highRiskTp: 4060,
    tradeQuality: "Excellent",
    confidence: 90,
    estimatedHoldingTime: "1-2 hr",
    tradeStyle: "Intraday",
    reasoning: ["Mock strategy trigger"]
  });

  // Re-register mock provider configured to return this specific response
  const customMock = new MockProvider({
    mockResponses: { "generate-mock-recommendation": mockResponse }
  });
  aiProviderRegistry.registerProvider("mock", customMock);

  callGeminiWithFallback("generate-mock-recommendation", "test-req-id", Date.now(), null)
    .then((result) => {
      if (
        result.textResponse === mockResponse &&
        result.modelUsed === "mock-primary" &&
        result.responseSource === "MOCK_PROVIDER"
      ) {
        console.log("  PASS: Model Manager routed successfully through MockProvider");
      } else {
        console.error("  FAIL: Routed response mismatch. Received:", result);
        passed = false;
      }

      // Assert immutability on returned payload
      if (Object.isFrozen(result)) {
        console.log("  PASS: AI response snapshot is strictly frozen");
        try {
          result.modelUsed = "hacked-model";
          console.error("  FAIL: Mutation succeeded without throwing!");
          passed = false;
        } catch (mutationErr) {
          console.log("  PASS: Attempted mutation correctly threw an exception");
        }
      } else {
        console.error("  FAIL: Response snapshot was not frozen");
        passed = false;
      }

      // Restore configuration
      config.models.primary = originalPrimary;
      config.models.secondary = originalSecondary;
      config.enableModelFallback = originalFallback;
      
      // Re-register standard mock provider
      aiProviderRegistry.registerProvider("mock", new MockProvider());
      
      finalizeTests();
    })
    .catch((err) => {
      console.error("  FAIL: callGeminiWithFallback threw exception:", err);
      passed = false;
      finalizeTests();
    });
}

function finalizeTests() {
  global.fetch = originalFetch; // Restore fetch
  mongoose.disconnect().finally(() => {
    if (passed) {
      console.log("\nALL AI ABSTRACTION TESTS PASSED!\n");
      process.exit(0);
    } else {
      console.error("\nSOME AI ABSTRACTION TESTS FAILED!\n");
      process.exit(1);
    }
  });
}
