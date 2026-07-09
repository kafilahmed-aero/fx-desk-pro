import mongoose from "mongoose";

const aiDecisionValidationSchema = new mongoose.Schema(
  {
    recommendationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    currentPrice: {
      type: Number,
      default: null,
    },
    consensusDirection: {
      type: String,
      default: null,
    },
    consensusConfidence: {
      type: Number,
      default: null,
    },
    buyWeight: {
      type: Number,
      default: 0,
    },
    sellWeight: {
      type: Number,
      default: 0,
    },
    activeSignalsCount: {
      type: Number,
      default: 0,
    },
    fullPrompt: {
      type: String,
      default: null,
    },
    rawResponse: {
      type: String,
      default: null,
    },
    parsedRecommendation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    finalAction: {
      type: String,
      default: null,
    },
    generationTimeMs: {
      type: Number,
      default: null,
    },

    // AI Scorecard (Requirement 3)
    scorecard: {
      promptQualityScore: { type: Number, default: 0 },
      signalQualityScore: { type: Number, default: 0 },
      consensusStrength: { type: Number, default: 0 },
      trendAlignmentScore: { type: Number, default: 0 },
      institutionalBiasScore: { type: Number, default: 0 },
      newsRiskScore: { type: Number, default: 0 },
      liquidityScore: { type: Number, default: 0 },
      volatilityScore: { type: Number, default: 0 },
      riskRewardScore: { type: Number, default: 0 },
      finalConfidence: { type: Number, default: 0 },
      finalDecision: { type: String, default: null },
    },

    // Structured Explanations from Gemini (Requirement 4)
    explanation: {
      thesis: { type: String, default: null },
      bullishFactors: { type: [String], default: [] },
      bearishFactors: { type: [String], default: [] },
      risks: { type: [String], default: [] },
      invalidation: { type: String, default: null },
      missingInformation: { type: [String], default: [] },
      whyNotBuy: { type: String, default: null },
      whyNotSell: { type: String, default: null },
      whyHold: { type: String, default: null },
      confidenceExplanation: { type: String, default: null },
      triggerHoldToBuy: { type: String, default: null },
      triggerHoldToSell: { type: String, default: null },
    },

    // HOLD Accuracy Analysis (Requirement 2)
    holdAccuracy: {
      holdAvoidedLosingTrade: { type: Boolean, default: null },
      holdMissedProfitableTrade: { type: Boolean, default: null },
      holdOptimalDecision: { type: Boolean, default: null },
      holdRuleTriggered: { type: String, default: null },
    },

    // Consistency Checks (Requirement 4)
    consistency: {
      hasContradiction: { type: Boolean, default: false },
      contradictions: { type: [String], default: [] },
    },

    // Outcome Tracking (Requirement 6)
    outcomeTracking: {
      status15m: { type: mongoose.Schema.Types.Mixed, default: null },
      status30m: { type: mongoose.Schema.Types.Mixed, default: null },
      status1h: { type: mongoose.Schema.Types.Mixed, default: null },
      status4h: { type: mongoose.Schema.Types.Mixed, default: null },
    },
  },
  {
    timestamps: true,
    collection: "aiDecisionValidations",
  }
);

export const AiDecisionValidation =
  mongoose.models.AiDecisionValidation ||
  mongoose.model("AiDecisionValidation", aiDecisionValidationSchema);
