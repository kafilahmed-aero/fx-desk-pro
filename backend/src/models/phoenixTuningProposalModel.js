import mongoose from "mongoose";

const phoenixTuningProposalSchema = new mongoose.Schema({
  proposalId: { type: String, required: true, unique: true },
  proposalVersion: { type: String, required: true, default: "1.0" },
  recommendationId: { type: String, required: true, unique: true },
  generatedAt: { type: Date, required: true, default: Date.now },
  analyticsVersion: { type: String, required: true, default: "1.0" },
  featureVersion: { type: String, required: true, default: "1.0" },
  memoryTradeIds: { type: [String], required: true },
  status: { 
    type: String, 
    required: true, 
    enum: ["REJECTED", "UNDER_REVIEW", "APPROVED_FOR_MANUAL_REVIEW"], 
    default: "UNDER_REVIEW" 
  },
  safetyScore: { type: Number, required: true },
  safetyGrade: { type: String, required: true, enum: ["A", "B", "C", "REJECT"] },
  evidence: { type: String, required: true },
  supportingStatistics: { type: mongoose.Schema.Types.Mixed, required: true },
  passedGates: { type: [String], required: true },
  failedGates: { type: [String], required: true },
  safetyGates: { type: mongoose.Schema.Types.Mixed, required: true },
  explanation: { type: String, required: true },
  confidence: { type: String, required: true },
  recommendation: { type: mongoose.Schema.Types.Mixed, required: true },
  summary: { type: String, required: true }
}, {
  timestamps: true
});

phoenixTuningProposalSchema.index({ status: 1 });

// Restrict updates to status transitions only for historical audatibility
const allowStatusUpdateOnly = function(next) {
  const update = this.getUpdate();
  if (update && update.$set) {
    const keys = Object.keys(update.$set);
    const nonStatusKeys = keys.filter(k => k !== "status");
    if (nonStatusKeys.length > 0) {
      return next(new Error("Phoenix tuning proposals are append-only. Only status transitions are permitted."));
    }
  } else {
    return next(new Error("Phoenix tuning proposals are append-only. Modifying records is prohibited."));
  }
  next();
};

const blockDeletion = function(next) {
  next(new Error("Phoenix tuning proposals are append-only. Deleting records is prohibited."));
};

phoenixTuningProposalSchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix tuning proposals are append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixTuningProposalSchema.pre("updateOne", allowStatusUpdateOnly);
phoenixTuningProposalSchema.pre("updateMany", allowStatusUpdateOnly);
phoenixTuningProposalSchema.pre("findOneAndUpdate", allowStatusUpdateOnly);
phoenixTuningProposalSchema.pre("findOneAndDelete", blockDeletion);
phoenixTuningProposalSchema.pre("deleteOne", blockDeletion);
phoenixTuningProposalSchema.pre("deleteMany", blockDeletion);

export const PhoenixTuningProposal = mongoose.model(
  "PhoenixTuningProposal",
  phoenixTuningProposalSchema,
  "phoenixTuningProposal"
);
