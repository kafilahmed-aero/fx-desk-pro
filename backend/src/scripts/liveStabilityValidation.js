console.log("Loading env");

await import("dotenv/config");

const { connectDatabase } = await import("../config/database.js");
const { config } = await import("../config/env.js");
const {
  startMarketEngine,
  stopMarketEngine,
} = await import("../services/marketEngineService.js");
const {
  startTelegramListener,
  stopTelegramListener,
} = await import("../services/telegramIngestionService.js");
const { getLiveStabilitySnapshot } = await import("../services/liveStabilityService.js");

let snapshotTimer = null;
let stopTimer = null;
let shuttingDown = false;

console.log("Continuous live stability validation");
console.log(`Configured channels: ${config.telegram.channels.join(", ") || "(none)"}`);
console.log(`Snapshot interval: ${config.liveValidation.intervalMs}ms`);
console.log(
  `Duration: ${config.liveValidation.durationMs > 0 ? `${config.liveValidation.durationMs}ms` : "until stopped"}`
);

await runLiveStabilityValidation();

async function runLiveStabilityValidation() {
  await connectDatabase();
  startMarketEngine();
  await startTelegramListener();

  printSnapshot();
  snapshotTimer = setInterval(printSnapshot, config.liveValidation.intervalMs);

  if (config.liveValidation.durationMs > 0) {
    stopTimer = setTimeout(() => {
      shutdown(0).catch((error) => {
        console.error(`Shutdown failed: ${error.message}`);
        process.exit(1);
      });
    }, config.liveValidation.durationMs);
  }

  process.on("SIGINT", () => {
    shutdown(0).catch((error) => {
      console.error(`Shutdown failed: ${error.message}`);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown(0).catch((error) => {
      console.error(`Shutdown failed: ${error.message}`);
      process.exit(1);
    });
  });
}

function printSnapshot() {
  const snapshot = getLiveStabilitySnapshot();

  console.log("[LIVE VALIDATION]");
  console.log(
    JSON.stringify({
      timestamp: snapshot.timestamp,
      status: snapshot.status,
      overview: snapshot.overview,
      telegram: {
        listenerRunning: snapshot.telegram.listenerRunning,
        pollingInProgress: snapshot.telegram.pollingInProgress,
        pollCycles: snapshot.telegram.pollCycles,
        messagesFetched: snapshot.telegram.messagesFetched,
        messagesStored: snapshot.telegram.messagesStored,
        messagesQueued: snapshot.telegram.messagesQueued,
        duplicateMessages: snapshot.telegram.duplicateMessages,
        channelFetchFailures: snapshot.telegram.channelFetchFailures,
        reconnectAttempts: snapshot.telegram.reconnectAttempts,
        lastError: snapshot.telegram.lastError,
      },
      marketEngine: {
        refreshCycles: snapshot.marketEngine.refreshCycles,
        cleanupCycles: snapshot.marketEngine.cleanupCycles,
        lastPairCount: snapshot.marketEngine.lastPairCount,
        lastCleanupRemovedCount: snapshot.marketEngine.lastCleanupRemovedCount,
        refreshFailures: snapshot.marketEngine.refreshFailures,
        cleanupFailures: snapshot.marketEngine.cleanupFailures,
      },
      queue: snapshot.queue,
      memoryMb: snapshot.process.memoryMb,
      opportunities: snapshot.opportunities.slice(0, 5),
    })
  );
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }

  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }

  stopMarketEngine();
  await stopTelegramListener();
  console.log("Live stability validation stopped");
  process.exit(exitCode);
}
