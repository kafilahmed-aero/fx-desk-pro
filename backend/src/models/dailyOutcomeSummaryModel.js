import mongoose from "mongoose";

const dailyOutcomeSummarySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      unique: true,
      index: true,
    },
    totalSignals: {
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
      default: 0,
    },
    averageRR: {
      type: Number,
      default: 0,
    },
    breakEvenCount: {
      type: Number,
      default: 0,
    },
    maxDrawdown: {
      type: Number,
      default: 0,
    },
    profitFactor: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const DailyOutcomeSummary = mongoose.model(
  "DailyOutcomeSummary",
  dailyOutcomeSummarySchema
);
