import { getCachedPrice } from "./priceCacheService.js";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { broadcastToEAs } from "./mt5SyncService.js";
import { POSITION_MANAGER_POLICY } from "../config/positionManagerPolicy.js";
import { logger } from "../utils/logger.js";

let monitoringInterval = null;
let isCycleActive = false;

/**
 * Initializes position management reload recovery on backend startup.
 */
export function initPositionManager() {
  logger.info("position_manager.init_recovery_completed");
  startPositionMonitoring();
}

/**
 * Starts periodic monitoring interval.
 */
export function startPositionMonitoring() {
  if (monitoringInterval) return;
  monitoringInterval = setInterval(async () => {
    await monitorActivePositions();
  }, 3000); // Query active records every 3 seconds
}

/**
 * Stops monitoring interval.
 */
export function stopPositionMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

/**
 * Iterates through all open demo positions and evaluates triggers.
 */
export async function monitorActivePositions() {
  if (isCycleActive) return;
  isCycleActive = true;

  try {
    const activePositions = await AiRecommendationOutcome.find({
      simulationMode: "DEMO",
      status: "ACTIVE",
      executionState: "POSITION_OPEN"
    });

    for (const doc of activePositions) {
      try {
        await processPositionLifecycle(doc);
      } catch (err) {
        logger.error("position_manager.process_failed", { recommendationId: doc.recommendationId, error: err.message });
      }
    }
  } catch (err) {
    logger.error("position_manager.cycle_failed", { error: err.message });
  } finally {
    isCycleActive = false;
  }
}

/**
 * Main evaluation pipeline executing rules strictly in order:
 * 1. Position Exists (Checked by caller & schema fields)
 * 2. Time Exit
 * 3. Market Exit
 * 4. Break Even
 * 5. Partial TP
 * 6. Trailing Stop
 */
