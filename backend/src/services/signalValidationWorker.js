import mongoose from "mongoose";
import { logger } from "../utils/logger.js";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";
import { priceEvents } from "./priceIngestionService.js";
import { mt5Events } from "./mt5SyncService.js";
import { validationEvents } from "./validationEvents.js";
import { evaluatePriceMonitor } from "./signalPriceMonitorService.js";
import { executeBridgeOrder } from "./signalExecutionBridgeService.js";
import { evaluateTradeMonitor } from "./signalTradeMonitorService.js";
import { evaluateSignalOutcome } from "./signalOutcomeEngineService.js";
import { evaluateChannelRating } from "./signalChannelRatingService.js";

// Worker configuration
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const LOCK_TIMEOUT_MS = 300000; // 5 minutes
const RETRY_LIMIT = 3;
const RETRY_BASE_DELAY_MS = 100;

// Worker State variables
const activeWorkerId = "worker-" + Math.random().toString(36).substring(2, 9);
let isRunning = false;
let totalProcessedCount = 0;
let lockAcquisitionFailures = 0;
let heartbeatTimer = null;

// Event deduplication registry
const processedEventIds = new Set();

// Sequential processing queue per signalId
const signalQueues = new Map();

/**
 * Sequentially enqueues operations on the same signalId.
 */
function enqueue(signalId, taskFn) {
  const key = String(signalId);
  if (!signalQueues.has(key)) {
    signalQueues.set(key, Promise.resolve());
  }
  const currentPromise = signalQueues.get(key);
  const nextPromise = currentPromise.then(async () => {
    try {
      await taskFn();
    } catch (err) {
      logger.error("worker.queue_task_error", { signalId: key, error: err.message });
    }
  });
  signalQueues.set(key, nextPromise);

  nextPromise.finally(() => {
    if (signalQueues.get(key) === nextPromise) {
      signalQueues.delete(key);
    }
  });
  return nextPromise;
}

/**
 * Exponential backoff retry wrapper.
 */
async function withRetry(fn, retries = RETRY_LIMIT, delay = RETRY_BASE_DELAY_MS) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
}

/**
 * Attempts lock acquisition for a signal document.
 */
async function acquireLock(signalId) {
  const now = new Date();
  const staleCutoff = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const doc = await SignalValidationContextModel.findOneAndUpdate(
    {
      signalId,
      $or: [
        { "processing.lockedBy": null },
        { "processing.lockedBy": activeWorkerId },
        { "processing.heartbeat": { $lt: staleCutoff } }
      ]
    },
    {
      $set: {
        "processing.lockedBy": activeWorkerId,
        "processing.lockTimestamp": now,
        "processing.heartbeat": now
      }
    },
    { new: true }
  );

  if (!doc) {
    lockAcquisitionFailures += 1;
  }
  return doc;
}

/**
 * Releases worker lock on a signal document.
 */
async function releaseLock(doc) {
  if (!doc) return;
  doc.processing.lockedBy = null;
  doc.processing.lockTimestamp = null;
  doc.processing.heartbeat = null;
  await withRetry(() => doc.save());
}

/**
 * Core engine state advancing driver.
 */
