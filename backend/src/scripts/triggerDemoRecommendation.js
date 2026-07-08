import mongoose from "mongoose";
import { config } from "../config/env.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { generateMagicNumber } from "../services/mt5SyncService.js";

async function triggerDemo() {
  const mongoUri = config.mongoUri || "mongodb://localhost:27017/forex-dashboard";
  console.log(`Connecting to MongoDB at: ${mongoUri}`);
  
  await mongoose.connect(mongoUri);

  const recommendationId = `AI-DEMO-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-TEST`;
  const magicNumber = generateMagicNumber(recommendationId);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  // Instantiating document matching the Schema fields exactly
  const demoOutcome = new AiRecommendationOutcome({
    recommendationId,
    recommendationVersion: 1,
    generatedTime: new Date(),
    pair: "XAUUSD",
    direction: "BUY",
    entryMin: 2000.0,
    entryMax: 2005.0,
    sl: 1990.0,
    lowRiskTp: 2020.0,
    moderateTp: 2025.0,
    highRiskTp: 2030.0,
    status: "ACTIVE",
    expiresAt,
    simulationMode: "DEMO",
    executionStatus: "WAITING",
    executionState: null, // Let polling loop pick it up from WAITING_FOR_MT5 or null
    magicNumber,
    simulationNotes: ["Manually triggered DEMO trade via CLI validation script."],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // Save triggers Mongoose schema validators automatically
  await demoOutcome.save();
  console.log(`\n========================================`);
  console.log(`SUCCESS: DEMO Recommendation Saved!`);
  console.log(`ID: ${recommendationId}`);
  console.log(`Magic Number: ${magicNumber}`);
  console.log(`Status: ${demoOutcome.status}`);
  console.log(`Simulation Mode: ${demoOutcome.simulationMode}`);
  console.log(`========================================\n`);

  await mongoose.disconnect();
}

triggerDemo().catch(err => {
  console.error("Failed to trigger DEMO recommendation:", err);
  process.exit(1);
});
