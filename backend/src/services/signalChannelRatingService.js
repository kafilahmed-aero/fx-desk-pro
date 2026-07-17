import { logger } from "../utils/logger.js";
import { ValidationChannelStats } from "../models/validationChannelStatsModel.js";
import { deepFreeze } from "./signalValidationService.js";

// Configurable weights for trade reliability calculations
export const RELIABILITY_WEIGHTS = {
  WIN_RATE: 40,
  FILL_RATE: 20,
  AVERAGE_PIPS: 20,
  SAMPLE_SIZE: 10,
  RECENCY: 10
};

// Threshold for completed signals sample size check
export const MIN_SIGNALS_THRESHOLD = 20;

/**
 * Stage 8: Channel Rating Engine.
 * Aggregates trade outcomes and computes channel winRates, fillRates, and reliability scores.
 * @param {Object} context - Completed SignalValidationContext
 * @param {Object} options - Rating options
 * @returns {Promise<Object>} Deep-frozen updated SignalValidationContext
 */
export async function evaluateChannelRating(context = {}, options = {}) {
  const now = options.now || Date.now();

  // 1. Ingestion Guards
  if (
    !context ||
    context.pipelineStatus !== "COMPLETED" ||
    context.rating?.processed === true
  ) {
    logger.debug("channel_rating.skipped", {
      signalId: context?.signalId,
      pipelineStatus: context?.pipelineStatus,
      ratingProcessed: context?.rating?.processed
    });
    return context;
  }

  const channelName = context.channelName;
  if (!channelName) {
    logger.warn("channel_rating.missing_channel_name", { signalId: context.signalId });
    return context;
  }

  // 2. Fetch or initialize validation channel stats
  let doc = await ValidationChannelStats.findOne({ channelName });
  if (!doc) {
    doc = new ValidationChannelStats({ channelName });
  }

  // 3. Accumulate raw statistics (Source of truth)
  doc.totalSignals += 1;

  if (context.order?.executionStatus !== "NOT_STARTED") {
    doc.executedSignals += 1;
  }

  const isFilled = context.monitoring?.positionOpenedAt !== null;
  if (isFilled) {
    doc.filledSignals += 1;
    
    const tradePips = typeof context.outcome?.pips === "number" ? context.outcome.pips : 0;
    doc.totalPips += tradePips;
    doc.totalTradeDuration += typeof context.outcome?.tradeDuration === "number" ? context.outcome.tradeDuration : 0;

    if (tradePips > 0) {
      doc.grossWinsPips += tradePips;
    } else if (tradePips < 0) {
      doc.grossLossPips += Math.abs(tradePips);
    }
  }

  const result = context.outcome?.result;
  if (result === "FULL_TP") {
    doc.fullTP += 1;
  } else if (result === "SL_HIT") {
    doc.slHit += 1;
  } else if (result === "MANUAL_CLOSE") {
    doc.manualClose += 1;
  } else if (result === "CANCELLED") {
    doc.cancelled += 1;
  } else if (result === "EXPIRED") {
    doc.expired += 1;
  } else if (result === "UNKNOWN") {
    doc.unknown += 1;
  }

  // 4. Update timeline timestamps
  const outcomeClosedAt = context.outcome?.closedAt ? new Date(context.outcome.closedAt) : new Date(now);
  if (!doc.firstTradeAt) {
    doc.firstTradeAt = outcomeClosedAt;
  }
  doc.lastTradeAt = outcomeClosedAt;
  doc.lastUpdated = new Date(now);

  // 5. Recalculate derived metrics
  doc.winRate = (doc.fullTP + doc.slHit) > 0 ? doc.fullTP / (doc.fullTP + doc.slHit) : 0;
  doc.fillRate = doc.executedSignals > 0 ? doc.filledSignals / doc.executedSignals : 0;
  doc.averagePips = doc.filledSignals > 0 ? doc.totalPips / doc.filledSignals : 0;
  doc.averageTradeDuration = doc.filledSignals > 0 ? doc.totalTradeDuration / doc.filledSignals : 0;
  doc.profitFactor = doc.grossLossPips > 0 
    ? Number((doc.grossWinsPips / doc.grossLossPips).toFixed(2)) 
    : (doc.grossWinsPips > 0 ? 99.99 : 0);

  // 6. Compute Reliability Score
  doc.sampleStatus = doc.totalSignals >= MIN_SIGNALS_THRESHOLD ? "SUFFICIENT_DATA" : "INSUFFICIENT_DATA";

  const winRateComponent = doc.winRate * RELIABILITY_WEIGHTS.WIN_RATE;
  const fillRateComponent = doc.fillRate * RELIABILITY_WEIGHTS.FILL_RATE;
  // Map average pips to points: 0 points at 0 pips, 20 points at +100 pips (5 pips per point)
  const averagePipsComponent = Math.min(RELIABILITY_WEIGHTS.AVERAGE_PIPS, Math.max(0, doc.averagePips / 5));
  const sampleSizeComponent = Math.min(RELIABILITY_WEIGHTS.SAMPLE_SIZE, doc.totalSignals);
  
  // Recency checks if last trade was within 7 days
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const isRecent = (Date.now() - doc.lastTradeAt.getTime()) < sevenDaysMs;
  const recentComponent = isRecent ? RELIABILITY_WEIGHTS.RECENCY : (RELIABILITY_WEIGHTS.RECENCY / 2);

  doc.reliabilityScore = winRateComponent + fillRateComponent + averagePipsComponent + sampleSizeComponent + recentComponent;

  // 7. Persist document changes
  await doc.save();

  logger.info("channel_rating.success", {
    channelName,
    totalSignals: doc.totalSignals,
    winRate: doc.winRate.toFixed(4),
    reliabilityScore: doc.reliabilityScore.toFixed(1),
    sampleStatus: doc.sampleStatus
  });

  const updatedContext = {
    ...context,
    rating: {
      processed: true,
      processedAt: new Date(now).toISOString()
    }
  };

  return deepFreeze(updatedContext);
}
