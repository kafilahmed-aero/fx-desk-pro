import mongoose from "mongoose";

const quarantinedOrphanSchema = new mongoose.Schema(
  {
    ticket: {
      type: String,
      required: true,
      index: true
    },
    magicNumber: {
      type: Number,
      required: true,
      index: true
    },
    symbol: {
      type: String,
      required: true
    },
    account: {
      type: String,
      required: true
    },
    detectedAt: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String,
      default: "NO_MATCHING_VALIDATION_CONTEXT"
    }
  },
  {
    timestamps: true
  }
);

export const QuarantinedOrphan = mongoose.model("QuarantinedOrphan", quarantinedOrphanSchema);
