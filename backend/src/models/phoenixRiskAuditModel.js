import mongoose from "mongoose";

const phoenixRiskAuditSchema = new mongoose.Schema({
  auditId: { type: String, required: true, unique: true },
  recommendationId: { type: String, required: true },
  policyVersion: { type: String, required: true, default: "1.0" },
  decision: { type: String, required: true, enum: ["APPROVED", "REJECTED"] },
  reason: { type: String, default: null },
  timestamp: { type: Date, required: true, default: Date.now },
  evaluations: { type: mongoose.Schema.Types.Mixed, required: true }
}, {
  timestamps: true
});

phoenixRiskAuditSchema.index({ recommendationId: 1 });
phoenixRiskAuditSchema.index({ decision: 1 });

const blockUpdatesAndDeletes = function(next) {
  next(new Error("Phoenix risk audit records are append-only. Modifying or deleting records is prohibited."));
};

phoenixRiskAuditSchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix risk audit records are append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixRiskAuditSchema.pre("updateOne", blockUpdatesAndDeletes);
phoenixRiskAuditSchema.pre("updateMany", blockUpdatesAndDeletes);
phoenixRiskAuditSchema.pre("findOneAndUpdate", blockUpdatesAndDeletes);
phoenixRiskAuditSchema.pre("findOneAndDelete", blockUpdatesAndDeletes);
phoenixRiskAuditSchema.pre("deleteOne", blockUpdatesAndDeletes);
phoenixRiskAuditSchema.pre("deleteMany", blockUpdatesAndDeletes);

export const PhoenixRiskAudit = mongoose.model(
  "PhoenixRiskAudit",
  phoenixRiskAuditSchema,
  "phoenixRiskAudit"
);
