import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

async function checkTelegramJoinedChannels() {
  console.log('====================================================');
  console.log('  Checking Telegram Session Joined Channels List   ');
  console.log('====================================================\n');

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash || !sessionString) {
    console.error('Telegram credentials missing in .env!');
    return;
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    console.log('✓ Telegram Client Connected Successfully.\n');

    const dialogs = await client.getDialogs({});
    console.log(`Found ${dialogs.length} total channels & chats in Telegram session:\n`);

    let foundTarget = false;
    dialogs.forEach((d) => {
      const title = d.title || d.name || 'Unnamed';
      if (title.toLowerCase().includes('gold') || title.toLowerCase().includes('sure') || title.toLowerCase().includes('signal')) {
        console.log(`  📢 [CHANNEL] "${title}" (ID: ${d.id})`);
      }
      if (title.toLowerCase().includes('gold sure')) {
        foundTarget = true;
      }
    });

    console.log('\n----------------------------------------------------');
    if (foundTarget) {
      console.log('✅ "GOLD SURE SIGNALS" IS NOW CONFIRMED JOINED & ACTIVE IN TELEGRAM SESSION!');
    } else {
      console.log('ℹ️ Listed above are all matched channels in your account.');
    }
    console.log('----------------------------------------------------\n');

    await client.disconnect();
  } catch (err) {
    console.error('Telegram Check Exception:', err.message);
  }
}

checkTelegramJoinedChannels();
