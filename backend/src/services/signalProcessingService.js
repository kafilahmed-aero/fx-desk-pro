import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { detectTradingPair } from "../parsers/pairDetector.js";
import { config } from "../config/env.js";
import { storeParsedSignal } from "./parsedSignalStore.js";
import {
  createDedupeFoundation,
  createUpdateContextFoundation,
} from "./signalIntelligenceMetadata.js";
import { createTestSignalMetadata } from "./testSignalExpiry.js";
import { logger } from "../utils/logger.js";
import { broadcastLiveUpdateEvent } from "./liveUpdateService.js";
import { sendTelegramAlert } from "./telegramAlertService.js";
import { getPairState } from "./pairStateEngine.js";
import { initializeOutcome, processSignalUpdate } from "./signalOutcomeEngine.js";
import { getCurrentPrice } from "./priceIngestionService.js";


// Turns one raw Telegram message into a stored parsed signal when rules match.
// This is intentionally transparent: every decision is logged for parser tuning.
export async function processRawMessage(rawMessage) {
  try {
    const classificationResult = classifyMessage(rawMessage);
    const messageKey = `${rawMessage.channel}:${rawMessage.messageId}`;

    logger.info("message.classified", {
      messageKey,
      normalizedText: classificationResult.normalized.normalizedText,
      classification: classificationResult.classification,
      scores: {
        signal: classificationResult.signalScore,
        update: classificationResult.updateScore,
        result: classificationResult.resultScore,
        marketAnalysis: classificationResult.marketAnalysisScore,
        promo: classificationResult.promoScore,
        news: classificationResult.newsScore,
        noise: classificationResult.noiseScore,
      },
      reasons: classificationResult.reasons,
    });

    if (!isActionableClassification(classificationResult.classification)) {
      logger.info("message.skipped", {
        messageKey,
        normalizedText: classificationResult.normalized.normalizedText,
        classification: classificationResult.classification,
        reason: "non_actionable_message",
        reasons: classificationResult.reasons,
      });

      return {
        classification: classificationResult.classification,
        parsedSignal: null,
        stored: false,
      };
    }

    let currentPrice = null;
    try {
      const pair = detectTradingPair(rawMessage?.text || "");
      if (pair && pair !== "unknown") {
        const priceInfo = await getCurrentPrice(pair);
        if (priceInfo && typeof priceInfo.price === "number") {
          currentPrice = priceInfo.price;
        }
      }
    } catch (err) {
      logger.warn("signal_processing.price_fetch_failed", {
        channel: rawMessage?.channel,
        messageId: rawMessage?.messageId,
        error: err.message,
      });
    }

    const extractedSignal = classificationResult.parsed || parseSignalMessage(
      rawMessage,
      classificationResult.classification
    );

    extractedSignal.parserClassification = classificationResult.classification;

    // Apply dynamic market price validation if currentPrice is provided
    if (currentPrice && typeof currentPrice === "number" && extractedSignal.pair && extractedSignal.pair !== "unknown") {
      const minAllowed = currentPrice * 0.25;
      const maxAllowed = currentPrice * 4.0;
      const isValid = (val) => val === "OPEN" || (typeof val === "number" && val >= minAllowed && val <= maxAllowed);

      if (extractedSignal.entry !== null && !isValid(extractedSignal.entry)) {
        extractedSignal.entry = null;
      }
      if (extractedSignal.entryRange) {
        extractedSignal.entryRange = extractedSignal.entryRange.filter(isValid);
      }
      if (extractedSignal.targets) {
        extractedSignal.targets = extractedSignal.targets.filter(isValid);
        const openFiltered = extractedSignal.targets.filter((t) => t !== "OPEN" && typeof t === "number");
        extractedSignal.target = openFiltered[0] || null;
      }
      if (extractedSignal.stopLoss !== null && !isValid(extractedSignal.stopLoss)) {
        extractedSignal.stopLoss = null;
      }

      // Check if price validation filtered out mandatory fields and demote to Noise if so
      const hasEntry = (extractedSignal.entry !== null && extractedSignal.entry !== undefined) || (extractedSignal.entryRange && extractedSignal.entryRange.length > 0);
      const hasTP = (extractedSignal.targets && extractedSignal.targets.length > 0) || (extractedSignal.pipTargets && extractedSignal.pipTargets.length > 0) || extractedSignal.isOpenTarget;
      const hasSL = (extractedSignal.stopLoss !== null && extractedSignal.stopLoss !== undefined) || extractedSignal.hiddenStopLoss;

      if (!(hasEntry && hasTP && hasSL)) {
        extractedSignal.parserClassification = "NOISE";
      }
    }

    if (extractedSignal.parserClassification === "NOISE") {
      logger.info("message.skipped", {
        messageKey,
        normalizedText: classificationResult.normalized.normalizedText,
        classification: classificationResult.classification,
        reason: "market_validation_failed_demoted_to_noise",
        reasons: classificationResult.reasons,
      });

      return {
        classification: "NOISE",
        parsedSignal: null,
        stored: false,
      };
    }

    if (!extractedSignal.pair || extractedSignal.pair === "unknown") {
      logger.info("message.skipped", {
        messageKey,
        normalizedText: classificationResult.normalized.normalizedText,
        classification: classificationResult.classification,
        reason: "unknown_or_invalid_pair",
        reasons: classificationResult.reasons,
      });

      return {
        classification: classificationResult.classification,
        parsedSignal: null,
        stored: false,
      };
    }

    if (classificationResult.classification === "RESULT_SIGNAL") {
      const parsedSignal = {
        ...extractedSignal,
        ...createTestSignalMetadata(rawMessage),
        channelTitle: rawMessage.channelTitle || null,
        classification: classificationResult.classification,
        classificationReasons: classificationResult.reasons,
        dedupe: createDedupeFoundation(extractedSignal),
        updateContext: createUpdateContextFoundation(extractedSignal),
      };

      await processSignalUpdate(parsedSignal).catch((err) => {
        logger.error("outcome_update.failed", {
          messageKey,
          error: err.message,
        });
      });

      return {
        classification: classificationResult.classification,
        parsedSignal,
        stored: false,
      };
    }

    if (config.executionMode === "signal_validation" && classificationResult.classification === "NEW_SIGNAL") {
      const { executeSignalValidationPipeline } = await import("./signalValidationPipeline.js");
      const validationReport = await executeSignalValidationPipeline(rawMessage, extractedSignal);
      
      if (validationReport.success && validationReport.context) {
        try {
          const { SignalValidationContextModel } = await import("../models/signalValidationContextModel.js");
          await SignalValidationContextModel.create(validationReport.context);
          
          const { validationEvents } = await import("./validationEvents.js");
          validationEvents.emit("validationContextCreated", validationReport.context);
          
          logger.info("pipeline_integration.context_persisted", { signalId: validationReport.context.signalId });
        } catch (err) {
          if (err.code === 11000) {
            logger.warn("pipeline_integration.duplicate_context_skipped", { signalId: validationReport.context.signalId });
          } else {
            logger.error("pipeline_integration.context_persist_failed", { signalId: validationReport.context.signalId, error: err.message });
          }
        }
      }

      return {
        classification: classificationResult.classification,
        parsedSignal: validationReport.context,
        stored: true
      };
    }

    const parsedSignal = {
      ...extractedSignal,
      ...createTestSignalMetadata(rawMessage),
      channelTitle: rawMessage.channelTitle || null,
      classification: classificationResult.classification,
      classificationReasons: classificationResult.reasons,
      dedupe: createDedupeFoundation(extractedSignal),
      updateContext: createUpdateContextFoundation(extractedSignal),
    };
    const storeResult = await storeParsedSignal(parsedSignal);
    const storedParsedSignal = storeResult.signal;

    // Trigger Signal Outcome tracking if signal is successfully stored
    if (storeResult.stored) {
      if (storedParsedSignal.classification === "NEW_SIGNAL") {
        await initializeOutcome(storedParsedSignal).catch((err) => {
          logger.error("outcome_initialization.failed", {
            messageKey,
            error: err.message,
          });
        });
      } else if (
        storedParsedSignal.classification === "UPDATE_SIGNAL" ||
        storedParsedSignal.classification === "RESULT_SIGNAL"
      ) {
        await processSignalUpdate(storedParsedSignal).catch((err) => {
          logger.error("outcome_update.failed", {
            messageKey,
            error: err.message,
          });
        });
      }
    }

    logger.info("signal.parsed", {
      messageKey,
      classification: storedParsedSignal.classification,
      lifecycleEvent: storedParsedSignal.lifecycleEvent,
      extractedFields: {
        pair: storedParsedSignal.pair,
        action: storedParsedSignal.action,
        bias: storedParsedSignal.bias,
        entry: storedParsedSignal.entry,
        targets: storedParsedSignal.targets,
        pipTargets: storedParsedSignal.pipTargets,
        stopLoss: storedParsedSignal.stopLoss,
        hiddenStopLoss: storedParsedSignal.hiddenStopLoss,
        timeframe: storedParsedSignal.timeframe,
        managementAction: storedParsedSignal.managementAction,
        resultAction: storedParsedSignal.resultAction,
      },
      signalStatus: storedParsedSignal.signalStatus,
      missingFields: storedParsedSignal.missingFields,
      extractionConfidence: storedParsedSignal.extractionConfidence,
      freshnessScore: storedParsedSignal.freshnessScore,
      isTestSignal: Boolean(storedParsedSignal.isTestSignal),
      expiresAt: storedParsedSignal.expiresAt || null,
      possibleDuplicate: storedParsedSignal.possibleDuplicate,
      duplicateMatch: storedParsedSignal.duplicateMatch,
      dedupe: storedParsedSignal.dedupe,
      updateContext: storedParsedSignal.updateContext,
      stored: storeResult.stored,
    });

    if (
      storeResult.stored &&
      storedParsedSignal.classification === "NEW_SIGNAL" &&
      storedParsedSignal.pair &&
      storedParsedSignal.action
    ) {
      const messageKey = `${storedParsedSignal.channel}:${storedParsedSignal.messageId}`;

      // Retrieve the updated pair state to get the signal count
      let signalCount = 1;
      try {
        const pairState = getPairState(storedParsedSignal.pair);
        if (pairState && typeof pairState.signalCount === "number") {
          signalCount = pairState.signalCount;
        }
      } catch (err) {
        logger.error("telegram_alert.get_pair_state_failed", {
          pair: storedParsedSignal.pair,
          error: err.message,
        });
      }

      try {
        broadcastLiveUpdateEvent("new-signal-alert", {
          pair: storedParsedSignal.pair,
          action: storedParsedSignal.action,
          signalCount,
          messageKey,
          timestamp: storedParsedSignal.createdAt || new Date().toISOString(),
        });
      } catch (err) {
        logger.error("notification.broadcast_failed", {
          pair: storedParsedSignal.pair,
          action: storedParsedSignal.action,
          error: err.message,
        });
      }

      // Fire-and-forget Telegram alert (never blocks signal processing)
      sendTelegramAlert(
        storedParsedSignal.pair,
        storedParsedSignal.action,
        signalCount,
        messageKey
      ).catch((err) => {
        logger.error("telegram_alert.unhandled_error", {
          messageKey,
          error: err.message,
        });
      });
    }

    return {
      classification: classificationResult.classification,
      parsedSignal: storedParsedSignal,
      stored: storeResult.stored,
    };
  } catch (error) {
    logger.error("message.processing_failed", {
      channel: rawMessage?.channel,
      messageId: rawMessage?.messageId,
      error: error.message,
    });

    return {
      classification: "NOISE",
      parsedSignal: null,
      stored: false,
      error: error.message,
    };
  }
}

function isActionableClassification(classification) {
  return ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL", "MARKET_ANALYSIS"].includes(
    classification
  );
}
