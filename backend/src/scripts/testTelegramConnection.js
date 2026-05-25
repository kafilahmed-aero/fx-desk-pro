console.log("Loading env");

await import("dotenv/config");

const { config } = await import("../config/env.js");
const {
  connectTelegramClient,
  fetchRecentChannelMessages,
} = await import("../services/telegramService.js");

// Run with: npm run telegram:test
// This logs in and saves a Telegram StringSession. If TELEGRAM_TEST_CHANNEL is
// configured, it also proves the backend can read recent channel messages.
async function testTelegramConnection() {
  try {
    if (!config.telegram.session) {
      await connectTelegramClient();
      return;
    }

    if (hasTestChannel(config.telegram.testChannel)) {
      await fetchRecentChannelMessages(config.telegram.testChannel, 5);
      console.log("Telegram connection test complete");
      return;
    }

    await connectTelegramClient();
    console.log("Telegram connection test complete");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

await testTelegramConnection();

function hasTestChannel(channel) {
  return Boolean(channel && channel !== "channelusername");
}
