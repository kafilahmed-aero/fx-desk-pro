// src/config keeps environment-backed settings in one place.
// Other files import this object instead of reading process.env directly.
export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  mongoUri:
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/telegram_signal_consensus",
  telegram: {
    apiId: Number(process.env.TELEGRAM_API_ID) || null,
    apiHash: process.env.TELEGRAM_API_HASH || "",
    session: process.env.TELEGRAM_SESSION || "",
    testChannel: process.env.TELEGRAM_TEST_CHANNEL || "telegram",
    channels: (process.env.TELEGRAM_CHANNELS || "")
      .split(",")
      .map((channel) => channel.trim())
      .filter(Boolean),
    pollIntervalMs: Number(process.env.TELEGRAM_POLL_INTERVAL_MS) || 30000,
    pollLimit: Number(process.env.TELEGRAM_POLL_LIMIT) || 10,
  },
  pipeline: {
    processingConcurrency: Math.max(
      1,
      Number(process.env.MESSAGE_PROCESSING_CONCURRENCY) || 2
    ),
    maxQueueSize: Math.max(
      50,
      Number(process.env.MESSAGE_PROCESSING_MAX_QUEUE_SIZE) || 500
    ),
  },
  marketEngine: {
    refreshIntervalMs: Math.max(
      5000,
      Number(process.env.MARKET_ENGINE_REFRESH_INTERVAL_MS) || 30000
    ),
    cleanupIntervalMs: Math.max(
      30000,
      Number(process.env.MARKET_ENGINE_CLEANUP_INTERVAL_MS) || 300000
    ),
    expiredRetentionMinutes: Math.max(
      1,
      Number(process.env.MARKET_ENGINE_EXPIRED_RETENTION_MINUTES) || 180
    ),
    maxSignalsPerPair: Math.max(
      25,
      Number(process.env.MARKET_ENGINE_MAX_SIGNALS_PER_PAIR) || 250
    ),
  },
};
