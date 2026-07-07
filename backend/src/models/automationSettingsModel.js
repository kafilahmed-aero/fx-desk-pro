import mongoose from "mongoose";

const automationSettingsSchema = new mongoose.Schema({
  automationEnabled: { type: Boolean, default: false },
  maximumOpenTrades: { type: Number, default: 2 },
  duplicateTradesPerRecommendation: { type: Number, default: 1 },
  tpMode: { type: String, enum: ["LOW_RISK", "MODERATE", "HIGH_RISK"], default: "LOW_RISK" },
  fixedLotSize: { type: Number, default: 0.1 }
}, { timestamps: true });

export const AutomationSettings = mongoose.model("AutomationSettings", automationSettingsSchema);
