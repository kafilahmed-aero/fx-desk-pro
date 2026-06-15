import mongoose from "mongoose";

const pairPerformanceSchema = new mongoose.Schema(
  {
    channelPairKey: {
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
    totalSignals: {
      type: Number,
      default: 0,
    },
    completedSignals: {
      type: Number,
      default: 0,
    },
    fullTpCount: {
      type: Number,
      default: 0,
    },
    partialTpCount: {
      type: Number,
      default: 0,
    },
    slHitCount: {
      type: Number,
      default: 0,
    },
    expiredCount: {
      type: Number,
      default: 0,
    },
    cancelledCount: {
      type: Number,
      default: 0,
    },
    winRate: {
      type: Number,
      default: 0.0,
    },
    targetAchievementRate: {
      type: Number,
      default: 0.0,
    },
    avgTpDurationMinutes: {
      type: Number,
      default: 0.0,
    },
    avgSlDurationMinutes: {
      type: Number,
      default: 0.0,
    },
    minimumSignalsRequired: {
      type: Number,
      default: 20,
    },
    isEligible: {
      type: Boolean,
      default: false,
    },
    lastAggregatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "pairPerformance",
    timestamps: true,
  }
);

// Compound index for querying a specific channel's pair performance
pairPerformanceSchema.index({ channel: 1, pair: 1 });

export const PairPerformance =
  mongoose.models.PairPerformance ||
  mongoose.model("PairPerformance", pairPerformanceSchema);
