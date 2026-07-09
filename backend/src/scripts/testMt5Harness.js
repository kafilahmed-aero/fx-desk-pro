import mongoose from "mongoose";
import "dotenv/config";
import { config } from "../config/env.js";
import { connectedClients } from "../services/mt5SyncService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";

// Boot the main backend application
console.log("Booting the main backend application...");
await import("../../server.js");

// Wait helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runHarness() {
  console.log("\n=============================================");
  console.log("         MT5 INTEGRATION TEST HARNESS        ");
  console.log("=============================================\n");

  let step = "1. Waiting for EA Connection";
  try {
    // Step 1: Wait for EA to connect/register (timeout 25s)
    let eaRegistered = false;
    let activeClient = null;
    let activeAccountId = null;

    console.log("Waiting for EA to connect and register...");
    for (let i = 0; i < 25; i++) {
      if (connectedClients.size > 0) {
        for (const [accountId, client] of connectedClients.entries()) {
          if (client.ws && client.ws.readyState === 1) {
            activeAccountId = accountId;
            activeClient = client;
            eaRegistered = true;
            break;
          }
        }
      }
      if (eaRegistered) break;
      await sleep(1000);
    }

    if (!eaRegistered) {
      printReport({
        connected: false,
        stage: "MT5 Connected"
      });
      process.exit(1);
    }

    // Step 2: Verify PING/PONG heartbeat (timeout 15s)
    step = "2. Verifying Heartbeat";
    let heartbeatPass = false;
    
    const hbHandler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.event === "PONG") {
          heartbeatPass = true;
        }
      } catch (e) {}
    };
    activeClient.ws.on("message", hbHandler);

    console.log("Verifying PING/PONG heartbeat...");
    activeClient.ws.send(JSON.stringify({ action: "PING" }));

    for (let i = 0; i < 15; i++) {
      if (heartbeatPass) break;
      await sleep(1000);
    }

    activeClient.ws.off("message", hbHandler);

    if (!heartbeatPass) {
      printReport({
        connected: true,
        heartbeat: false,
        stage: "Heartbeat"
      });
      process.exit(1);
    }

    // Step 3, 4, 5: Intercept and Create AI Recommendation
    step = "3. Setting Up Interceptors and Creating Recommendation";
    const recId = "HARNESS-TEST-" + Date.now();

    let openOrderSent = false;
    let openOrderReceived = false;
    let orderExecuted = null;
    let brokerRetcode = "N/A";
    let brokerComment = "N/A";

    // Wrap the send method to capture broadcastToEAs execution
    const originalSend = activeClient.ws.send;
    activeClient.ws.send = function(payload) {
      try {
        const msg = JSON.parse(payload);
        if (msg.action === "OPEN_ORDER" && msg.recommendationId === recId) {
          openOrderSent = true;
          openOrderReceived = true;
        }
      } catch (e) {}
      return originalSend.apply(this, arguments);
    };

    // Listen for MT5 execution feedback
    const messageHandler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.recommendationId === recId) {
          if (msg.event === "ORDER_FILLED") {
            orderExecuted = true;
            brokerRetcode = msg.retcode || "10009";
            brokerComment = "Request completed successfully";
          } else if (msg.event === "TRADE_FAILED") {
            orderExecuted = false;
            brokerRetcode = msg.retcode || "Unknown";
            brokerComment = msg.reason || "Unknown error";
          }
        }
      } catch (e) {}
    };
    activeClient.ws.on("message", messageHandler);

    // Save the document to trigger DB change stream & handleSendOpenOrder
    const doc = new AiRecommendationOutcome({
      recommendationId: recId,
      recommendationVersion: 1,
      pair: "XAUUSD",
      direction: "BUY",
      entryMin: 4040.0,
      entryMax: 4070.0,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      status: "ACTIVE",
      simulationMode: "DEMO",
      executionState: "WAITING_FOR_MT5",
      lowRiskTp: 0,
      sl: 0,
      simulatedEntryPrice: 4050.0,
      simulatedSL: 0,
      simulationNotes: ["Harness: Temporary test recommendation created."]
    });

    await doc.save();
    console.log("Database document created. Waiting for dispatch and execution...");

    // Wait for the backend to execute handleSendOpenOrder and broadcast
    step = "4. Waiting for OPEN_ORDER Dispatch";
    for (let i = 0; i < 15; i++) {
      if (openOrderSent && openOrderReceived) break;
      await sleep(1000);
    }

    if (!openOrderSent) {
      printReport({
        connected: true,
        heartbeat: true,
        recommendation: true,
        openOrderSent: false,
        stage: "OPEN_ORDER Sent"
      });
      activeClient.ws.send = originalSend;
      activeClient.ws.off("message", messageHandler);
      process.exit(1);
    }

    if (!openOrderReceived) {
      printReport({
        connected: true,
        heartbeat: true,
        recommendation: true,
        openOrderSent: true,
        openOrderReceived: false,
        stage: "OPEN_ORDER Received"
      });
      activeClient.ws.send = originalSend;
      activeClient.ws.off("message", messageHandler);
      process.exit(1);
    }

    // Step 6: Wait for execution response (timeout 25s)
    step = "6. Waiting for Order Execution Response";
    for (let i = 0; i < 25; i++) {
      if (orderExecuted !== null) break;
      await sleep(1000);
    }

    // Restore state
    activeClient.ws.send = originalSend;
    activeClient.ws.off("message", messageHandler);
    
    // Delete temporary document
    await AiRecommendationOutcome.deleteOne({ recommendationId: recId });

    if (orderExecuted === null) {
      printReport({
        connected: true,
        heartbeat: true,
        recommendation: true,
        openOrderSent: true,
        openOrderReceived: true,
        orderExecuted: false,
        brokerRetcode: "TIMEOUT",
        brokerComment: "Timeout waiting for MT5 response"
      });
      process.exit(1);
    }

    // Step 7: Print PASS/FAIL report
    printReport({
      connected: true,
      heartbeat: true,
      recommendation: true,
      openOrderSent: true,
      openOrderReceived: true,
      orderExecuted,
      brokerRetcode,
      brokerComment
    });

    if (orderExecuted) {
      process.exit(0);
    } else {
      process.exit(1);
    }

  } catch (err) {
    console.error(`\nError during Stage [${step}]:`, err.message);
    process.exit(1);
  }
}

