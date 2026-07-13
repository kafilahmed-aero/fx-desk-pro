import { BaseAiProvider } from "./aiProvider.js";
import { logger } from "../utils/logger.js";

/**
 * Concrete AI Provider for Google Gemini via HTTP API
 */
export class GeminiProvider extends BaseAiProvider {
  /**
   * @param {Object} config - Configuration object
   */
  constructor(config = {}) {
    super("gemini", config);
    this.apiKey = config.geminiApiKey || "";
  }

  /**
   * Generates response content from a prompt using Gemini.
   * @param {string} prompt - Input prompt text
   * @param {Object} options - Options override (modelName, requestId, timeoutMs)
   * @returns {Promise<{ textResponse: string, modelUsed: string }>} response payload
   */
  async generateContent(prompt, options = {}) {
    const modelName = options.modelName || this.config.modelName || "gemini-2.5-flash";
    const reqId = options.requestId || "UNKNOWN-REQ";
    const apiVersion = "v1beta";
    const apiKey = this.apiKey || options.geminiApiKey || "";
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

    const generationConfig = {
      responseMimeType: "application/json"
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 20000);

    try {
      const response = await global.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const status = response.status;
      const success = response.ok;

      if (!success) {
        const errorText = await response.text();
        logger.error(`[req: ${reqId}] GeminiProvider failed with status: ${status}`, { error: errorText });
        
        const err = new Error(`API_ERROR_${status}`);
        err.status = status;
        err.responseBody = errorText;
        throw err;
      }

      const data = await response.json();
      const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        logger.error(`[req: ${reqId}] GeminiProvider returned empty candidates`);
        throw new Error("EMPTY_RESPONSE_CANDIDATES");
      }

      return {
        textResponse,
        modelUsed: modelName
      };

    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
