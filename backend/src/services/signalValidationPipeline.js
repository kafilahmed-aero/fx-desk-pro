import { logger } from "../utils/logger.js";
import { validateParsedSignal, deepFreeze } from "./signalValidationService.js";

/**
 * Signal Validation Pipeline (Phoenix v0).
 * Bypasses the Decision Engine and runs Stage 1 (Validation) and Stage 2 (Entry Planner).
 * @param {Object} rawMessage
 * @param {Object} parsedSignal
 * @param {Object} options
 * @returns {Object} Standard Validation Result object
 */
export async function executeSignalValidationPipeline(rawMessage, parsedSignal, options = {}) {
  const validationResult = validateParsedSignal(rawMessage, parsedSignal, options);

  if (!validationResult.success) {
    const errorMsg = validationResult.errors.map(e => `[${e.field}]: ${e.message}`).join(", ");
    logger.warn(`Signal Validation Mode Active - Validation FAILED: ${errorMsg}`, {
      errors: validationResult.errors
    });
    return validationResult;
  }

  logger.info(`Signal Validation Mode Active - Validation SUCCESS: ${validationResult.context.signalId}`, {
    signalId: validationResult.context.signalId,
    symbol: validationResult.context.symbol
  });

  // Stage 2: Entry Planner
  const liveMarketPrice = options.liveMarketPrice || options.mockMarketPrice?.price || parsedSignal?.entry || 2000;
  const { planSignalEntry } = await import("./signalEntryPlannerService.js");
  const plannedContext = planSignalEntry(validationResult.context, liveMarketPrice, options);

  const finalResult = {
    ...validationResult,
    context: plannedContext
  };

  return deepFreeze(finalResult);
}
