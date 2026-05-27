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
