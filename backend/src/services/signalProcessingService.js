import { classifyMessage } from "../parsers/noiseFilter.js";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { storeParsedSignal } from "./parsedSignalStore.js";
import {
  createChannelReliabilityFoundation,
  createDedupeFoundation,
  createUpdateContextFoundation,
} from "./signalIntelligenceMetadata.js";
import { createTestSignalMetadata } from "./testSignalExpiry.js";
import { logger } from "../utils/logger.js";
import { broadcastLiveUpdateEvent } from "./liveUpdateService.js";
import { sendTelegramAlert } from "./telegramAlertService.js";
import { getPairState } from "./pairStateEngine.js";
import { initializeOutcome, processSignalUpdate } from "./signalOutcomeEngine.js";


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

    const extractedSignal = parseSignalMessage(
      rawMessage,
      classificationResult.classification
    );

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

    const parsedSignal = {
      ...extractedSignal,
      ...createTestSignalMetadata(rawMessage),
      channelTitle: rawMessage.channelTitle || null,
      classification: classificationResult.classification,
      classificationReasons: classificationResult.reasons,
      dedupe: createDedupeFoundation(extractedSignal),
      channelReliability: createChannelReliabilityFoundation(rawMessage.channel),
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
