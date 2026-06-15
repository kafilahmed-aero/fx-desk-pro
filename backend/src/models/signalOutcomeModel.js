import mongoose from "mongoose";

const signalOutcomeSchema = new mongoose.Schema(
  {
    signalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParsedSignal",
      required: true,
      index: true,
    },
    messageKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    channel: {
      type: String,
      required: true,
      index: true,
    },
    pair: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
    },
    entry: {
      entryType: {
        type: String,
        enum: ["PRICE", "RANGE"],
        required: true,
      },
      entryPrice: {
        type: Number,
        default: null,
      },
      entryLow: {
        type: Number,
        default: null,
      },
      entryHigh: {
        type: Number,
        default: null,
      },
    },
    targets: [
      {
        targetNumber: {
          type: Number,
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
        isHit: {
          type: Boolean,
          default: false,
        },
        hitAt: {
          type: Date,
          default: null,
        },
        hitPrice: {
          type: Number,
          default: null,
        },
      },
    ],
    stopLoss: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "PARTIAL_TP", "FULL_TP", "SL_HIT", "EXPIRED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },
    hitTargets: {
      type: [Number],
      default: [],
    },
    maxTargetHit: {
      type: Number,
      default: 0,
    },
    outcomePrice: {
      type: Number,
      default: null,
    },
    outcomeTime: {
      type: Date,
      default: null,
    },
    outcomeReason: {
      type: String,
      enum: ["PRICE_MONITOR", "CHANNEL_RESULT", "MANUAL_OVERRIDE", null],
      default: null,
      index: true,
    },
    highestPriceSeen: {
      type: Number,
      default: null,
    },
    lowestPriceSeen: {
      type: Number,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastCheckedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "signalOutcomes",
    timestamps: true,
  }
);

// Compound index for active signals query performance
signalOutcomeSchema.index({ status: 1, pair: 1 });

export const SignalOutcome =
  mongoose.models.SignalOutcome ||
  mongoose.model("SignalOutcome", signalOutcomeSchema);
