import mongoose from "mongoose";

const aiRecommendationOutcomeSchema = new mongoose.Schema(
  {
    recommendationId: {
      type: String, // Human-readable ID (AI-YYYYMMDD-HHMMSS-XXXX)
      required: true,
      unique: true,
      index: true,
    },
    recommendationVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    generatedTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    pair: {
      type: String,
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["BUY", "SELL", "HOLD"],
      required: true,
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
    lowRiskTp: {
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
    tradeQuality: {
      type: String,
      enum: ["Excellent", "Good", "Average", "Poor"],
      default: null,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    riskReward: {
      lowRisk: { type: Number, default: null },
      moderate: { type: Number, default: null },
      high: { type: Number, default: null }
    },
    estimatedHoldingTime: {
      type: String,
      default: null,
    },
    tradeStyle: {
      type: String,
      enum: ["Scalp", "Intraday", "Swing"],
      default: null,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "PARTIAL_TP", "BREAK_EVEN", "FULL_TP", "SL", "EXPIRED", "CANCELLED", "SUPERSEDED"],
      default: "PENDING",
      index: true,
    },
    hitTargets: {
      type: [Number],
      default: [],
    },
    exitType: {
      type: String,
      enum: ["BREAK_EVEN", "TP", "SL", null],
      default: null,
    },
    closedAtBreakEven: {
      type: Boolean,
      default: false,
    },
    triggerSource: {
      type: String,
      default: null,
    },
    generationTimeMs: {
      type: Number,
      default: null,
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
    // Paper Trading / Simulation Engine (Phase 5.4.1)
    simulatedEntryPrice: {
      type: Number,
      default: null,
    },
    simulatedEntryTime: {
      type: Date,
      default: null,
    },
    simulatedSL: {
      type: Number,
      default: null,
    },
    outcomePrice: {
      type: Number,
      default: null,
    },
    outcomeTime: {
      type: Date,
      default: null,
    },
    simulationMode: {
      type: String,
      enum: ["PAPER", "DEMO", "LIVE"],
      default: "PAPER",
    },
    aiSnapshot: {
      confidence: { type: Number, default: null },
      tradeQuality: { type: String, default: null },
      confluenceScore: { type: Number, default: null },
      tradeFilter: { type: String, default: null },
      overallConfluence: { type: Number, default: null },
    },
    simulationNotes: {
      type: [String],
      default: [],
    },
    // Paper Trading Risk Manager (Phase 5.4.2)
    executionStatus: {
      type: String,
      enum: ["WAITING", "EXECUTED", "BLOCKED", "EXPIRED"],
      default: "WAITING",
      index: true,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    plannedRiskR: {
      type: Number,
      default: 1,
    },
    blockReason: {
      type: String,
      enum: ["MAX_OPEN_TRADES", "DAILY_LIMIT_REACHED", "DAILY_TARGET_REACHED", "COOLDOWN_ACTIVE", "MAX_CONSECUTIVE_LOSSES", null],
      default: null,
    },
    riskRMultiple: {
      type: Number,
      default: null,
    },
    // MT5 Demo Integration Execution Metadata (Phase 6.1)
    mt5TicketId: {
      type: String,
      default: null,
    },
    magicNumber: {
      type: Number,
      default: null,
    },
    mt5AccountId: {
      type: String,
      default: null,
    },
    actualEntryPrice: {
      type: Number,
      default: null,
    },
    actualExitPrice: {
      type: Number,
      default: null,
    },
    executionSlippage: {
      type: Number,
      default: null,
    },
    executionLatencyMs: {
      type: Number,
      default: null,
    },
    brokerName: {
      type: String,
      default: null,
    },
    serverName: {
      type: String,
      default: null,
    },
    accountNumber: {
      type: String,
      default: null,
    },
    spreadAtEntry: {
      type: Number,
      default: null,
    },
    executionState: {
      type: String,
      enum: ["WAITING_FOR_MT5", "ORDER_SENT", "ORDER_ACCEPTED", "ORDER_FILLED", "POSITION_OPEN", "POSITION_CLOSED", "SYNC_COMPLETE", null],
      default: null,
    },
    lastMt5Sync: {
      type: Date,
      default: null,
    },
    grade: {
      type: String,
      default: null,
    },
    subsystemScores: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    marketContext: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    collection: "aiRecommendationOutcomes",
    timestamps: true,
  }
);

export const AiRecommendationOutcome =
  mongoose.models.AiRecommendationOutcome ||
  mongoose.model("AiRecommendationOutcome", aiRecommendationOutcomeSchema);
