import mongoose from "mongoose";

const validationReconciliationLogSchema = new mongoose.Schema(
  {
    reconciliationId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    recoveredContexts: {
      type: [Number], // array of signalIds
      default: []
    },
    orphanTrades: {
      type: [mongoose.Schema.Types.Mixed], // array of raw orphan details
      default: []
    },
    synchronizedContexts: {
      type: [Number], // array of signalIds
      default: []
    },
    failures: {
      type: [mongoose.Schema.Types.Mixed], // array of { signalId, error }
      default: []
    }
  },
  {
    timestamps: false
  }
);

export const ValidationReconciliationLog = mongoose.model("ValidationReconciliationLog", validationReconciliationLogSchema);
