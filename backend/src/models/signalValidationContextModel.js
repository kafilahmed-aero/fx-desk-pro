import mongoose from "mongoose";

const validationErrorSchema = new mongoose.Schema(
  {
    code: String,
    field: String,
    message: String
  },
  { _id: false }
);

const entryZoneSchema = new mongoose.Schema(
  {
    lower: Number,
    upper: Number
  },
  { _id: false }
);

const lastEvaluationSchema = new mongoose.Schema(
  {
    timestamp: Date,
    marketPrice: Number,
    result: String
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    type: { type: String, default: null },
    plannedEntry: { type: Number, default: null },
    entryZone: { type: entryZoneSchema, default: null },
    currentMarketPrice: { type: Number, default: null },
    planningTimestamp: { type: Date, default: null },
    planningReason: { type: String, default: null },
    status: { type: String, default: null },
    executionMode: { type: String, default: null },
    executionStatus: {
      type: String,
      enum: [
        "READY_FOR_EXECUTION",
        "WAITING_FOR_PRICE",
        "EXECUTED",
        "CANCELLED",
        "EXPIRED",
        "FAILED",
        null
      ],
      default: null,
      index: true
    },
    scheduledAt: { type: Date, default: null },
    nextEvaluationTime: { type: Date, default: null },
    schedulerVersion: { type: String, default: null },
    schedulerReason: { type: String, default: null },
    lastEvaluation: { type: lastEvaluationSchema, default: null },
    promotionTimestamp: { type: Date, default: null },
    promotionReason: { type: String, default: null },
    ticket: { type: String, default: null },
    fillPrice: { type: Number, default: null },
    executedAt: { type: Date, default: null },
    executionResult: { type: String, default: null },
    failureReason: { type: String, default: null },
    failedAt: { type: Date, default: null }
  },
  { _id: false }
);

const monitoringSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["NOT_STARTED", "MONITORING", "POSITION_OPEN", "POSITION_CLOSED", "COMPLETED"],
      default: "NOT_STARTED",
      index: true
    },
    startedAt: { type: Date, default: null },
    lastUpdate: { type: Date, default: null },
    lastKnownPrice: { type: Number, default: null },
    positionOpenedAt: { type: Date, default: null },
    positionClosedAt: { type: Date, default: null },
    closeReason: { type: String, default: null },
    lastEvent: { type: String, default: null },
    lastEventTimestamp: { type: Date, default: null }
  },
  { _id: false }
);

const outcomeSchema = new mongoose.Schema(
  {
    result: {
      type: String,
      enum: ["FULL_TP", "SL_HIT", "MANUAL_CLOSE", "CANCELLED", "EXPIRED", "UNKNOWN", null],
      default: null
    },
    closedAt: { type: Date, default: null },
    closePrice: { type: Number, default: null },
    profit: { type: Number, default: null },
    pips: { type: Number, default: null },
    tradeDuration: { type: Number, default: null }
  },
  { _id: false }
);

const ratingSchema = new mongoose.Schema(
  {
    processed: { type: Boolean, default: false, index: true },
    processedAt: { type: Date, default: null }
  },
  { _id: false }
);

const processingSchema = new mongoose.Schema(
  {
    lockedBy: { type: String, default: null },
    lockTimestamp: { type: Date, default: null },
    heartbeat: { type: Date, default: null }
  },
  { _id: false }
);

const signalValidationContextSchema = new mongoose.Schema(
  {
    signalId: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },
    channelId: { type: String, default: null },
    channelName: { type: String, required: true, index: true },
    symbol: { type: String, required: true, index: true },
    direction: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true
    },
    entry: { type: Number, required: true },
    entryFrom: { type: Number, default: null },
    entryTo: { type: Number, default: null },
    stopLoss: { type: Number, required: true },
    takeProfits: { type: [Number], required: true },
    receivedTimestamp: { type: Date, required: true },
    parserTimestamp: { type: Date, required: true },

    pipelineStatus: {
      type: String,
      enum: [
        "NEW",
        "VALIDATED",
        "PLANNED",
        "SCHEDULED",
        "WAITING_FOR_PRICE",
        "READY_FOR_EXECUTION",
        "EXECUTED",
        "POSITION_OPEN",
        "POSITION_CLOSED",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "EXPIRED"
      ],
      required: true,
      index: true
    },

    validationErrors: { type: [validationErrorSchema], default: [] },
    order: { type: orderSchema, default: () => ({}) },
    monitoring: { type: monitoringSchema, default: () => ({}) },
    outcome: { type: outcomeSchema, default: () => ({}) },
    rating: { type: ratingSchema, default: () => ({}) },
    processing: { type: processingSchema, default: () => ({}) },

    schemaVersion: { type: Number, default: 1 },
    contextVersion: { type: Number, default: 1 }
  },
  {
    timestamps: true,
    optimisticConcurrency: true
  }
);

// Compound Index Declarations for efficient query orchestration
signalValidationContextSchema.index({ pipelineStatus: 1, "order.executionStatus": 1 });
signalValidationContextSchema.index({ pipelineStatus: 1, "monitoring.status": 1 });
signalValidationContextSchema.index({ pipelineStatus: 1, "rating.processed": 1 });

export const SignalValidationContextModel = mongoose.model(
  "SignalValidationContext",
  signalValidationContextSchema
);
