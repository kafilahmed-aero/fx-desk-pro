import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionStr = process.env.TELEGRAM_SESSION;

if (!apiId || !apiHash || !sessionStr) {
  console.error("Missing required variables in backend/.env");
  process.exit(1);
}

async function testConnection(name, clientParams) {
  console.log(`\n=== Starting Experiment: ${name} ===`);
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 1,
    timeout: 5,
    ...clientParams
  });

  const startTime = Date.now();
  try {
    // Attempt connection with a timeout wrapper to prevent indefinite hanging
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection timed out (10s)")), 10000);
    });

    await Promise.race([connectPromise, timeoutPromise]);
    const duration = Date.now() - startTime;
    console.log(`[${name}] Connection SUCCESS!`);
    console.log(`- Time taken: ${duration}ms`);
    console.log(`- Connected DC: ${client.session.dcId}`);
    console.log(`- IP: ${client.session.serverAddress}:${client.session.port}`);
    
    // Check if we can get user info
    const me = await client.getMe();
    console.log(`- Authorization SUCCESS: Authorized as ${me.username || me.firstName}`);
    
    await client.disconnect();
    return { success: true };
  } catch (err) {
    const duration = Date.now() - startTime;
    console.log(`[${name}] Connection FAILED after ${duration}ms:`);
    console.log(`- Error: ${err.message}`);
    try {
      await client.disconnect();
    } catch (e) {}
    return { success: false, error: err.message };
  }
}

async function run() {
  console.log("Starting Transport Verification Experiments...");
  
  // Experiment A: Default Transport (useWSS = false)
  const resultA = await testConnection("Default (useWSS = false, port 80)", {
    useWSS: false
  });

  // Experiment B: Custom Transport (useWSS = true, port 443)
  const resultB = await testConnection("Custom (useWSS = true, port 443)", {
    useWSS: true
  });

  console.log("\n=== EXPERIMENTAL RESULTS SUMMARY ===");
  console.log(`Experiment A (Default Port 80): ${resultA.success ? "SUCCESS" : "FAILED"}`);
  console.log(`Experiment B (WSS Port 443): ${resultB.success ? "SUCCESS" : "FAILED"}`);
}

run().catch(console.error);
