await import("dotenv/config");

const input = (await import("input")).default;
const { TelegramClient } = await import("telegram");
const { StringSession } = await import("telegram/sessions/index.js");
const { config } = await import("../config/env.js");

// Run with:
// node src/scripts/regenerateTelegramSession.js
//
// This intentionally does not save to .env. Copy the final TELEGRAM_SESSION value
// only after the login is verified.
async function regenerateTelegramSession() {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in backend/.env");
  }

  const client = new TelegramClient(
    new StringSession(""),
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 5,
    }
  );

  await client.start({
    phoneNumber: () =>
      input.text("Enter your Telegram phone number with country code: "),
    phoneCode: () => input.text("Enter the Telegram OTP code: "),
    password: () => input.password("Enter your Telegram 2FA password: "),
    onError: (error) => {
      throw error;
    },
  });

  const me = await client.getMe();

  if (!me?.id) {
    throw new Error("Telegram login verification failed");
  }

  const session = client.session.save();
  await client.disconnect();

  if (!session) {
    throw new Error("Telegram login succeeded but no session string was generated");
  }

  console.log(`TELEGRAM_SESSION=${session}`);
}

try {
  await regenerateTelegramSession();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
