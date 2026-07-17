import mongoose from "mongoose";

const validationChannelStatsSchema = new mongoose.Schema(
  {
    channelName: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    sampleStatus: {
      type: String,
      enum: ["INSUFFICIENT_DATA", "SUFFICIENT_DATA"],
      default: "INSUFFICIENT_DATA"
    },
    // Raw statistics (Source of truth)
    totalSignals: {
      type: Number,
      default: 0
    },
    executedSignals: {
      type: Number,
      default: 0
    },
    filledSignals: {
      type: Number,
      default: 0
    },
    fullTP: {
      type: Number,
      default: 0
    },
    slHit: {
      type: Number,
      default: 0
    },
    manualClose: {
      type: Number,
      default: 0
    },
    cancelled: {
      type: Number,
      default: 0
    },
    expired: {
      type: Number,
      default: 0
    },
    unknown: {
      type: Number,
      default: 0
    },
    totalPips: {
      type: Number,
      default: 0
    },
    grossWinsPips: {
      type: Number,
      default: 0
    },
    grossLossPips: {
      type: Number,
      default: 0
    },
    totalTradeDuration: {
      type: Number,
      default: 0
    },
    // Derived metrics (Computed before save)
    winRate: {
      type: Number,
      default: 0
    },
    fillRate: {
      type: Number,
      default: 0
    },
    averagePips: {
      type: Number,
      default: 0
    },
    averageTradeDuration: {
      type: Number,
      default: 0
    },
    profitFactor: {
      type: Number,
      default: null
    },
    reliabilityScore: {
      type: Number,
      default: 0
    },
    // Timestamps
    firstTradeAt: {
      type: Date,
      default: null
    },
    lastTradeAt: {
      type: Date,
      default: null
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: false // Handled manually via firstTradeAt, lastTradeAt, lastUpdated
  }
);

export const ValidationChannelStats = mongoose.model("ValidationChannelStats", validationChannelStatsSchema);
