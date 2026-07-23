import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { SignalValidationContextModel } from "../models/signalValidationContextModel.js";

const rawMessageSchema = new mongoose.Schema({}, { strict: false });
const RawMessage = mongoose.models.RawMessage || mongoose.model("RawMessage", rawMessageSchema, "rawMessages");

async function query() {
  await connectDatabase();
  
  console.log("=== LATEST RAW MESSAGE ===");
  const latestRaw = await RawMessage.findOne().sort({ createdAt: -1 }).lean();
  if (latestRaw) {
    console.log({
      _id: latestRaw._id,
      channel: latestRaw.channel,
      messageId: latestRaw.messageId,
      text: latestRaw.text,
      timestamp: latestRaw.timestamp,
      createdAt: latestRaw.createdAt
    });
  } else {
    console.log("No raw messages found");
  }

  console.log("\n=== LATEST PARSED SIGNAL ===");
  const latestParsed = await ParsedSignal.findOne().sort({ createdAt: -1 }).lean();
  if (latestParsed) {
    console.log({
      _id: latestParsed._id,
      channel: latestParsed.channel,
      messageId: latestParsed.messageId,
      pair: latestParsed.pair,
      action: latestParsed.action,
      entry: latestParsed.entry,
      stopLoss: latestParsed.stopLoss,
      targets: latestParsed.targets,
      classification: latestParsed.classification,
      timestamp: latestParsed.timestamp,
      createdAt: latestParsed.createdAt
    });
  } else {
    console.log("No parsed signals found");
  }

  console.log("\n=== LATEST SIGNAL VALIDATION CONTEXT ===");
  const latestContext = await SignalValidationContextModel.findOne().sort({ createdAt: -1 }).lean();
  if (latestContext) {
    console.log({
      _id: latestContext._id,
      signalId: latestContext.signalId,
      channelName: latestContext.channelName,
      symbol: latestContext.symbol,
      direction: latestContext.direction,
      entry: latestContext.entry,
      stopLoss: latestContext.stopLoss,
      takeProfits: latestContext.takeProfits,
      receivedTimestamp: latestContext.receivedTimestamp,
      pipelineStatus: latestContext.pipelineStatus,
      order: {
        status: latestContext.order?.status,
        executionStatus: latestContext.order?.executionStatus,
        executionResult: latestContext.order?.executionResult,
        ticket: latestContext.order?.ticket,
        failureReason: latestContext.order?.failureReason
      },
      createdAt: latestContext.createdAt,
      updatedAt: latestContext.updatedAt
    });
  } else {
    console.log("No validation contexts found");
  }

  await mongoose.disconnect();
}

query().catch(err => {
  console.error(err);
  process.exit(1);
});
