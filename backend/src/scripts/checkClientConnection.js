import fs from "fs";
import readline from "readline";

async function run() {
  const logFile = "C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\07fa9d05-9b75-4a4f-a94b-9072798f148c\\.system_generated\\tasks\\task-2392.log";
  
  const fileStream = fs.createReadStream(logFile, { flags: 'r' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log("=== SCANNING CLIENT SYNC LOGS ===");
  for await (const line of rl) {
    if (
      line.includes("mt5_sync.client_") ||
      line.includes("mt5_sync.register") ||
      line.includes("WEBSOCKET UPGRADE") ||
      line.includes("DEBUG broadcastToEAs") ||
      line.includes("T1:") ||
      line.includes("T2:") ||
      line.includes("T3:") ||
      line.includes("OPEN_ORDER")
    ) {
      console.log(line);
    }
  }
}

run().catch(console.error);
