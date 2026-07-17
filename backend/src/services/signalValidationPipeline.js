import { logger } from "../utils/logger.js";
import { validateParsedSignal } from "./signalValidationService.js";

/**
 * Signal Validation Pipeline (Phoenix v0).
 * Bypasses the Decision Engine and runs Stage 1 signal validation.
 * @param {Object} rawMessage
 * @param {Object} parsedSignal
 * @param {Object} options
 * @returns {Object} Standard Validation Result object
 */
export async function executeSignalValidationPipeline(rawMessage, parsedSignal, options = {}) {
  const result = validateParsedSignal(rawMessage, parsedSignal, options);

  if (result.success) {
    logger.info(`Signal Validation Mode Active - Validation SUCCESS: ${result.context.signalId}`, {
      signalId: result.context.signalId,
      symbol: result.context.symbol
    });
  } else {
    const errorMsg = result.errors.map(e => `[${e.field}]: ${e.message}`).join(", ");
    logger.warn(`Signal Validation Mode Active - Validation FAILED: ${errorMsg}`, {
      errors: result.errors
    });
  }

  return result;
}
