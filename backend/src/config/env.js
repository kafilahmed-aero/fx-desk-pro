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
  },
};
