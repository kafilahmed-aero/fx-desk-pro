import mongoose from "mongoose";

const channelPerformanceSchema = new mongoose.Schema(
  {
    _id: {
      type: String, // Normalized channel name
      required: true,
    },
    channel: {
      type: String,
      required: true,
      index: true,
    },
    totalSignals: {
      type: Number,
      default: 0,
    },
    pendingCount: {
      type: Number,
      default: 0,
    },
    activeCount: {
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
    completedSignals: {
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
    expiryRate: {
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
    isReliabilityEligible: {
      type: Boolean,
      default: false,
    },
    lastAggregatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "channelPerformance",
    timestamps: true,
  }
);

export const ChannelPerformance =
  mongoose.models.ChannelPerformance ||
  mongoose.model("ChannelPerformance", channelPerformanceSchema);
