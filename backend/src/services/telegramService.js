import fs from "node:fs";
import path from "node:path";
import input from "input";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

let telegramClient = null;
const channelEntityCache = new Map();

// telegramService prepares GramJS and owns Telegram login/fetch workflows.
// Future noise filtering, parsing, and consensus services should call this file
// instead of creating Telegram clients directly.
export function createTelegramClient() {
  if (telegramClient) {
    return telegramClient;
  }

  if (!config.telegram.apiId || !config.telegram.apiHash) {
    logger.info("telegram.credentials_missing");
    return null;
  }

  telegramClient = new TelegramClient(
    new StringSession(config.telegram.session),
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 5,
    }
  );

  logger.debug("telegram.client_created");
  return telegramClient;
}

export function getTelegramClient() {
  return telegramClient || createTelegramClient();
}

export async function connectTelegramClient() {
  const client = getTelegramClient();

  if (!client) {
    throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in backend/.env");
  }

  try {
    await client.start({
      phoneNumber: async () => {
        logger.debug("telegram.login_waiting_for_phone_number");
        const phoneNumber = await input.text(
          "Enter your Telegram phone number with country code: "
        );
        logger.debug("telegram.login_sending_otp");
        return phoneNumber;
      },
      phoneCode: async () => {
        logger.debug("telegram.login_waiting_for_otp");
        return input.text("Enter the Telegram OTP code: ");
      },
      password: async () => {
        logger.debug("telegram.login_waiting_for_2fa_password");
        return input.password("Enter your Telegram 2FA password: ");
      },
      onError: (error) => {
        logger.error("telegram.login_error", {
          error: formatTelegramError(error),
        });
      },
    });

    logger.info("telegram.login_successful");

    const session = client.session.save();
    saveTelegramSession(session);
    logger.info("telegram.session_saved");

    return client;
  } catch (error) {
    throw new Error(`Telegram connection failed: ${formatTelegramError(error)}`, {
      cause: error,
    });
  }
}

export async function connectTelegramWithSavedSession() {
  const client = getTelegramClient();

  if (!client) {
    throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in backend/.env");
  }

  if (!config.telegram.session) {
    throw new Error(
      "Missing TELEGRAM_SESSION. Run npm run telegram:test once to log in and save a session."
    );
  }

  try {
    if (!client.connected) {
      await client.connect();
    }

    await client.getMe();
    return client;
  } catch (error) {
    throw new Error(`Saved Telegram session connection failed: ${formatTelegramError(error)}`, {
      cause: error,
    });
  }
}

export async function fetchRecentChannelMessages(
  channel = config.telegram.testChannel,
  limit = 5
) {
  if (!channel || channel === "channelusername") {
    throw new Error(
      "Set TELEGRAM_TEST_CHANNEL in backend/.env to a real public channel username"
    );
  }

  const client = await connectTelegramClient();

  try {
    logger.info("telegram.fetch_recent_started", { channel });
    const channelEntity = await resolveTelegramChannelEntity(client, channel);

    const messages = await client.getMessages(channelEntity.entity, {
      limit,
    });

    logger.info("telegram.fetch_recent_complete", {
      channel,
      messageCount: messages.length,
    });

    messages.forEach((message, index) => {
      printMessageSummary(message, index, channel);
    });

    return messages;
  } catch (error) {
    throw new Error(`Failed to fetch Telegram messages: ${formatTelegramError(error)}`, {
      cause: error,
    });
  }
}

export async function resolveTelegramChannelEntity(client, channelRef) {
  if (!isTelegramInviteLink(channelRef)) {
    const normalizedChannelRef = normalizePublicChannelRef(channelRef);

    if (channelEntityCache.has(normalizedChannelRef)) {
      return channelEntityCache.get(normalizedChannelRef);
    }

    const resolved = await resolvePublicChannelEntity(client, normalizedChannelRef);
    channelEntityCache.set(normalizedChannelRef, resolved);
    return resolved;
  }

  if (channelEntityCache.has(channelRef)) {
    return channelEntityCache.get(channelRef);
  }

  const inviteHash = extractTelegramInviteHash(channelRef);

  if (!inviteHash) {
    throw new Error(`Invalid Telegram invite link: ${channelRef}`);
  }

  const joinedEntity = await joinOrResolvePrivateInvite(client, inviteHash);
  const resolved = {
    entity: joinedEntity,
    channelId: getEntityId(joinedEntity),
    channelLabel: createPrivateChannelLabel(joinedEntity),
    channelUsername: getEntityUsername(joinedEntity),
    channelTitle: getEntityDisplayName(joinedEntity),
    isPrivateInvite: true,
  };

  channelEntityCache.set(channelRef, resolved);
  logger.debug("telegram.private_channel_connected");

  return resolved;
}

