import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config/env.js";

let telegramClient = null;

// services hold reusable integrations and business workflows.
// This file prepares GramJS for future Telegram message fetching.
export function createTelegramClient() {
  if (telegramClient) {
    return telegramClient;
  }

  if (!config.telegram.apiId || !config.telegram.apiHash) {
    console.log("Telegram client status: waiting for API credentials");
    return null;
  }

  const stringSession = new StringSession(config.telegram.session);

  telegramClient = new TelegramClient(
    stringSession,
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 5,
    }
  );

  console.log("Telegram client status: prepared with API credentials");

  return telegramClient;
}

export function getTelegramClient() {
  return telegramClient || createTelegramClient();
}