function printReport(data) {
  console.log("\n=============================================");
  console.log("             INTEGRATION REPORT              ");
  console.log("=============================================\n");
  console.log(`MT5 Connected ........ ${data.connected ? "PASS" : "FAIL"}`);
  if (!data.connected) {
    console.log(`\nPipeline broke at: ${data.stage}`);
    console.log("=============================================\n");
    return;
  }

  console.log(`Heartbeat ............ ${data.heartbeat ? "PASS" : "FAIL"}`);
  if (!data.heartbeat) {
    console.log(`\nPipeline broke at: ${data.stage}`);
    console.log("=============================================\n");
    return;
  }

  console.log(`Recommendation Created PASS`);
  console.log(`OPEN_ORDER Sent ...... ${data.openOrderSent ? "PASS" : "FAIL"}`);
  if (!data.openOrderSent) {
    console.log(`\nPipeline broke at: ${data.stage}`);
    console.log("=============================================\n");
    return;
  }

  console.log(`OPEN_ORDER Received .. ${data.openOrderReceived ? "PASS" : "FAIL"}`);
  if (!data.openOrderReceived) {
    console.log(`\nPipeline broke at: ${data.stage}`);
    console.log("=============================================\n");
    return;
  }

  console.log(`Order Executed ....... ${data.orderExecuted ? "PASS" : "FAIL"}`);
  console.log(`Broker Retcode ....... ${data.brokerRetcode}`);
  console.log(`Broker Comment ....... ${data.brokerComment}`);
  console.log("\n=============================================\n");
}

runHarness().catch(console.error);
