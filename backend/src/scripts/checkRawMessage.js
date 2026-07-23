import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";

const rawMessageSchema = new mongoose.Schema({}, { strict: false });
const RawMessage = mongoose.models.RawMessage || mongoose.model("RawMessage", rawMessageSchema, "rawMessages");

async function query() {
  await connectDatabase();
  const rawDoc = await RawMessage.findOne({ channel: "FXGoldProMaster", messageId: 6447 }).lean();
  console.log("Raw Message:", JSON.stringify(rawDoc, null, 2));
  await mongoose.disconnect();
}

query().catch(console.error);