async function advanceContext(doc, options = {}) {
  // If the context is already marked FAILED, CANCELLED, EXPIRED or completed, release lock & exit
  if (["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(doc.pipelineStatus)) {
    return doc;
  }

  // 1. Stage 4 Price monitoring transition check
  if (doc.pipelineStatus === "SCHEDULED" && doc.order?.executionStatus === "WAITING_FOR_PRICE") {
    const livePrice = options.livePrice || doc.order?.currentMarketPrice;
    if (livePrice) {
      const evaluationResult = evaluatePriceMonitor(doc.toObject(), livePrice, options);
      doc.order.lastEvaluation = evaluationResult.order.lastEvaluation;
      
      if (evaluationResult.order.executionStatus === "READY_FOR_EXECUTION") {
        doc.order.executionStatus = "READY_FOR_EXECUTION";
        doc.order.promotionTimestamp = evaluationResult.order.promotionTimestamp;
        doc.order.promotionReason = evaluationResult.order.promotionReason;
      }
      await withRetry(() => doc.save());
    }
  }

  // 2. Stage 5 Execution Bridge transition
  if (doc.pipelineStatus === "READY_FOR_EXECUTION" || (doc.pipelineStatus === "SCHEDULED" && doc.order?.executionStatus === "READY_FOR_EXECUTION")) {
    try {
      let bridgeResult;
      if (global.mockBridgeResult) {
        bridgeResult = global.mockBridgeResult;
      } else {
        bridgeResult = await executeBridgeOrder(doc.toObject(), options);
      }
      doc.pipelineStatus = "EXECUTED";
      doc.order.executionStatus = "EXECUTED";
      doc.order.ticket = String(bridgeResult.order.ticket);
      doc.order.fillPrice = bridgeResult.order.fillPrice;
      doc.order.executedAt = bridgeResult.order.executedAt;
      doc.order.executionResult = "SUCCESS";
      doc.monitoring.status = "MONITORING";
      doc.monitoring.startedAt = new Date();
    } catch (err) {
      doc.pipelineStatus = "FAILED";
      doc.order.executionStatus = "FAILED";
      doc.order.failureReason = err.message;
      doc.order.failedAt = new Date();
    }
    await withRetry(() => doc.save());
  }

  // 3. Stage 7 Outcome Calculation
  if (doc.pipelineStatus === "EXECUTED" && doc.monitoring?.status === "POSITION_CLOSED") {
    const outcomeResult = evaluateSignalOutcome(doc.toObject(), options);
    doc.pipelineStatus = "COMPLETED";
    doc.outcome = outcomeResult.outcome;
    await withRetry(() => doc.save());
  }

  // 4. Stage 8 Rating aggregations
  if (doc.pipelineStatus === "COMPLETED" && doc.rating?.processed === false) {
    const ratingResult = await evaluateChannelRating(doc.toObject(), options);
    doc.rating = ratingResult.rating;
    await withRetry(() => doc.save());
    totalProcessedCount += 1;
  }

  return doc;
}

/**
 * Handle new incoming contexts.
 */
async function handleContextCreated(context) {
  if (!isRunning) return;
  enqueue(context.signalId, async () => {
    const doc = await acquireLock(context.signalId);
    if (!doc) return;
    try {
      await advanceContext(doc);
    } finally {
      await releaseLock(doc);
    }
  });
}

/**
 * Handles incoming price feed changes.
 */
async function handlePricesUpdated(pricesMap) {
  if (!isRunning) return;

  // Find waiting signals
  const waitingDocs = await SignalValidationContextModel.find({
    pipelineStatus: "SCHEDULED",
    "order.executionStatus": "WAITING_FOR_PRICE"
  });

  for (const doc of waitingDocs) {
    const priceInfo = pricesMap.get(doc.symbol);
    if (priceInfo && typeof priceInfo.price === "number") {
      enqueue(doc.signalId, async () => {
        const lockedDoc = await acquireLock(doc.signalId);
        if (!lockedDoc) return;
        try {
          await advanceContext(lockedDoc, { livePrice: priceInfo.price });
        } finally {
          await releaseLock(lockedDoc);
        }
      });
    }
  }
}

/**
 * Handles incoming WS event feeds from MT5 EA.
 */
async function handleTradeEvent({ eventType, payload }) {
  if (!isRunning) return;

  const { recommendationId, ticket } = payload;
  const signalId = recommendationId;
  if (!signalId) return;

  // Event Deduplication check
  const eventId = payload.eventId || `${ticket || signalId}_${eventType}_${payload.fillTime || payload.exitTime || Date.now()}`;
  if (processedEventIds.has(eventId)) {
    logger.debug("worker.duplicate_event_skipped", { eventId });
    return;
  }
  processedEventIds.add(eventId);

  enqueue(signalId, async () => {
    const doc = await acquireLock(signalId);
    if (!doc) return;

    try {
      if (eventType === "TRADE_FAILED") {
        doc.pipelineStatus = "FAILED";
        doc.order.executionStatus = "FAILED";
        doc.order.failureReason = payload.reason;
        doc.order.failedAt = new Date();
        await withRetry(() => doc.save());
      } else if (eventType === "ORDER_FILLED") {
        const monResult = evaluateTradeMonitor(doc.toObject(), { ...payload, event: eventType });
        doc.monitoring = monResult.monitoring;
        await withRetry(() => doc.save());
      } else if (eventType === "ORDER_CLOSED") {
        // Stage 6 monitor close
        const monResult = evaluateTradeMonitor(doc.toObject(), { ...payload, event: eventType });
        doc.monitoring = monResult.monitoring;
        await withRetry(() => doc.save());

        // Stage 7 Outcome & Stage 8 Rating aggregations
        await advanceContext(doc);
      }
    } finally {
      await releaseLock(doc);
    }
  });
}

/**
 * Heartbeat worker execution lock maintenance loop.
 */
async function runHeartbeatMaintenance() {
  try {
    const lockedDocs = await SignalValidationContextModel.find({
      "processing.lockedBy": activeWorkerId
    });
    for (const doc of lockedDocs) {
      doc.processing.heartbeat = new Date();
      await doc.save().catch(() => {});
    }
  } catch (err) {
    logger.error("worker.heartbeat_maintenance_failed", { error: err.message });
  }
}

/**
 * Startup self-healing recovery loop.
 */
async function runStartupRecovery() {
  logger.info("worker.startup_recovery_triggered", { activeWorkerId });
  try {
    const incompleteDocs = await SignalValidationContextModel.find({
      $or: [
        { pipelineStatus: { $ne: "COMPLETED" } },
        { "rating.processed": false }
      ]
    });

    for (const doc of incompleteDocs) {
      enqueue(doc.signalId, async () => {
        const lockedDoc = await acquireLock(doc.signalId);
        if (!lockedDoc) return;
        try {
          await advanceContext(lockedDoc);
        } finally {
          await releaseLock(lockedDoc);
        }
      });
    }
  } catch (err) {
    logger.error("worker.startup_recovery_failed", { error: err.message });
  }
}

/**
 * Activates orchestrator listeners.
 */
export async function start() {
  if (isRunning) return;
  isRunning = true;

  // Bind Emitters
  validationEvents.on("validationContextCreated", handleContextCreated);
  priceEvents.on("pricesUpdated", handlePricesUpdated);
  mt5Events.on("tradeEvent", handleTradeEvent);

  // Initialize recovery sequence
  await runStartupRecovery();

  // Schedule Heartbeats
  heartbeatTimer = setInterval(runHeartbeatMaintenance, HEARTBEAT_INTERVAL_MS);
  logger.info("worker.started", { activeWorkerId });
}

/**
 * Disables orchestrator listeners.
 */
export async function stop() {
  if (!isRunning) return;
  isRunning = false;

  validationEvents.off("validationContextCreated", handleContextCreated);
  priceEvents.off("pricesUpdated", handlePricesUpdated);
  mt5Events.off("tradeEvent", handleTradeEvent);

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  logger.info("worker.stopped", { activeWorkerId });
}

/**
 * Pipeline orchestrator worker health metrics.
 */
export function health() {
  return {
    activeWorkerId,
    isRunning,
    queueSize: signalQueues.size,
    dbConnectionState: mongoose.connection.readyState
  };
}

/**
 * Pipeline orchestrator worker processing stats.
 */
export function status() {
  return {
    activeWorkerId,
    isRunning,
    totalProcessedCount,
    lockAcquisitionFailures,
    deduplicatedEventsCount: processedEventIds.size
  };
}
