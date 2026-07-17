import { logger } from "../utils/logger.js";
import { generateMagicNumber, broadcastToEAs, signalCallbacks } from "./mt5SyncService.js";
import { deepFreeze } from "./signalValidationService.js";

/**
 * Stage 5: MT5 Execution Bridge (Stateless).
 * Routes scheduled and execution-ready signals to the connected MT5 EA terminals.
 * @param {Object} context - Scheduled SignalValidationContext
 * @param {Object} options - Execution bridge options
 * @returns {Promise<Object>} Deep-frozen updated SignalValidationContext
 */
export function executeBridgeOrder(context = {}, options = {}) {
  const now = options.now || Date.now();
  const timeoutMs = options.timeoutMs || 10000;

  // 1. Ingestion Guards
  if (
    !context ||
    context.pipelineStatus !== "SCHEDULED" ||
    context.order?.executionStatus !== "READY_FOR_EXECUTION"
  ) {
    logger.warn("execution_bridge.ignored", {
      signalId: context?.signalId,
      pipelineStatus: context?.pipelineStatus,
      executionStatus: context?.order?.executionStatus
    });
    return Promise.resolve(context);
  }

  const { signalId, symbol, direction, stopLoss, takeProfits } = context;
  const magicNumber = generateMagicNumber(String(signalId));
  const actionDirection = direction === "BUY" ? "BUY" : "SELL";
  const tpPrice = Array.isArray(takeProfits) && takeProfits.length > 0 ? takeProfits[0] : null;

  // 2. Format the MT5 Transaction request payload
  const msg = {
    action: "OPEN_ORDER",
    recommendationId: String(signalId),
    magicNumber,
    symbol,
    direction: actionDirection,
    volume: 0.01,
    price: context.order.plannedEntry || context.entry,
    sl: stopLoss || null,
    tp: tpPrice
  };

  logger.info("execution_bridge.dispatching", {
    signalId,
    symbol,
    actionDirection,
    magicNumber
  });

  return new Promise((resolve) => {
    // Reconnect cleanup wrapper
    const cleanup = () => {
      signalCallbacks.delete(String(signalId));
    };

    // Register 10s execution timeout
    const timeoutId = setTimeout(() => {
      cleanup();
      logger.error("execution_bridge.timeout", { signalId, timeoutMs });

      const failedContext = {
        ...context,
        order: {
          ...context.order,
          executionStatus: "FAILED",
          executionResult: "FAILED",
          failureReason: `MT5 connection timed out waiting for response (${timeoutMs}ms).`,
          failedAt: new Date(now).toISOString()
        }
      };
      resolve(deepFreeze(failedContext));
    }, timeoutMs);

    // Register active callback resolvers
    signalCallbacks.set(String(signalId), {
      resolve: (payload) => {
        clearTimeout(timeoutId);
        cleanup();
        logger.info("execution_bridge.success", { signalId, ticket: payload.ticket });

        const successContext = {
          ...context,
          pipelineStatus: "EXECUTED",
          order: {
            ...context.order,
            executionStatus: "EXECUTED",
            ticket: String(payload.ticket),
            fillPrice: Number(payload.fillPrice),
            executedAt: payload.fillTime ? new Date(payload.fillTime).toISOString() : new Date().toISOString(),
            executionResult: "SUCCESS"
          }
        };
        resolve(deepFreeze(successContext));
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        cleanup();
        logger.warn("execution_bridge.failed", { signalId, reason: err.message });

        const failedContext = {
          ...context,
          order: {
            ...context.order,
            executionStatus: "FAILED",
            executionResult: "FAILED",
            failureReason: err.message || "Trade rejected by MT5 terminal.",
            failedAt: new Date().toISOString()
          }
        };
        resolve(deepFreeze(failedContext));
      }
    });

    // 3. Broadcast payload over MT5 WebSocket Server
    broadcastToEAs(msg, context.mt5AccountId);
  });
}
