import { BaseAiProvider } from "./aiProvider.js";

/**
 * Mock AI Provider for testing purposes
 */
export class MockProvider extends BaseAiProvider {
  /**
   * @param {Object} config - Configuration object
   */
  constructor(config = {}) {
    super("mock", config);
    this.mockResponses = config.mockResponses || {};
  }

  /**
   * Generates mock response content.
   * @param {string} prompt - Input prompt text
   * @param {Object} options - Options override
   * @returns {Promise<{ textResponse: string, modelUsed: string }>} response payload
   */
  async generateContent(prompt, options = {}) {
    const modelName = options.modelName || this.config.modelName || "mock-model";
    
    const textResponse = options.mockResponse || this.mockResponses[prompt] || JSON.stringify({
      pair: "XAUUSD",
      direction: "HOLD",
      entryMin: 0,
      entryMax: 0,
      sl: null,
      tp: null,
      moderateTp: null,
      highRiskTp: null,
      tradeQuality: "Average",
      confidence: 50,
      estimatedHoldingTime: "5-15 min",
      tradeStyle: "Scalp",
      reasoning: ["Mock provider default response"]
    });

    return {
      textResponse,
      modelUsed: modelName
    };
  }
}
