import mongoose from "mongoose";

const phoenixRecoveryAuditSchema = new mongoose.Schema({
  recoveryId: { type: String, required: true, unique: true },
  timestamp: { type: Date, required: true, default: Date.now },
  event: { 
    type: String, 
    required: true, 
    enum: [
      "RECOVERY_STARTED", 
      "RECOVERY_COMPLETED", 
      "RECOVERED_POSITION", 
      "RECOVERED_CLOSED_TRADE", 
      "INCONSISTENCY_DETECTED", 
      "RECOVERY_FAILED", 
      "RECOVERY_RETRIED"
    ] 
  },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
  policyVersion: { type: String, required: true, default: "1.0" }
}, {
  timestamps: true
});

phoenixRecoveryAuditSchema.index({ event: 1 });

const blockUpdatesAndDeletes = function(next) {
  next(new Error("Phoenix recovery audit records are append-only. Modifying or deleting records is prohibited."));
};

phoenixRecoveryAuditSchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix recovery audit records are append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixRecoveryAuditSchema.pre("updateOne", blockUpdatesAndDeletes);
phoenixRecoveryAuditSchema.pre("updateMany", blockUpdatesAndDeletes);
phoenixRecoveryAuditSchema.pre("findOneAndUpdate", blockUpdatesAndDeletes);
phoenixRecoveryAuditSchema.pre("findOneAndDelete", blockUpdatesAndDeletes);
phoenixRecoveryAuditSchema.pre("deleteOne", blockUpdatesAndDeletes);
phoenixRecoveryAuditSchema.pre("deleteMany", blockUpdatesAndDeletes);

export const PhoenixRecoveryAudit = mongoose.model(
  "PhoenixRecoveryAudit",
  phoenixRecoveryAuditSchema,
  "phoenixRecoveryAudit"
);
