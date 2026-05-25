import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { processRawMessage } from "./signalProcessingService.js";

const queue = [];
const queuedKeys = new Set();
let activeWorkers = 0;
let droppedCount = 0;

export function enqueueRawMessageProcessing(rawMessage) {
  const key = createMessageKey(rawMessage);

  if (queuedKeys.has(key)) {
    return {
      queued: false,
      duplicate: true,
      queueSize: queue.length,
    };
  }

  if (queue.length >= config.pipeline.maxQueueSize) {
    droppedCount += 1;
    logger.error("pipeline.queue_full", {
      messageKey: key,
      queueSize: queue.length,
      maxQueueSize: config.pipeline.maxQueueSize,
      droppedCount,
    });

    return {
      queued: false,
      dropped: true,
      queueSize: queue.length,
    };
  }

  queue.push({
    key,
    rawMessage,
  });
  queuedKeys.add(key);
  drainQueue();

  return {
    queued: true,
    queueSize: queue.length,
  };
}

export function getProcessingQueueStatus() {
  return {
    queued: queue.length,
    activeWorkers,
    droppedCount,
    maxQueueSize: config.pipeline.maxQueueSize,
    concurrency: config.pipeline.processingConcurrency,
  };
}

function drainQueue() {
  while (
    activeWorkers < config.pipeline.processingConcurrency &&
    queue.length > 0
  ) {
    const item = queue.shift();
    activeWorkers += 1;

    processQueueItem(item)
      .catch((error) => {
        logger.error("pipeline.worker_failed", {
          messageKey: item.key,
          error: error.message,
        });
      })
      .finally(() => {
        queuedKeys.delete(item.key);
        activeWorkers -= 1;
        drainQueue();
      });
  }
}

async function processQueueItem(item) {
  logger.info("pipeline.message_processing_started", {
    messageKey: item.key,
    queueSize: queue.length,
    activeWorkers,
  });

  await processRawMessage(item.rawMessage);
}

function createMessageKey(rawMessage) {
  return `${rawMessage?.channel || "unknown"}:${rawMessage?.messageId || "unknown"}`;
}
