import mongoose from "mongoose";

const rawMessageSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      required: true,
      index: true,
    },
    messageId: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      default: "",
    },
    hasText: {
      type: Boolean,
      default: false,
      index: true,
    },
    hasMedia: {
      type: Boolean,
      default: false,
      index: true,
    },
    mediaType: {
      type: String,
      default: null,
    },
    textLength: {
      type: Number,
      default: 0,
    },
    timestamp: {
      type: Date,
      default: null,
    },
    fetchedAt: {
      type: Date,
      required: true,
    },
  },
  {
    collection: "rawMessages",
    timestamps: true,
  }
);

rawMessageSchema.index(
  {
    channel: 1,
    messageId: 1,
  },
  {
    unique: true,
  }
);

export const RawMessage =
  mongoose.models.RawMessage || mongoose.model("RawMessage", rawMessageSchema);
