import mongoose from "mongoose";

const phoenixFeatureSchema = new mongoose.Schema({
  // Identity and Versioning
  tradeId: { type: String, required: true, unique: true },
  symbol: { type: String, required: true },
  featureVersion: { type: String, required: true, default: "1.0" },

  // Preserving raw completed trade memory snapshot data
  rawSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },

  // Engineered normalized features
  features: {
    // 1. Trade
    direction: { type: Number, required: true },
    lotSize: { type: Number, required: true },
    entryType: { type: Number, required: true },
    tradeDuration: { type: Number, required: true },
    risk: { type: Number, required: true },
    reward: { type: Number, required: true },
    rr: { type: Number, required: true },

    // 2. Consensus
    consensusScore: { type: Number, required: true },
    agreeingChannels: { type: Number, required: true },
    disagreeingChannels: { type: Number, required: true },
    signalFreshness: { type: Number, required: true },

    // 3. Decision Engine
    finalScore: { type: Number, required: true },
    grade: { type: Number, required: true },
    confidence: { type: Number, required: true },
    warningCount: { type: Number, required: true },
    reasonCount: { type: Number, required: true },

    // 4. Market Intelligence
    overallScore: { type: Number, required: true },
    trendScore: { type: Number, required: true },
    structureScore: { type: Number, required: true },
    sessionScore: { type: Number, required: true },
    volatilityScore: { type: Number, required: true },
    spreadScore: { type: Number, required: true },

    // 5. Smart Entry
    entryQuality: { type: Number, required: true },
    strategy: { type: Number, required: true },
    chasingFlag: { type: Number, required: true },
    expectedRR: { type: Number, required: true },

    // 6. Lifecycle
    breakEvenTriggered: { type: Number, required: true },
    trailingActivated: { type: Number, required: true },
    partialTpCount: { type: Number, required: true },
    timeExit: { type: Number, required: true },
    marketExit: { type: Number, required: true },

    // 7. Result
    winLoss: { type: Number, required: true },
    profit: { type: Number, required: true },
    drawdown: { type: Number, required: true },
    mfe: { type: Number, required: true },
    mae: { type: Number, required: true },
    rMultiple: { type: Number, required: true }
  },

  // Metadata warnings recorded during generation (resilience)
  warnings: [String]
}, {
  timestamps: true
});

phoenixFeatureSchema.index({ symbol: 1 });

// Tight immutability blocks to prevent updates or deletions (append-only ledger)
const blockMutation = function(next) {
  next(new Error("Phoenix trade features are append-only. Modifying or deleting records is prohibited."));
};

phoenixFeatureSchema.pre("save", function(next) {
  if (!this.isNew) {
    return next(new Error("Phoenix trade features are append-only. Modifying existing records is prohibited."));
  }
  next();
});

phoenixFeatureSchema.pre("updateOne", blockMutation);
phoenixFeatureSchema.pre("updateMany", blockMutation);
phoenixFeatureSchema.pre("findOneAndUpdate", blockMutation);
phoenixFeatureSchema.pre("findOneAndDelete", blockMutation);
phoenixFeatureSchema.pre("deleteOne", blockMutation);
phoenixFeatureSchema.pre("deleteMany", blockMutation);

export const PhoenixTradeFeature = mongoose.model(
  "PhoenixTradeFeature",
  phoenixFeatureSchema,
  "phoenixTradeFeature"
);
