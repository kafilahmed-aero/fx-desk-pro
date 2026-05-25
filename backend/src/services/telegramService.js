import fs from "node:fs";
import path from "node:path";
import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config/env.js";

let telegramClient = null;

// telegramService prepares GramJS and owns Telegram login/fetch workflows.
// Future noise filtering, parsing, and consensus services should call this file
// instead of creating Telegram clients directly.
export function createTelegramClient() {
  if (telegramClient) {
    return telegramClient;
  }

  if (!config.telegram.apiId || !config.telegram.apiHash) {
    console.log("Telegram client status: waiting for API credentials");
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

  console.log("Starting Telegram client");
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
        console.log("Waiting for phone number");
        const phoneNumber = await input.text(
          "Enter your Telegram phone number with country code: "
        );
        console.log("Sending OTP");
        return phoneNumber;
      },
      phoneCode: async () => {
        console.log("Waiting for OTP");
        return input.text("Enter the Telegram OTP code: ");
      },
      password: async () => {
        console.log("Waiting for 2FA password");
        return input.password("Enter your Telegram 2FA password: ");
      },
      onError: (error) => {
        console.error(`Telegram login error: ${formatTelegramError(error)}`);
      },
    });

    console.log("Telegram client connected");
    console.log("Telegram login successful");

    const session = client.session.save();
    saveTelegramSession(session);
    console.log("Telegram session saved successfully");

    return client;
  } catch (error) {
    throw new Error(`Telegram connection failed: ${formatTelegramError(error)}`);
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
    throw new Error(`Saved Telegram session connection failed: ${formatTelegramError(error)}`);
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
    console.log(`Fetching messages from ${channel}`);

    const messages = await client.getMessages(channel, {
      limit,
    });

    console.log("Messages fetched successfully");
    console.log(`Latest ${messages.length} messages from ${channel}:`);

    messages.forEach((message, index) => {
      printMessageSummary(message, index, channel);
    });

    return messages;
  } catch (error) {
    throw new Error(`Failed to fetch Telegram messages: ${formatTelegramError(error)}`);
  }
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

  console.log(`\nMessage ${index + 1}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Sender/Channel: ${sender}`);
  console.log(`Text: ${text}`);
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
