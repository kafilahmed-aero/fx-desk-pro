import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { connectTelegramWithSavedSession } from '../src/services/telegramService.js';

// The formatted message provided by you (retaining all exact words)
const MESSAGE_TEXT = `Hi!

I've built a platform called FX Desk that collects only the trading signals from multiple Telegram channels into one clean dashboard by filtering out promotions and other non-signal messages. I think it could add value for traders and also be a good opportunity for us to work together.

If you're interested, I'd be happy to share a few screenshots. If you like it and we're able to work out a deal, I'll also give you free access to the platform so you can review everything yourself before we discuss pricing or revenue sharing.

Let me know what you think!`;

const CONTACTS_FILE = 'scratch/extracted_contacts.json';
const PROGRESS_FILE = 'scratch/sending_progress.json';

async function run() {
  console.log("=== TELEGRAM OUTREACH SYSTEM ===");
  
  if (!fs.existsSync(CONTACTS_FILE)) {
    console.error(`Error: ${CONTACTS_FILE} not found. Please run the extraction script first.`);
    return;
  }

  // Load contacts
  const channels = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
  
  // Extract unique handles and map them to their primary channel info
  const contactMap = new Map();
  for (const c of channels) {
    if (c.contacts && c.contacts.length > 0) {
      for (const contact of c.contacts) {
        if (!contactMap.has(contact)) {
          contactMap.set(contact, {
            channelName: c.title || c.ref,
            channelUser: c.username || c.ref
          });
        }
      }
    }
  }

  const allContacts = Array.from(contactMap.keys());
  console.log(`Total unique contact handles loaded: ${allContacts.length}`);

  // Load or initialize progress
  let progress = {};
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    console.log(`Resumed progress loaded. Already sent to: ${Object.keys(progress).length} contacts.`);
  } else {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({}, null, 2), 'utf8');
  }

  // Filter unsent contacts
  const unsentContacts = allContacts.filter(handle => !progress[handle]);
  console.log(`Remaining contacts to message: ${unsentContacts.length}`);

  if (unsentContacts.length === 0) {
    console.log("All contacts have already been messaged. Nothing to do.");
    return;
  }

  // Connect to Telegram Client
  console.log("\nConnecting to Telegram using saved session...");
  const client = await connectTelegramWithSavedSession();
  console.log("Telegram connected successfully!");

  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  let index = 0;
  for (const handle of unsentContacts) {
    index++;
    const info = contactMap.get(handle);
    const cleanHandle = handle.replace(/^@/, '');
    
    console.log(`\n[${index}/${unsentContacts.length}] Preparing to send to ${handle} (Channel: ${info.channelName})...`);
    
    try {
      // 1. Resolve peer and send message
      await client.sendMessage(cleanHandle, { message: MESSAGE_TEXT });
      
      // 2. Mark as sent in progress
      progress[handle] = {
        sentAt: new Date().toISOString(),
        status: 'success',
        channel: info.channelName
      };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
      
      console.log(`✅ Message successfully sent to ${handle}`);

    } catch (error) {
      console.error(`❌ Failed to send to ${handle}: ${error.message}`);
      
      // Mark as failed in progress to avoid infinite retries on invalid handles
      progress[handle] = {
        sentAt: new Date().toISOString(),
        status: `failed (${error.message})`,
        channel: info.channelName
      };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
    }

    // Skip delay if it's the last contact
    if (index < unsentContacts.length) {
      // Safe random delay between 90 and 180 seconds (1.5 to 3 minutes)
      const delaySec = Math.floor(Math.random() * (180 - 90 + 1)) + 90;
      console.log(`Waiting for ${delaySec} seconds before the next message to avoid Telegram spam limits...`);
      
      // Countdown progress log every 30 seconds
      let remaining = delaySec;
      while (remaining > 0) {
        await delay(Math.min(remaining, 30) * 1000);
        remaining -= 30;
        if (remaining > 0) {
          console.log(`  -> ${remaining} seconds remaining...`);
        }
      }
    }
  }

  console.log("\n=== OUTREACH WORKFLOW COMPLETE ===");
  const successCount = Object.values(progress).filter(p => p.status === 'success').length;
  console.log(`Summary: Successfully messaged ${successCount} contacts total.`);
}

run().catch(error => {
  console.error("Fatal Error in Messaging Script:", error);
});
