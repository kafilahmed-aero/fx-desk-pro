import mongoose from "mongoose";

const phoenixRecommendationSchema = new mongoose.Schema({
  recommendationId: { type: String, required: true, unique: true },
  recommendationVersion: { type: String, required: true, default: "1.0" },
  generatedAt: { type: Date, required: true, default: Date.now },
  analyticsVersion: { type: String, required: true, default: "1.0" },
  status: { 
    type: String, 
    required: true, 
    enum: ["ACTIVE", "SUPERSEDED", "ARCHIVED"], 
    default: "ACTIVE" 
  },
  category: { 
    type: String, 
    required: true, 
    enum: [
      "Channels", 
      "Sessions", 
      "Decision Engine", 
      "Market Intelligence", 
      "Smart Entry", 
      "Lifecycle", 
      "Strategy", 
      "System Health"
    ] 
  },
  title: { type: String, required: true },
  priority: { type: String, required: true, enum: ["HIGH", "MEDIUM", "LOW"] },
  confidence: { type: String, required: true, enum: ["LOW", "MEDIUM", "HIGH", "VERY HIGH"] },
  impact: { type: String, required: true, enum: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] },
  evidenceSummary: { type: String, required: true },
  explanation: { type: String, required: true },
  supportingStatistics: { type: mongoose.Schema.Types.Mixed, required: true },
  timeframe: { type: String, required: true, default: "allTime" }
}, {
  timestamps: true
});

phoenixRecommendationSchema.index({ category: 1 });
phoenixRecommendationSchema.index({ status: 1 });

// Restrict updates to status transitions only for historical traceability
const allowStatusUpdateOnly = function(next) {
  const update = this.getUpdate();
  if (update && update.$set) {
    const keys = Object.keys(update.$set);
    const nonStatusKeys = keys.filter(k => k !== "status");
    if (nonStatusKeys.length > 0) {
      return next(new Error("Phoenix recommendations are append-only. Only status transitions are permitted."));
    }
  } else {
    return next(new Error("Phoenix recommendations are append-only. Modifying records is prohibited."));
  }
  next();
};

const blockDeletion = function(next) {
  next(new Error("Phoenix recommendations are append-only. Deleting records is prohibited."));
};

phoenixRecommendationSchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix recommendations are append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixRecommendationSchema.pre("updateOne", allowStatusUpdateOnly);
phoenixRecommendationSchema.pre("updateMany", allowStatusUpdateOnly);
phoenixRecommendationSchema.pre("findOneAndUpdate", allowStatusUpdateOnly);
phoenixRecommendationSchema.pre("findOneAndDelete", blockDeletion);
phoenixRecommendationSchema.pre("deleteOne", blockDeletion);
phoenixRecommendationSchema.pre("deleteMany", blockDeletion);

export const PhoenixRecommendation = mongoose.model(
  "PhoenixRecommendation",
  phoenixRecommendationSchema,
  "phoenixRecommendation"
);
