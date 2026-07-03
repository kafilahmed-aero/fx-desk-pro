import mongoose from "mongoose";
import { ParsedSignal } from "../models/parsedSignalModel.js";
import { getParsedSignals } from "../services/parsedSignalStore.js";
import { logger } from "../utils/logger.js";

/**
 * Controller to fetch the latest 100 parsed signals.
 * Queries the ParsedSignal collection directly if connected,
 * otherwise falls back to the in-memory store.
 */
export async function getParsedSignalsController(req, res) {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const isMongoConnected = mongoose.connection.readyState === 1;
    if (isMongoConnected) {
      const signals = await ParsedSignal.find({})
        .sort({ createdAt: -1 })
        .limit(100);
      return res.status(200).json(signals);
    } else {
      // Offline fallback: fetch in-memory signals from the store
      const signals = await getParsedSignals(100);
      return res.status(200).json(signals);
    }
  } catch (error) {
    logger.error("api.get_parsed_signals_failed", { error: error.message });
    return res.status(500).json({ error: "Failed to retrieve parsed signals" });
  }
}
