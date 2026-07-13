/**
 * Abstract Base Class for AI Providers.
 */
export class BaseAiProvider {
  /**
   * @param {string} name - Provider identifier
   * @param {Object} config - Configuration parameters
   */
  constructor(name, config = {}) {
    if (new.target === BaseAiProvider) {
      throw new TypeError("Cannot construct BaseAiProvider instances directly");
    }
    this.name = name;
    this.config = config;
  }

  /**
   * Generates response content from a prompt.
   * @param {string} prompt - Input prompt text
   * @param {Object} options - Generation settings override
   * @returns {Promise<{ textResponse: string, modelUsed: string }>} response payload
   */
  async generateContent(prompt, options = {}) {
    throw new Error("Method generateContent() must be implemented by concrete classes");
  }
}
