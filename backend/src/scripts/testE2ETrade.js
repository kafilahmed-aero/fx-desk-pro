import mongoose from "mongoose";
import "dotenv/config";
import { config } from "../config/env.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";

async function run() {
  console.log("Connecting to MongoDB:", config.mongoUri);
  await mongoose.connect(config.mongoUri);
  console.log("Connected successfully!");

  const recId = "AI-E2E-TEST-" + Date.now();
  console.log("Creating test active recommendation document with ID:", recId);

  const doc = new AiRecommendationOutcome({
    recommendationId: recId,
    recommendationVersion: 1,
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 4070.0,
    entryMax: 4090.0,
    expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour expiration
    status: "ACTIVE",
    simulationMode: "DEMO",
    executionState: "WAITING_FOR_MT5",
    lowRiskTp: 0,
    sl: 0,
    simulatedEntryPrice: 4080.0,
    simulatedSL: 0,
    simulationNotes: ["E2E Test: Document created."]
  });

  await doc.save();
  console.log("Document saved successfully!");

  console.log("Waiting for the backend server to process and send the order...");
  let maxTicks = 30; // wait up to 30 seconds
  let positionOpen = false;

  for (let i = 0; i < maxTicks; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const currentDoc = await AiRecommendationOutcome.findOne({ recommendationId: recId });
    console.log(`[Tick ${i+1}/30] DB State -> executionState: "${currentDoc.executionState}", notes:`, currentDoc.simulationNotes);
    
    if (currentDoc.executionState === "POSITION_OPEN") {
      console.log("SUCCESS: Order filled on MT5 client!");
      positionOpen = true;
      break;
    }
  }

  if (!positionOpen) {
    console.error("FAIL: Timeout waiting for position to open.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("Initiating CLOSE ORDER command by setting status = 'FULL_TP'...");
  await AiRecommendationOutcome.updateOne(
    { recommendationId: recId },
    { status: "FULL_TP" }
  );

  console.log("Waiting for close to complete...");
  let closeSuccess = false;
  for (let i = 0; i < maxTicks; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const currentDoc = await AiRecommendationOutcome.findOne({ recommendationId: recId });
    console.log(`[Tick ${i+1}/30] DB State -> executionState: "${currentDoc.executionState}", status: "${currentDoc.status}"`);

    if (currentDoc.executionState === "SYNC_COMPLETE") {
      console.log("SUCCESS: Order closed on MT5 client!");
      closeSuccess = true;
      break;
    }
  }

  if (!closeSuccess) {
    console.error("FAIL: Timeout waiting for position to close.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("E2E Integration Test PASSED successfully!");
  await mongoose.disconnect();
}

run().catch(err => {
  console.error("Error during run:", err);
  process.exit(1);
});
