import mongoose from "mongoose";

const parsedSignalSchema = new mongoose.Schema(
  {
    pair: {
      type: String,
      default: null,
      index: true,
    },
    action: {
      type: String,
      enum: ["BUY", "SELL", null],
      default: null,
    },
    orderType: {
      type: String,
      enum: ["MARKET", "LIMIT", "STOP", null],
      default: null,
    },
    bias: {
      type: String,
      enum: ["BULLISH", "BEARISH", null],
      default: null,
      index: true,
    },
    entry: {
      type: Number,
      default: null,
    },
    entryRange: {
      type: [Number],
      default: [],
    },
    target: {
      type: Number,
      default: null,
    },
    targets: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    pipTargets: {
      type: [Number],
      default: [],
    },
    stopLoss: {
      type: Number,
      default: null,
    },
    hiddenStopLoss: {
      type: Boolean,
      default: false,
    },
    timeframe: {
      type: String,
      default: null,
      index: true,
    },
    timestamp: {
      type: Date,
      default: null,
      index: true,
    },
    channel: {
      type: String,
      required: true,
      index: true,
    },
    channelTitle: {
      type: String,
      default: null,
      index: true,
    },
    messageId: {
      type: Number,
      required: true,
    },
    rawText: {
      type: String,
      default: "",
    },
    normalizedText: {
      type: String,
      default: "",
    },
    extractionConfidence: {
      type: Number,
      required: true,
    },
    classification: {
      type: String,
      enum: ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL", "MARKET_ANALYSIS", "CANCEL_SIGNAL"],
      default: "NEW_SIGNAL",
    },
    parserClassification: {
      type: String,
      enum: ["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL", "MARKET_ANALYSIS", "CANCEL_SIGNAL"],
      default: "NEW_SIGNAL",
    },
    managementAction: {
      type: String,
      default: null,
    },
    resultAction: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lifecycleEvent: {
      type: String,
      default: null,
      index: true,
    },
    signalStatus: {
      type: String,
      enum: ["ACTIVE", "PARTIAL", "CLOSED", "EXPIRED", "CANCELLED"],
      default: "ACTIVE",
      index: true,
    },
    signalState: {
      type: String,
      enum: ["ACTIVE", "PARTIAL", "CLOSED", "EXPIRED", "CANCELLED"],
      default: "ACTIVE",
      index: true,
    },
    missingFields: {
      type: [String],
      default: [],
    },
    parseWarnings: {
      type: [String],
      default: [],
    },
    freshnessScore: {
      type: String,
      enum: ["VERY_FRESH", "FRESH", "AGING", "STALE", null],
      default: null,
      index: true,
    },
    freshnessWeight: {
      type: Number,
      default: null,
      index: true,
    },
    ageMinutes: {
      type: Number,
      default: null,
    },
    correlationKey: {
      type: String,
      default: null,
      index: true,
    },
    textStats: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    dedupe: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    possibleDuplicate: {
      type: Boolean,
      default: false,
      index: true,
    },
    duplicateMatch: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    updateContext: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    classificationReasons: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    parserError: {
      type: String,
      default: null,
    },
    effectiveStopLoss: {
      type: Number,
      default: null,
    },
    remainingTargets: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    lifecycleStage: {
      type: Number,
      default: 0,
    },
    isTestSignal: {
      type: Boolean,
      default: false,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    collection: "parsedSignals",
    timestamps: true,
  }
);

parsedSignalSchema.index({
  "dedupe.semanticSignature": 1,
});

parsedSignalSchema.index({
  "dedupe.clusterKey": 1,
  timestamp: -1,
});

parsedSignalSchema.index(
  {
    channel: 1,
    messageId: 1,
  },
  {
    unique: true,
  }
);

export const ParsedSignal =
  mongoose.models.ParsedSignal ||
  mongoose.model("ParsedSignal", parsedSignalSchema);
