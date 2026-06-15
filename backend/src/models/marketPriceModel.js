import mongoose from "mongoose";

const marketPriceSchema = new mongoose.Schema(
  {
    _id: {
      type: String, // Normalized pair name (e.g. "XAUUSD")
      required: true,
    },
    pair: {
      type: String,
      required: true,
      index: true,
    },
    symbol: {
      type: String, // Provider symbol (e.g. "GC=F")
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    bid: {
      type: Number,
      default: null,
    },
    ask: {
      type: Number,
      default: null,
    },
    lastUpdated: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    collection: "marketPrices",
    timestamps: true,
  }
);

export const MarketPrice =
  mongoose.models.MarketPrice ||
  mongoose.model("MarketPrice", marketPriceSchema);
