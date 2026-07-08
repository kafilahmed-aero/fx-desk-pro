import mongoose from "mongoose";

const aiRecommendationSnapshotSchema = new mongoose.Schema(
  {
    recommendationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    schemaVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    direction: {
      type: String,
      required: true,
    },
    confidence: {
      type: Number,
      default: null,
    },
    entryMin: {
      type: Number,
      required: true,
    },
    entryMax: {
      type: Number,
      required: true,
    },
    sl: {
      type: Number,
      default: null,
    },
    tp: {
      type: Number,
      default: null,
    },
    moderateTp: {
      type: Number,
      default: null,
    },
    highRiskTp: {
      type: Number,
      default: null,
    },
    telegramQuality: {
      type: String,
      default: null,
    },
    telegramConsensus: {
      type: Number,
      default: null,
    },
    weightedConsensus: {
      type: String,
      default: null,
    },
    channelReliability: {
      type: String,
      default: null,
    },
    marketRegime: {
      type: String,
      default: null,
    },
    regimeConfidence: {
      type: Number,
      default: null,
    },
    institutionalBias: {
      type: String,
      default: null,
    },
    macroAlignment: {
      type: String,
      default: null,
    },
    macroConflictLevel: {
      type: String,
      default: null,
    },
    premiumDiscount: {
      type: String,
      default: null,
    },
    nearestOrderBlock: {
      type: String,
      default: null,
    },
    nearestFairValueGap: {
      type: String,
      default: null,
    },
    liquidityStatus: {
      type: String,
      default: null,
    },
    dxyDirection: {
      type: String,
      default: null,
    },
    us10yDirection: {
      type: String,
      default: null,
    },
    silverDirection: {
      type: String,
      default: null,
    },
    overallConfluenceScore: {
      type: Number,
      default: null,
    },
    tradeFilter: {
      type: String,
      default: null,
    },
    tradingSession: {
      type: String,
      default: null,
    },
    emergencyMacroOverrideStatus: {
      type: Boolean,
      default: false,
    },
    promptMetadata: {
      promptVersion: { type: String, default: "1.0" },
      promptHash: { type: String, default: null },
      geminiModel: { type: String, default: "gemini-2.5-flash" },
      generationTimestamp: { type: Date, default: Date.now }
    },
    outcome: {
      status: { type: String, default: null },
      holdingTimeMs: { type: Number, default: null },
      maxFavorableExcursion: { type: Number, default: null },
      maxAdverseExcursion: { type: Number, default: null },
      profitAchievedBeforeReversal: { type: Number, default: null },
      lossBeforeRecovery: { type: Number, default: null },
      distanceTravelled: { type: Number, default: null },
      resolvedAt: { type: Date, default: null }
    }
  },
  {
    timestamps: true,
  }
);

export const AiRecommendationSnapshot = mongoose.model(
  "AiRecommendationSnapshot",
  aiRecommendationSnapshotSchema
);
