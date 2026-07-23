import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { processRawMessage } from "../services/signalProcessingService.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";

async function run() {
  await connectDatabase();

  // Find a new messageId to avoid duplicates
  const maxDoc = await ParsedSignal.findOne().sort({ messageId: -1 });
  const nextMsgId = (maxDoc?.messageId || 50000) + 1;

  console.log(`Using messageId: ${nextMsgId}`);

  // Create a raw message matching NEW_SIGNAL
  const rawMessage = {
    channel: "ForexTrading_Point",
    messageId: nextMsgId,
    text: "GOLD BUY 3993\nTP 4020\nSL 3950",
    date: new Date()
  };

  console.log("Processing raw message...");
  const result = await processRawMessage(rawMessage);
  console.log("Process raw message result:", JSON.stringify(result, null, 2));

  // Check if context was created in database
  const createdContext = await SignalValidationContextModel.findOne({ signalId: nextMsgId });
  if (createdContext) {
    console.log("\nSUCCESS: SignalValidationContext created in MongoDB!");
    console.log(JSON.stringify(createdContext, null, 2));
  } else {
    console.log("\nWARNING: SignalValidationContext was NOT created in MongoDB.");
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
