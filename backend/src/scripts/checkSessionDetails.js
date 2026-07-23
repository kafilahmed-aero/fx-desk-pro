import { StringSession } from "telegram/sessions/index.js";
import dotenv from "dotenv";
import fs from "fs";

function run() {
  const envContent = fs.readFileSync(".env", "utf8");
  const match = envContent.match(/TELEGRAM_SESSION\s*=\s*(.*)/);
  if (!match) {
    console.log("No TELEGRAM_SESSION found in .env");
    return;
  }
  const sessionStr = match[1].replace(/['"]/g, "").trim();
  const session = new StringSession(sessionStr);
  console.log("=== StringSession Details ===");
  console.log("dcId:", session.dcId);
  console.log("serverAddress:", session.serverAddress);
  console.log("port:", session.port);
  console.log("authKey:", session.authKey ? "Exists" : "None");
}

run();
