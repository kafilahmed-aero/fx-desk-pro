import "dotenv/config";
import { connectTelegramWithSavedSession } from "../src/services/telegramService.js";

async function main() {
  console.log("Connecting Telegram...");
  const client = await connectTelegramWithSavedSession();
  
  // Try to find the test channel in the dialogs list
  console.log("Fetching dialogs...");
  const dialogs = await client.getDialogs();
  
  let targetEntity = null;
  for (const d of dialogs) {
    if (d.title && d.title.includes("Fx-test-feed")) {
      targetEntity = d.entity;
      break;
    }
  }

  if (!targetEntity) {
    // Try to resolve by ID directly if we know it
    try {
      console.log("Attempting to get channel entity by ID...");
      targetEntity = await client.getEntity(-1003955968449);
    } catch (e) {
      console.log("Could not get by ID:", e.message);
    }
  }

  if (!targetEntity) {
    throw new Error("Could not find Fx-test-feed channel in dialogs or by ID.");
  }

  console.log("Resolved entity:", targetEntity.title || targetEntity.username || targetEntity.id);

  const signalText = `Fx-test-feed test signal:\n\nGOLD (XAUUSD)\nBUY: 2400.00\nStop Loss: 2390.00\n\nTake Profit 1: 2410.00\nTake Profit 2: 2420.00\nTake Profit 3: 2430.00`;

  console.log("Sending signal message to channel...");
  await client.sendMessage(targetEntity, { message: signalText });
  console.log("Signal message sent successfully!");
  process.exit(0);
}

main().catch(console.error);
