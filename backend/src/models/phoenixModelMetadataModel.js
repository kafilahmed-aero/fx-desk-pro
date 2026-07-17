import mongoose from "mongoose";

const phoenixModelMetadataSchema = new mongoose.Schema({
  modelVersion: { type: String, required: true, unique: true },
  trainingPolicyVersion: { type: String, required: true, default: "1.0" },
  featureSchemaVersion: { type: String, required: true, default: "1.0" },
  status: { type: String, required: true, enum: ["ACTIVE", "ARCHIVED"], default: "ACTIVE" },
  trainingTimestamp: { type: Date, required: true, default: Date.now },
  trainingDatasetSize: { type: Number, required: true },
  trainingEligibilityResult: { type: mongoose.Schema.Types.Mixed, required: true },
  featureKeysUsed: { type: [String], required: true },
  accuracyMetric: { type: Number, default: 0.0 },
  precisionMetric: { type: Number, default: 0.0 }
}, {
  timestamps: true
});

phoenixModelMetadataSchema.index({ status: 1 });

// Allow status transitions to enable model archiving, block other updates
const allowStatusUpdateOnly = function(next) {
  const update = this.getUpdate();
  if (update && update.$set) {
    const keys = Object.keys(update.$set);
    const nonStatusKeys = keys.filter(k => k !== "status");
    if (nonStatusKeys.length > 0) {
      return next(new Error("Phoenix model metadata is append-only. Only status transitions are permitted."));
    }
  } else {
    return next(new Error("Phoenix model metadata is append-only. Modifying records is prohibited."));
  }
  next();
};

const blockDeletion = function(next) {
  next(new Error("Phoenix model metadata is append-only. Deleting records is prohibited."));
};

phoenixModelMetadataSchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix model metadata is append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixModelMetadataSchema.pre("updateOne", allowStatusUpdateOnly);
phoenixModelMetadataSchema.pre("updateMany", allowStatusUpdateOnly);
phoenixModelMetadataSchema.pre("findOneAndUpdate", allowStatusUpdateOnly);
phoenixModelMetadataSchema.pre("findOneAndDelete", blockDeletion);
phoenixModelMetadataSchema.pre("deleteOne", blockDeletion);
phoenixModelMetadataSchema.pre("deleteMany", blockDeletion);

export const PhoenixModelMetadata = mongoose.model(
  "PhoenixModelMetadata",
  phoenixModelMetadataSchema,
  "phoenixModelMetadata"
);