async function resolvePublicChannelEntity(client, channelRef) {
  try {
    const entity = await client.getEntity(channelRef);

    return {
      entity,
      channelId: getEntityId(entity),
      channelLabel: getEntityUsername(entity) || channelRef,
      channelUsername: getEntityUsername(entity),
      channelTitle: getEntityDisplayName(entity),
      isPrivateInvite: false,
    };
  } catch (error) {
    logger.debug("telegram.public_channel_entity_resolution_skipped", {
      channel: channelRef,
      error: formatTelegramError(error),
    });

    return {
      entity: channelRef,
      channelId: null,
      channelLabel: channelRef,
      channelUsername: channelRef,
      channelTitle: channelRef,
      isPrivateInvite: false,
    };
  }
}

async function joinOrResolvePrivateInvite(client, inviteHash) {
  try {
    const result = await client.invoke(
      new Api.messages.ImportChatInvite({
        hash: inviteHash,
      })
    );
    const joinedChat = result?.chats?.[0];

    if (joinedChat) {
      return joinedChat;
    }
  } catch (error) {
    const message = error?.message || String(error);

    if (!message.includes("USER_ALREADY_PARTICIPANT")) {
      if (message.includes("INVITE_REQUEST_SENT")) {
        throw new Error("Private Telegram test channel requires admin approval", {
          cause: error,
        });
      }

      throw error;
    }
  }

  const invite = await client.invoke(
    new Api.messages.CheckChatInvite({
      hash: inviteHash,
    })
  );

  if (invite?.chat) {
    return invite.chat;
  }

  throw new Error("Private Telegram test channel is not readable by the saved session");
}

function saveTelegramSession(session) {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    throw new Error("Cannot save Telegram session because backend/.env was not found");
  }

  const envContent = fs.readFileSync(envPath, "utf8");
  const sessionLine = `TELEGRAM_SESSION=${session}`;
  const updatedContent = envContent.match(/^TELEGRAM_SESSION=/m)
    ? envContent.replace(/^TELEGRAM_SESSION=.*$/m, sessionLine)
    : `${envContent.trimEnd()}\n${sessionLine}\n`;

  fs.writeFileSync(envPath, updatedContent);
}

function printMessageSummary(message, index, fallbackChannel) {
  const timestamp = formatMessageDate(message.date);
  const sender = getMessageSender(message, fallbackChannel);
  const text = message.message || "[non-text message]";

  logger.debug("telegram.message_summary", {
    index: index + 1,
    timestamp,
    sender,
    text,
  });
}

function formatMessageDate(date) {
  if (date instanceof Date) {
    return date.toISOString();
  }

  if (typeof date === "number") {
    return new Date(date * 1000).toISOString();
  }

  return "unknown";
}

function getMessageSender(message, fallbackChannel) {
  if (message.chat?.title) {
    return message.chat.title;
  }

  if (message.sender?.username) {
    return `@${message.sender.username}`;
  }

  if (message.senderId) {
    return String(message.senderId);
  }

  return fallbackChannel;
}

function isTelegramInviteLink(value) {
  return /(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)[A-Za-z0-9_-]+/i.test(
    String(value || "")
  );
}

function normalizePublicChannelRef(value) {
  const trimmedValue = String(value || "").trim();
  const match = trimmedValue.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)\/?$/i);

  return match?.[1] || trimmedValue.replace(/^@/, "");
}

function extractTelegramInviteHash(value) {
  const match = String(value || "").match(
    /(?:https?:\/\/)?t\.me\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)/i
  );

  return match?.[1] || null;
}

function createPrivateChannelLabel(entity) {
  const id = entity?.id || entity?.channelId || entity?.chatId || "unknown";
  return `private-test-channel:${id}`;
}

function getEntityDisplayName(entity) {
  return (
    entity?.title ||
    entity?.username ||
    entity?.firstName ||
    entity?.id ||
    null
  );
}

function getEntityUsername(entity) {
  return entity?.username || entity?.usernames?.[0]?.username || null;
}

function getEntityId(entity) {
  const id = entity?.id || entity?.channelId || entity?.chatId || null;

  return id === null ? null : String(id);
}

function formatTelegramError(error) {
  const message = error?.message || String(error);

  if (message.includes("PHONE_CODE_INVALID")) {
    return "Invalid OTP code. Please run the test again and enter the latest code.";
  }

  if (message.includes("PHONE_CODE_EXPIRED")) {
    return "Expired OTP code. Please request a fresh code and run the test again.";
  }

  if (message.includes("SESSION_REVOKED") || message.includes("AUTH_KEY")) {
    return "Telegram session expired or was revoked. Clear TELEGRAM_SESSION and log in again.";
  }

  if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
    return "Telegram connection failed. Check your internet connection and try again.";
  }

  return message;
}
