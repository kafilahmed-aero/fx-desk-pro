// src/config keeps environment-backed settings in one place.
// Other files import this object instead of reading process.env directly.
const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const productionClientUrl = "https://fx-desk-pro.vercel.app";
const developmentClientUrls = ["http://localhost:5173", "http://127.0.0.1:5173"];
const configuredClientUrls = (process.env.CLIENT_URL || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const clientUrls = [
  ...new Set([
    ...configuredClientUrls,
    productionClientUrl,
    ...(!isProduction ? developmentClientUrls : []),
  ]),
];

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv,
  isProduction,
  logLevel: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  clientUrl: clientUrls[0],
  clientUrls,
  auth: {
    jwtSecret:
      process.env.AUTH_JWT_SECRET ||
      (isProduction ? "" : "development-only-change-this-private-beta-secret"),
    cookieName: process.env.AUTH_COOKIE_NAME || "fx_desk_session",
    tokenIssuer: "fx-desk-pro",
    users: parseAuthUsers(),
  },
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
  liveValidation: {
    intervalMs: Math.max(
      10000,
      Number(process.env.LIVE_VALIDATION_INTERVAL_MS) || 60000
    ),
    durationMs: Math.max(
      0,
      Number(process.env.LIVE_VALIDATION_DURATION_MS) || 0
    ),
  },
};

validateProductionConfig();

function parseAuthUsers() {
  const simpleEnvUser =
    process.env.AUTH_EMAIL && process.env.AUTH_PASSWORD
      ? {
          email: process.env.AUTH_EMAIL.trim().toLowerCase(),
          password: process.env.AUTH_PASSWORD,
          name: process.env.AUTH_NAME || "FX Trader",
        }
      : null;

  const configuredUsers = (process.env.AUTH_USERS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [email, password, name] = entry.split(":").map((value) => value?.trim());

      if (!email || !password) {
        return null;
      }

      return {
        email: email.toLowerCase(),
        password,
        name: name || "FX Trader",
      };
    })
    .filter(Boolean);

  if (simpleEnvUser) {
    return [
      simpleEnvUser,
      ...configuredUsers.filter((user) => user.email !== simpleEnvUser.email),
    ];
  }

  if (isProduction) {
    return [];
  }

  return [
    {
      email: (process.env.AUTH_EMAIL || "trader@example.com").toLowerCase(),
      password: process.env.AUTH_PASSWORD || "password",
      name: process.env.AUTH_NAME || "FX Trader",
    },
  ];
}

function validateProductionConfig() {
  if (!isProduction) {
    return;
  }

  const errors = [];

  if (!config.clientUrls.includes(productionClientUrl)) {
    errors.push(`CLIENT_URL must allow the production frontend origin: ${productionClientUrl}.`);
  }

  if (!config.auth.jwtSecret || config.auth.jwtSecret.length < 32) {
    errors.push("AUTH_JWT_SECRET must be set to a strong secret of at least 32 characters.");
  }

  if (config.auth.users.length === 0) {
    errors.push("AUTH_USERS or AUTH_EMAIL/AUTH_PASSWORD must be set for private beta access.");
  }

  if (config.telegram.channels.length > 0) {
    if (!config.telegram.apiId || !config.telegram.apiHash) {
      errors.push("TELEGRAM_API_ID and TELEGRAM_API_HASH are required when TELEGRAM_CHANNELS is set.");
    }

    if (!config.telegram.session) {
      errors.push("TELEGRAM_SESSION is required when TELEGRAM_CHANNELS is set.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Production configuration error: ${errors.join(" ")}`);
  }
}
