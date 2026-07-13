import { logger } from "../utils/logger.js";

/**
 * Registry to hold active AI provider adapters
 */
class AiProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  /**
   * Registers a provider instance.
   * @param {string} name - Key identifier for the provider (e.g. 'gemini', 'openai')
   * @param {Object} providerInstance - Concrete provider instance
   */
  registerProvider(name, providerInstance) {
    const normalized = String(name).toLowerCase().trim();
    this.providers.set(normalized, providerInstance);
    logger.info(`ai_provider_registry.registered`, { name: normalized });
  }

  /**
   * Resolves a provider instance by name.
   * @param {string} name - Key identifier
   * @returns {Object|null} The registered provider instance or null
   */
  getProvider(name) {
    const normalized = String(name).toLowerCase().trim();
    return this.providers.get(normalized) || null;
  }

  /**
   * Resets/clears all provider registrations.
   */
  clearRegistry() {
    this.providers.clear();
    logger.info(`ai_provider_registry.reset`, { count: 0 });
  }
}

export const aiProviderRegistry = new AiProviderRegistry();
