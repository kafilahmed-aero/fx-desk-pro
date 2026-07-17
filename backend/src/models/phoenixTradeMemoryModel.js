import mongoose from "mongoose";

const phoenixTradeMemorySchema = new mongoose.Schema({
  schemaVersion: { type: String, required: true, default: "1.0" },
  engineVersion: { type: String, required: true, default: "FX Desk Pro v1.0" },

  // 1. Identity
  tradeId: { type: String, required: true, unique: true },
  opportunityId: { type: String, default: null },
  symbol: { type: String, required: true },
  direction: { type: String, required: true }, // "BUY" or "SELL"
  broker: { type: String, default: "Demo Broker" },
  accountType: { type: String, default: "DEMO" }, // "DEMO" or "LIVE"
  accountNumber: { type: String, default: "N/A" },
  executionId: { type: String, default: null },

  // 2. Signal Information
  signalInfo: {
    channels: [String],
    consensusPercentage: { type: Number, default: 0 },
    agreeingChannels: { type: Number, default: 0 },
    disagreeingChannels: { type: Number, default: 0 },
    parsedSignal: mongoose.Schema.Types.Mixed,
    originalSignal: { type: String, default: "" },
    confidence: { type: Number, default: 0 }
  },

  // 3. Decision Engine Snapshot
  decisionEngine: {
    decision: { type: String, required: true }, // "BUY", "SELL", "HOLD"
    grade: { type: String, default: "GRADE C" },
    finalScore: { type: Number, default: 0 },
    decisionBreakdown: mongoose.Schema.Types.Mixed,
    reasons: [String],
    warnings: [String]
  },

  // 4. Market Intelligence Snapshot
  marketContext: mongoose.Schema.Types.Mixed,

  // 5. Smart Entry Snapshot
  smartEntry: {
    recommendedStrategy: { type: String, required: true }, // "MARKET", "LIMIT", "STOP", "WAIT"
    alternativeStrategy: { type: String, default: "" },
    entryQuality: { type: String, default: "GRADE B" },
    entryPrice: { type: Number, default: 0 },
    entryRR: { type: Number, default: 0 }
  },

  // 6. Trade Execution & Quality Stats
  execution: {
    requestedEntry: { type: Number, default: 0 },
    actualFill: { type: Number, default: 0 },
    slippage: { type: Number, default: 0 },
    spread: { type: Number, default: 0 },
    lotSize: { type: Number, default: 0.01 },
    stopLoss: { type: Number, default: 0 },
    takeProfit: { type: Number, default: 0 },
    orderType: { type: String, default: "" },
    executionLatencyMs: { type: Number, default: 0 },
    brokerRetcode: { type: String, default: "0" }
  },

  // 7. Lifecycle Timeline
  lifecycleTimeline: [
    {
      timestamp: { type: Date, default: Date.now },
      event: { type: String, required: true }, // e.g. "Trade Opened", "Break Even Activated", "Partial TP1"
      metadata: mongoose.Schema.Types.Mixed
    }
  ],

  // 8. Final Result & Outcome Classification
  result: {
    outcome: {
      type: String,
      required: true,
      enum: ["FULL_TP", "PARTIAL_TP", "SL", "TIME_EXIT", "MARKET_EXIT", "BREAKEVEN", "MANUAL_CLOSE", "EMERGENCY_EXIT"]
    },
    netProfit: { type: Number, default: 0 },
    grossProfit: { type: Number, default: 0 },
    grossLoss: { type: Number, default: 0 },
    rMultiple: { type: Number, default: 0 },
    rrAchieved: { type: Number, default: 0 },
    drawdown: { type: Number, default: 0 },
    mfe: { type: Number, default: 0 }, // Maximum Favorable Excursion
    mae: { type: Number, default: 0 }, // Maximum Adverse Excursion
    durationMs: { type: Number, default: 0 },
    exitReason: { type: String, default: "" },
    closeTime: { type: Date, required: true }
  },

  // 9. Normalized ML Feature Vector
  featureVector: {
    consensusScore: { type: Number, default: 0 },
    marketScore: { type: Number, default: 0 },
    trendScore: { type: Number, default: 0 },
    structureScore: { type: Number, default: 0 },
    volatilityScore: { type: Number, default: 0 },
    spreadScore: { type: Number, default: 0 },
    decisionScore: { type: Number, default: 0 },
    entryQualityScore: { type: Number, default: 0 }, // 3=A, 2=B, 1=C, 0=POOR
    rrRatio: { type: Number, default: 0 },
    sessionScore: { type: Number, default: 0 } // e.g. 1=London, 2=NY, 3=Asian
  },

  // 10. Environment
  environment: {
    session: { type: String, default: "" }, // "London", "NY", "Asian"
    weekday: { type: String, default: "" }, // "Monday", "Tuesday" etc.
    timestamp: { type: Date, default: Date.now },
    marketOpen: { type: Boolean, default: true },
    newsStatus: { type: String, default: "LOW_IMPACT" },
    configSnapshot: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Configure appropriate database indexes for performance/scaling
phoenixTradeMemorySchema.index({ symbol: 1 });
phoenixTradeMemorySchema.index({ "environment.session": 1 });
phoenixTradeMemorySchema.index({ "decisionEngine.decision": 1 });
phoenixTradeMemorySchema.index({ "decisionEngine.grade": 1 });
phoenixTradeMemorySchema.index({ "result.outcome": 1 });
phoenixTradeMemorySchema.index({ "result.closeTime": 1 });

// Airtight ledger immutability hooks
const blockMutation = function(next) {
  next(new Error("Phoenix trade memory is append-only. Modifying or deleting records is prohibited."));
};

phoenixTradeMemorySchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix trade memory is append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixTradeMemorySchema.pre("updateOne", blockMutation);
phoenixTradeMemorySchema.pre("updateMany", blockMutation);
phoenixTradeMemorySchema.pre("findOneAndUpdate", blockMutation);
phoenixTradeMemorySchema.pre("findOneAndDelete", blockMutation);
phoenixTradeMemorySchema.pre("deleteOne", blockMutation);
phoenixTradeMemorySchema.pre("deleteMany", blockMutation);

export const PhoenixTradeMemory = mongoose.model(
  "PhoenixTradeMemory",
  phoenixTradeMemorySchema,
  "phoenixTradeMemory"
);
