import "dotenv/config";
import { sendTelegramAlert } from "../services/telegramAlertService.js";
import { logger } from "../utils/logger.js";

async function runTest() {
  console.log("Starting Telegram Alert verification test...");
  
  const testPair = "EURUSD";
  const testAction = "BUY";
  const testSignalCount = 4;
  const testMessageKey = `test_channel:${Date.now()}`;

  console.log(`Sending alert for ${testPair} ${testAction} (signals: ${testSignalCount}) with key ${testMessageKey}...`);
  
  await sendTelegramAlert(testPair, testAction, testSignalCount, testMessageKey);
  
  console.log("Test execution completed. Check logs above and verify the message reaches the channel.");
}

runTest().catch((err) => {
  console.error("Test script failed:", err);
});
