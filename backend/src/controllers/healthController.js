import { getLiveStabilitySnapshot } from "../services/liveStabilityService.js";
import { logger } from "../utils/logger.js";
import { getRawMessages } from "../services/rawMessageStore.js";
import { getParsedSignals } from "../services/parsedSignalStore.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { classifyMessage } from "../parsers/noiseFilter.js";

// controllers contain request handlers.
// Keeping handlers here prevents route files from growing too large.
export function getHealth(_request, response) {
  response.json({
    status: "Backend running",
  });
}

export function getLiveStability(_request, response) {
  logger.debug("api.live_stability_requested");

  response.json({
    stability: getLiveStabilitySnapshot(),
  });
}

export async function getDebugSignals(_request, response) {
  try {
    const raw = await getRawMessages(5);
    const parsed = await getParsedSignals(5);
    response.json({ raw, parsed });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}

export async function getReclassificationAudit(request, response) {
  try {
    const signals = await ParsedSignal.find({}).lean();
    
    let xauusdToDxy = [];
    let xauusdToUnknown = [];
    let unknownToDxy = [];
    let validToUnknown = [];
    let generalChanges = [];

    let beforeActionableCount = 0;
    let afterActionableCount = 0;
    let beforeSuccessCount = 0;
    let afterSuccessCount = 0;

    const isActionable = (classification) => ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(classification);

    for (const doc of signals) {
      const rawMessage = {
        channel: doc.channel,
        messageId: doc.messageId,
        text: doc.rawText,
        hasMedia: doc.textStats?.hasMedia || false,
        timestamp: doc.timestamp || doc.createdAt,
      };

      const oldClassification = doc.parserClassification || doc.classification;
      const oldPair = doc.pair || "unknown";

      if (isActionable(oldClassification)) {
        beforeActionableCount++;
        if (oldPair && oldPair !== "unknown") {
          beforeSuccessCount++;
        }
      }

      const newClassificationResult = classifyMessage(rawMessage);
      const newClassification = newClassificationResult.classification;
      
      const parsed = isActionable(newClassification)
        ? parseSignalMessage(rawMessage, newClassification)
        : null;

      const newPair = parsed?.pair || "unknown";

      if (isActionable(newClassification)) {
        afterActionableCount++;
        if (newPair && newPair !== "unknown") {
          afterSuccessCount++;
        }
      }

      if (oldPair !== newPair) {
        const changeInfo = {
          channel: doc.channel,
          messageId: doc.messageId,
          oldPair,
          newPair,
          text: doc.rawText,
        };

        if (oldPair === "XAUUSD" && newPair === "DXY") {
          xauusdToDxy.push(changeInfo);
        } else if (oldPair === "XAUUSD" && newPair === "unknown") {
          xauusdToUnknown.push(changeInfo);
        } else if (oldPair === "unknown" && newPair === "DXY") {
          unknownToDxy.push(changeInfo);
        } else if (oldPair !== "unknown" && newPair === "unknown") {
          validToUnknown.push(changeInfo);
        } else {
          generalChanges.push(changeInfo);
        }
      }
    }

    const beforeSuccessRate = signals.length > 0 ? (beforeSuccessCount / signals.length) * 100 : 0;
    const afterSuccessRate = signals.length > 0 ? (afterSuccessCount / signals.length) * 100 : 0;

    response.json({
      success: true,
      aggregateCounts: {
        totalSignalsAnalyzed: signals.length,
        xauusdToDxy: xauusdToDxy.length,
        xauusdToUnknown: xauusdToUnknown.length,
        unknownToDxy: unknownToDxy.length,
        validToUnknown: validToUnknown.length,
        generalChanges: generalChanges.length,
        totalParsedActionableSignalsBefore: beforeActionableCount,
        totalParsedActionableSignalsAfter: afterActionableCount,
        successCountBefore: beforeSuccessCount,
        successCountAfter: afterSuccessCount,
        successRateBefore: beforeSuccessRate,
        successRateAfter: afterSuccessRate,
        netActionableSignalCountChange: afterActionableCount - beforeActionableCount,
        netSuccessRateChange: afterSuccessRate - beforeSuccessRate
      },
      reclassificationExamples: [...xauusdToDxy, ...xauusdToUnknown, ...unknownToDxy, ...generalChanges].slice(0, 20),
      falsePositives: validToUnknown
    });
  } catch (err) {
    response.status(500).json({ error: err.message });
  }
}
