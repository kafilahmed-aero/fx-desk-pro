import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

function run() {
  const client = new TelegramClient(
    new StringSession(""),
    12345, // mock apiId
    "mock_hash",
    {
      connectionRetries: 5,
    }
  );
  
  console.log("=== TelegramClient default configuration properties ===");
  console.log("connectionRetries:", client.connectionRetries);
  console.log("deviceModel:", client.deviceModel);
  console.log("systemVersion:", client.systemVersion);
  console.log("appVersion:", client.appVersion);
  console.log("langCode:", client.langCode);
  console.log("systemLangCode:", client.systemLangCode);
  console.log("useWSS:", client.useWSS);
  console.log("proxy:", client.proxy);
  console.log("testMode:", client._testMode);
  
  // Let's check DC details
  console.log("session serverAddress:", client.session.serverAddress);
  console.log("session port:", client.session.port);
  console.log("session dcId:", client.session.dcId);
}

run();
