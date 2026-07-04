// src/config keeps environment-backed settings in one place.
// Other files import this object instead of reading process.env directly.
import {
  getMonitoredTelegramChannelRefs,
  monitoredTelegramChannels,
} from "./telegramChannels.js";

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
const authUsers = parseAuthUsers();

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv,
  isProduction,
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  logLevel: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  clientUrl: clientUrls[0],
  clientUrls,
  auth: {
    jwtSecret:
      process.env.AUTH_JWT_SECRET ||
      (isProduction ? "" : "development-only-change-this-private-beta-secret"),
    cookieName: process.env.AUTH_COOKIE_NAME || "fx_desk_session",
    tokenIssuer: "fx-desk-pro",
    users: authUsers,
  },
  mongoUri:
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/telegram_signal_consensus",
  signalExpirationMinutes: Number(process.env.SIGNAL_EXPIRATION_MINUTES) || 60,
  telegram: {
    apiId: Number(process.env.TELEGRAM_API_ID) || null,
    apiHash: process.env.TELEGRAM_API_HASH || "",
    session: process.env.TELEGRAM_SESSION || "",
    testChannel: process.env.TELEGRAM_TEST_CHANNEL || "telegram",
    channelConfigs: monitoredTelegramChannels,
    channels: getMonitoredTelegramChannelRefs(),
    pollIntervalMs: Number(process.env.TELEGRAM_POLL_INTERVAL_MS) || 30000,
    pollLimit: Number(process.env.TELEGRAM_POLL_LIMIT) || 10,
    backfillHours: Number(process.env.TELEGRAM_BACKFILL_HOURS) || 2,
    backfillLimit: Number(process.env.TELEGRAM_BACKFILL_LIMIT) || 200,
  },
  telegramAlert: {
    botToken: process.env.TELEGRAM_ALERT_BOT_TOKEN || "",
    channelId: process.env.TELEGRAM_ALERT_CHANNEL_ID || "",
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
      Number(process.env.MARKET_ENGINE_EXPIRED_RETENTION_MINUTES) || 120
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
  const jsonUsers = parseAuthUsersJson();

  if (jsonUsers) {
    return jsonUsers;
  }

  const simpleEnvUser =
    process.env.AUTH_EMAIL && process.env.AUTH_PASSWORD
      ? {
          email: process.env.AUTH_EMAIL.trim().toLowerCase(),
          password: process.env.AUTH_PASSWORD,
          name: process.env.AUTH_NAME || "FX Trader",
        }
      : null;

  if (simpleEnvUser) {
    return [simpleEnvUser];
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

function parseAuthUsersJson() {
  const rawValue = String(process.env.AUTH_USERS_JSON || "").trim();

  if (!rawValue) {
    return null;
  }

  let parsedUsers;

  try {
    parsedUsers = JSON.parse(rawValue);
  } catch {
    throw new Error(
      "AUTH_USERS_JSON must be valid JSON: an array of { email, password, name } objects."
    );
  }

  if (!Array.isArray(parsedUsers)) {
    throw new Error("AUTH_USERS_JSON must be an array of user objects.");
  }

  const users = parsedUsers.map(normalizeAuthUser).filter(Boolean);

  if (users.length !== parsedUsers.length) {
    throw new Error(
      "AUTH_USERS_JSON contains an invalid user. Each user needs a valid email and password."
    );
  }

  const duplicateEmail = findDuplicateEmail(users);

  if (duplicateEmail) {
    throw new Error(`AUTH_USERS_JSON contains a duplicate email: ${duplicateEmail}.`);
  }

  return users;
}

function normalizeAuthUser(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    return null;
  }

  const email = String(user.email || "").trim().toLowerCase();
  const password = typeof user.password === "string" ? user.password : "";
  const name = String(user.name || "").trim() || "FX Trader";

  if (!isValidEmail(email) || !password) {
    return null;
  }

  return {
    email,
    password,
    name,
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function findDuplicateEmail(users) {
  const seenEmails = new Set();

  for (const user of users) {
    if (seenEmails.has(user.email)) {
      return user.email;
    }

    seenEmails.add(user.email);
  }

  return null;
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
    errors.push("AUTH_USERS_JSON or AUTH_EMAIL/AUTH_PASSWORD must be set for private beta access.");
  }

  if (config.telegram.channels.length > 0) {
    if (!config.telegram.apiId || !config.telegram.apiHash) {
      errors.push(
        "TELEGRAM_API_ID and TELEGRAM_API_HASH are required when monitored Telegram channels are configured."
      );
    }

    if (!config.telegram.session) {
      errors.push("TELEGRAM_SESSION is required when monitored Telegram channels are configured.");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Production configuration error: ${errors.join(" ")}`);
  }
}