export async function processPositionLifecycle(doc) {
  // Safety Validation checks:
  if (!doc.mt5TicketId) return;
  if (["FULL_TP", "SL", "BREAK_EVEN", "EXPIRED", "CANCELLED"].includes(doc.status)) return;
  if (doc.executionState === "POSITION_CLOSED" || doc.executionState === "SYNC_COMPLETE") return;

  const priceInfo = getCachedPrice(doc.pair || "XAUUSD");
  if (!priceInfo || typeof priceInfo.price !== "number") {
    logger.warn("position_manager.stale_price_skipped", { pair: doc.pair });
    return;
  }

  const currentPrice = priceInfo.price;
  const entryPrice = doc.actualEntryPrice || doc.simulatedEntryPrice || doc.entryMin;
  if (!entryPrice) return;

  const direction = doc.direction; // BUY or SELL
  const tradeAgeMinutes = (Date.now() - new Date(doc.createdAt).getTime()) / (60.0 * 1000.0);

  // Initialize positionManagement schema parameters if missing
  if (!doc.positionManagement || typeof doc.positionManagement.history === "undefined") {
    doc.positionManagement = {
      breakEvenActive: false,
      breakEvenTriggered: false,
      trailingActive: false,
      lastTrailingSL: null,
      partialTpExecuted: false,
      remainingVolume: doc.volume,
      lifecycleStage: "POSITION_OPEN",
      history: [],
      pendingAction: null
    };
  }

  const pm = doc.positionManagement;
  
  // Guard clause: skip evaluating if a modification request is currently pending broker confirmation
  if (pm.pendingAction) {
    return;
  }

  // 1. Time Exit Check
  if (tradeAgeMinutes >= POSITION_MANAGER_POLICY.maxHoldingTimeMinutes) {
    pm.pendingAction = "TIME_EXIT";
    await doc.save();
    
    logger.info("position_manager.trigger_time_exit", { recommendationId: doc.recommendationId, ticket: doc.mt5TicketId });
    
    broadcastToEAs({
      action: "CLOSE_ORDER",
      recommendationId: doc.recommendationId,
      magicNumber: doc.magicNumber,
      ticket: doc.mt5TicketId
    }, doc.mt5AccountId);
    return;
  }

  // 2. Market Exit Check
  if (pm.marketExitRequested) {
    pm.pendingAction = "MARKET_EXIT";
    await doc.save();
    
    logger.info("position_manager.trigger_market_exit", { recommendationId: doc.recommendationId, ticket: doc.mt5TicketId });
    
    broadcastToEAs({
      action: "CLOSE_ORDER",
      recommendationId: doc.recommendationId,
      magicNumber: doc.magicNumber,
      ticket: doc.mt5TicketId
    }, doc.mt5AccountId);
    return;
  }

  // Current profit distance in points/USD (Gold)
  const profitDistance = direction === "BUY" ? (currentPrice - entryPrice) : (entryPrice - currentPrice);

  // 3. Break Even Check
  if (!pm.breakEvenTriggered) {
    if (profitDistance >= POSITION_MANAGER_POLICY.breakEvenTriggerDistance) {
      pm.pendingAction = "BREAK_EVEN";
      pm.pendingSL = entryPrice;
      await doc.save();
      
      logger.info("position_manager.trigger_break_even", { recommendationId: doc.recommendationId, targetSL: entryPrice });
      
      broadcastToEAs({
        action: "MODIFY_ORDER",
        recommendationId: doc.recommendationId,
        magicNumber: doc.magicNumber,
        ticket: doc.mt5TicketId,
        sl: entryPrice,
        tp: doc.lowRiskTp || doc.moderateTp || doc.highRiskTp || null
      }, doc.mt5AccountId);
      return;
    }
  }

  // 4. Partial Take Profit Check
  if (!pm.partialTpExecuted) {
    if (profitDistance >= POSITION_MANAGER_POLICY.partialTpTriggerDistance) {
      const closeVol = Number((doc.volume * POSITION_MANAGER_POLICY.partialTpCloseRatio).toFixed(2));
      pm.pendingAction = "PARTIAL_TP";
      pm.pendingVolume = closeVol;
      await doc.save();
      
      logger.info("position_manager.trigger_partial_tp", { recommendationId: doc.recommendationId, closeVol });
      
      broadcastToEAs({
        action: "CLOSE_ORDER",
        recommendationId: doc.recommendationId,
        magicNumber: doc.magicNumber,
        ticket: doc.mt5TicketId,
        volume: closeVol
      }, doc.mt5AccountId);
      return;
    }
  }

  // 5. Trailing Stop Check
  if (profitDistance >= POSITION_MANAGER_POLICY.trailingStartDistance) {
    const calculatedSL = direction === "BUY" 
      ? Number((currentPrice - POSITION_MANAGER_POLICY.trailingDistance).toFixed(2))
      : Number((currentPrice + POSITION_MANAGER_POLICY.trailingDistance).toFixed(2));

    const currentSL = pm.lastTrailingSL || doc.simulatedSL || doc.sl || 0;

    const shouldTighten = direction === "BUY" ? (calculatedSL > currentSL) : (calculatedSL < currentSL);
    
    if (shouldTighten) {
      pm.pendingAction = "TRAILING_STOP";
      pm.pendingSL = calculatedSL;
      await doc.save();
      
      logger.info("position_manager.trigger_trailing_stop", { recommendationId: doc.recommendationId, trailingSL: calculatedSL });
      
      broadcastToEAs({
        action: "MODIFY_ORDER",
        recommendationId: doc.recommendationId,
        magicNumber: doc.magicNumber,
        ticket: doc.mt5TicketId,
        sl: calculatedSL,
        tp: doc.lowRiskTp || doc.moderateTp || doc.highRiskTp || null
      }, doc.mt5AccountId);
      return;
    }
  }
}

/**
 * Exposes a manual/DE request to exit an active position early.
 */
export async function requestMarketExit(recommendationId, reason = "Decision Engine hold state triggered early close.") {
  const doc = await AiRecommendationOutcome.findOne({ recommendationId });
  if (doc && doc.status === "ACTIVE" && doc.executionState === "POSITION_OPEN") {
    if (!doc.positionManagement) {
      doc.positionManagement = {
        breakEvenActive: false,
        breakEvenTriggered: false,
        trailingActive: false,
        lastTrailingSL: null,
        partialTpExecuted: false,
        remainingVolume: doc.volume,
        lifecycleStage: "POSITION_OPEN",
        history: [],
        pendingAction: null
      };
    }
    doc.positionManagement.marketExitRequested = true;
    doc.positionManagement.marketExitReason = reason;
    await doc.save();
    logger.info("position_manager.market_exit_requested", { recommendationId, reason });
    return true;
  }
  return false;
}
