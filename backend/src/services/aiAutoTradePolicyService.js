import { config } from "../config/env.js";
import { isAiTradingSessionActive, hasEmergencyMacroEvent } from "./tradingSessionService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { logger } from "../utils/logger.js";
import mongoose from "mongoose";

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Evaluates whether a recommendation qualifies for MT5 auto-trade execution.
 * @param {Object} rec - The parsed AI recommendation object.
 * @param {Object} context - Pipeline context containing news, consensus weights, etc.
 * @returns {Promise<{ shouldExecute: boolean, reasons: string[] }>}
 */
export async function evaluateAutoTradePolicy(rec, context = {}) {
  const reasons = [];

  // 1. Check if auto-trading is enabled globally
  if (!config.autoTrade.enabled) {
    reasons.push("AI auto-trading is disabled globally (AUTO_TRADE_ENABLED=false)");
  }

  // 2. Direction must be BUY or SELL
  const direction = String(rec.direction || "").toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") {
    reasons.push(`AI returned HOLD or invalid direction: ${direction}`);
  }

  // 3. Confidence threshold check
  const confidence = Number(rec.confidence) || 0;
  if (confidence < config.autoTrade.minConfidence) {
    reasons.push(`Confidence (${confidence}%) below threshold (${config.autoTrade.minConfidence}%)`);
  }

  // 4. Expected move check (Math.abs(tp - entry))
  const entryPrice = rec.simulatedEntryPrice || ((Number(rec.entryMin) + Number(rec.entryMax)) / 2) || rec.entryMin || 0;
  const tpPrice = rec.tp || rec.lowRiskTp || 0;
  const expectedMove = Math.abs(tpPrice - entryPrice);
  if (expectedMove < config.autoTrade.minTarget) {
    reasons.push(`Expected move ($${expectedMove.toFixed(2)}) below target ($${config.autoTrade.minTarget.toFixed(2)})`);
  }

  // 5. Risk / Reward check
  const rr = rec.riskReward?.lowRisk || 0;
  if (rr < config.autoTrade.minRR) {
    reasons.push(`Risk/Reward (${rr}) below minimum (${config.autoTrade.minRR})`);
  }

  // 6. Session check (Removed per continuous Phoenix decision engine requirement)

  // 7. News block check
  const newsContext = context.newsContext || {};
  const newsBlock = hasEmergencyMacroEvent(newsContext);
  if (newsBlock) {
    reasons.push("High-impact macroeconomic news block is active");
  }

  // 8. Open position check (No existing FX Desk Pro managed XAUUSD position open)
  if (isMongoConnected()) {
    try {
      const openCount = await AiRecommendationOutcome.countDocuments({
        pair: "XAUUSD",
        simulationMode: "DEMO",
        executionState: { $in: ["ORDER_SENT", "ORDER_ACCEPTED", "ORDER_FILLED", "POSITION_OPEN"] }
      });
      if (openCount > 0) {
        reasons.push(`An active FX Desk Pro managed XAUUSD position (${openCount}) is already open`);
      }
    } catch (err) {
      logger.error("auto_trade.position_check_failed", { error: err.message });
      reasons.push(`Database error checking open positions: ${err.message}`);
    }
  }

  const shouldExecute = reasons.length === 0;

  if (!shouldExecute) {
    logger.info("auto_trade.skipped", {
      recommendationId: rec.recommendationId,
      direction: rec.direction,
      reasons
    });
  } else {
    logger.info("auto_trade.approved", {
      recommendationId: rec.recommendationId,
      direction: rec.direction,
      lotSize: config.autoTrade.lotSize
    });
  }

  return {
    shouldExecute,
    reasons
  };
}
