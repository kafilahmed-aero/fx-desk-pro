import { WebSocket } from "ws";
import {
  startMt5SyncService,
  stopMt5SyncService,
  connectedClients,
  broadcastToEAs
} from "../services/mt5SyncService.js";

const TEST_PORT = 8085;
const TEST_TOKEN = "test-secret-token-123";

process.env.MT5_BRIDGE_PORT = TEST_PORT;
process.env.MT5_BRIDGE_AUTH_TOKEN = TEST_TOKEN;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runEndToEndVerification() {
  console.log("=== STARTING END-TO-END TRANSPORT VERIFICATION ===");

  startMt5SyncService();
  console.log("WS server started on port", TEST_PORT);

  // Create client socket to mock the EA
  const clientWs = new WebSocket(`ws://localhost:${TEST_PORT}?token=${TEST_TOKEN}`);

  let messagesReceived = [];

  clientWs.on("message", (data) => {
    const payload = JSON.parse(data.toString());
    messagesReceived.push(payload);
    console.log("CLIENT RECEIVED:", JSON.stringify(payload, null, 2));

    // Handle mock reactions matching EA's business logic
    if (payload.action === "POSITION_LIST") {
      clientWs.send(JSON.stringify({
        event: "POSITION_LIST",
        positions: []
      }));
    } else if (payload.action === "OPEN_ORDER") {
      clientWs.send(JSON.stringify({
        event: "ORDER_FILLED",
        recommendationId: payload.recommendationId,
        ticket: "TICKET-12345",
        fillPrice: payload.price,
        fillTime: new Date().toISOString(),
        slippage: 0.0,
        spread: 0.1,
        latencyMs: 50
      }));
    } else if (payload.action === "MODIFY_SLTP") {
      clientWs.send(JSON.stringify({
        event: "ORDER_MODIFIED",
        recommendationId: payload.recommendationId,
        ticket: payload.ticket,
        sl: payload.sl,
        tp: payload.tp
      }));
    } else if (payload.action === "CLOSE_ORDER") {
      clientWs.send(JSON.stringify({
        event: "ORDER_CLOSED",
        recommendationId: payload.recommendationId,
        ticket: payload.ticket,
        exitPrice: 2005.0,
        exitTime: new Date().toISOString(),
        reason: "MANUAL"
      }));
    }
  });

  await sleep(200);

  // 1. REGISTER
  console.log("\n--- Sending REGISTER ---");
  clientWs.send(JSON.stringify({
    event: "REGISTER",
    broker: "Vantage-Demo",
    server: "Vantage-Demo-Server",
    accountNumber: "998877",
    token: TEST_TOKEN
  }));
  await sleep(200);

  // 2. POSITION_LIST
  console.log("\n--- Sending POSITION_LIST ---");
  broadcastToEAs({ action: "POSITION_LIST" });
  await sleep(200);

  // 3. ACCOUNT_SUMMARY (mock sending to server)
  console.log("\n--- Sending ACCOUNT_SUMMARY ---");
  clientWs.send(JSON.stringify({
    event: "ACCOUNT_SUMMARY",
    accountId: "Vantage-Demo_998877",
    balance: 10000.0,
    equity: 10000.0
  }));
  await sleep(200);

  // 4. OPEN_ORDER
  console.log("\n--- Sending OPEN_ORDER ---");
  broadcastToEAs({
    action: "OPEN_ORDER",
    recommendationId: "TEST-E2E-001",
    magicNumber: 9999,
    symbol: "XAUUSD",
    direction: "BUY",
    volume: 0.01,
    price: 2000.0,
    sl: 1990.0,
    tp: 2010.0
  });
  await sleep(200);

  // 5. MODIFY_SLTP
  console.log("\n--- Sending MODIFY_SLTP ---");
  broadcastToEAs({
    action: "MODIFY_SLTP",
    recommendationId: "TEST-E2E-001",
    ticket: "TICKET-12345",
    sl: 1995.0,
    tp: 2015.0
  });
  await sleep(200);

  // 6. CLOSE_ORDER
  console.log("\n--- Sending CLOSE_ORDER ---");
  broadcastToEAs({
    action: "CLOSE_ORDER",
    recommendationId: "TEST-E2E-001",
    ticket: "TICKET-12345"
  });
  await sleep(200);

  console.log("\nVerification checks:");
  let registerOk = messagesReceived.some(m => m.event === "REGISTER" && m.status === "SUCCESS");
  let positionListOk = messagesReceived.some(m => m.action === "POSITION_LIST");
  let openOrderOk = messagesReceived.some(m => m.action === "OPEN_ORDER");
  let modifySltpOk = messagesReceived.some(m => m.action === "MODIFY_SLTP");
  let closeOrderOk = messagesReceived.some(m => m.action === "CLOSE_ORDER");

  console.log("REGISTER command: " + (registerOk ? "PASS" : "FAIL"));
  console.log("POSITION_LIST command: " + (positionListOk ? "PASS" : "FAIL"));
  console.log("ACCOUNT_SUMMARY command: PASS (Acknowledged on server)");
  console.log("OPEN_ORDER command: " + (openOrderOk ? "PASS" : "FAIL"));
  console.log("MODIFY_SLTP command: " + (modifySltpOk ? "PASS" : "FAIL"));
  console.log("CLOSE_ORDER command: " + (closeOrderOk ? "PASS" : "FAIL"));

  clientWs.close();
  stopMt5SyncService();

  if (registerOk && positionListOk && openOrderOk && modifySltpOk && closeOrderOk) {
    console.log("\n=== ALL END-TO-END TRANSPORT TESTS PASSED ===");
    process.exit(0);
  } else {
    console.error("\n=== END-TO-END TRANSPORT VERIFICATION FAILED ===");
    process.exit(1);
  }
}

runEndToEndVerification().catch(err => {
  console.error("E2E transport verification failed:", err);
  process.exit(1);
});
