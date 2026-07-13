import { getConfig } from "../config/systemConfigManager.js";

// Helper function to freeze objects recursively
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    deepFreeze(obj[key]);
  });
  return obj;
}

/**
 * Trade Lifecycle Manager Engine
 * Evaluates active trades against deterministic state transition rules.
 * 
 * @param {Object} inputs - Position properties and market context
 * @param {Object} configOverride - Dynamic configuration overrides
 * @returns {Object} Deep-frozen trade lifecycle report
 */
export function evaluateTradeLifecycle(inputs = {}, configOverride = null) {
  let activeConfig = null;
  try {
    activeConfig = getConfig();
  } catch (err) {}

  const config = {
    breakEvenTriggerPoints: 100.0,
    breakEvenOffsetPoints: 10.0,
    trailDistancePoints: 150.0,
    trailStepPoints: 20.0,
    partialProfitStages: [
      { triggerRR: 1, closePercent: 30 },
      { triggerRR: 2, closePercent: 30 },
      { triggerRR: 3, closePercent: 40 }
    ],
    maximumTradeDurationMin: 120,
    minimumProgressPoints: 20.0,
    marketExitThreshold: 50,
    emergencySpreadMultiplier: 3.0,
    ...((activeConfig && activeConfig.tradeLifecycle) || {}),
    ...(configOverride || {})
  };

  const position = inputs.position || {};
  const marketContext = inputs.marketContext || {};
  const currentSpread = Number(inputs.currentSpread || 1.5);
  const timestamp = inputs.timestamp || new Date().toISOString();

  const reasons = [];
  const warnings = [];

  const ticket = position.ticket || "N/A";
  const type = position.type || "BUY"; // "BUY" or "SELL"
  const openPrice = Number(position.openPrice || 0);
  const currentPrice = Number(position.currentPrice || openPrice || 0);
  const currentSL = Number(position.sl || 0);
  const currentTP = Number(position.tp || 0);
  const volume = Number(position.volume || 0.01);
  const slAtEntry = Number(position.slAtEntry || currentSL || (type === "BUY" ? openPrice - 15 : openPrice + 15));

  // Determine current lifecycle state or fallback to default
  const currentState = position.lifecycleState || "POSITION_OPEN";
  const partiallyClosedStages = Array.isArray(position.partiallyClosedStages) ? position.partiallyClosedStages : [];

  let nextState = currentState;
  let lifecycleAction = "HOLD_POSITION";
  let stopLoss = currentSL;
  let partialClosePercent = 0;
  let remainingVolume = volume;
  let lifecycleScore = 100;

  // 1. Basic Parameter Validations
  if (!openPrice || !currentPrice) {
    return deepFreeze({
      lifecycleState: currentState,
      lifecycleAction: "HOLD_POSITION",
      previousState: currentState,
      nextState: currentState,
      stopLoss: currentSL,
      remainingVolume: volume,
      partialClosePercent: 0,
      lifecycleScore: 0,
      reasons: ["Invalid position price parameters."],
      warnings: ["Missing position price parameters"],
      timestamp
    });
  }

  // 2. Closed State Verification
  if (currentState === "POSITION_CLOSED") {
    return deepFreeze({
      lifecycleState: "POSITION_CLOSED",
      lifecycleAction: "WAIT",
      previousState: "POSITION_CLOSED",
      nextState: "POSITION_CLOSED",
      stopLoss: currentSL,
      remainingVolume: 0,
      partialClosePercent: 0,
      lifecycleScore: 0,
      reasons: ["Position is already marked as CLOSED."],
      warnings: [],
      timestamp
    });
  }

  // 3. Spread Protection
  const maxSpreadLimit = Number(marketContext.spread?.metrics?.maxSpreadLimit || 3.0);
  const isEmergencySpread = currentSpread > maxSpreadLimit * config.emergencySpreadMultiplier;

  if (isEmergencySpread) {
    warnings.push(`Emergency spread active: ${currentSpread} exceeds multiplier threshold`);
    reasons.push("Emergency spread expansion detected. Protective modification trailing is frozen.");
  }

  // 4. Market Deterioration exit evaluation
  const isMarketLowScore = (marketContext.overallScore || 100) < config.marketExitThreshold;
  const isTrendOpposite = (type === "BUY" && marketContext.trend?.status?.includes("BEARISH")) ||
                          (type === "SELL" && marketContext.trend?.status?.includes("BULLISH"));
  const isStructureBad = marketContext.structure?.status === "UNFAVORABLE";

  if (isMarketLowScore && (isTrendOpposite || isStructureBad)) {
    lifecycleAction = "FULL_CLOSE";
    nextState = "POSITION_CLOSED";
    partialClosePercent = 100;
    remainingVolume = 0;
    reasons.push(`Market conditions deteriorated significantly. Exit triggered (Score: ${marketContext.overallScore}).`);
    return deepFreeze({
      lifecycleState: currentState,
      lifecycleAction,
      previousState: currentState,
      nextState,
      stopLoss,
      remainingVolume,
      partialClosePercent,
      lifecycleScore: 30,
      reasons,
      warnings,
      timestamp
    });
  }

  // 5. Time Exit evaluation
  if (position.timeOpen) {
    const timeOpenMs = new Date(timestamp).getTime() - new Date(position.timeOpen).getTime();
    const durationMin = timeOpenMs / 60000;
    if (durationMin >= config.maximumTradeDurationMin) {
      const progress = Math.abs(currentPrice - openPrice);
      if (progress < config.minimumProgressPoints) {
        lifecycleAction = "FULL_CLOSE";
        nextState = "POSITION_CLOSED";
        partialClosePercent = 100;
        remainingVolume = 0;
        reasons.push(`Trade open time exceeded limits (${Math.round(durationMin)} min) and failed to make progress.`);
        return deepFreeze({
          lifecycleState: currentState,
          lifecycleAction,
          previousState: currentState,
          nextState,
          stopLoss,
          remainingVolume,
          partialClosePercent,
          lifecycleScore: 40,
          reasons,
          warnings,
          timestamp
        });
      } else {
        reasons.push("Trade open time exceeded limit but healthy progress is being maintained.");
      }
    }
  }

  // Calculate execution stats
  const entryRisk = Math.abs(openPrice - slAtEntry) || 15.0;
  const currentReward = type === "BUY" ? (currentPrice - openPrice) : (openPrice - currentPrice);
  const currentRR = entryRisk > 0 ? (currentReward / entryRisk) : 0;
  const profitPoints = type === "BUY" ? (currentPrice - openPrice) : (openPrice - currentPrice);

  // ==========================================
  // State 1: POSITION_OPEN -> BREAK_EVEN_PROTECTED
  // ==========================================
  const canTriggerBreakeven = currentState === "POSITION_OPEN" && profitPoints >= config.breakEvenTriggerPoints;

  if (canTriggerBreakeven) {
    const targetSL = type === "BUY"
      ? openPrice + config.breakEvenOffsetPoints
      : openPrice - config.breakEvenOffsetPoints;

    // Verify break-even never moves SL backwards (only tighter protection)
    const isSLBetter = type === "BUY" ? targetSL > currentSL : targetSL < currentSL;

    if (isSLBetter) {
      lifecycleAction = "MOVE_SL_TO_BREAKEVEN";
      nextState = "BREAK_EVEN_PROTECTED";
      stopLoss = Number(targetSL.toFixed(2));
      reasons.push(`Move Stop Loss to break-even + offset (${stopLoss}) since profit hit trigger.`);
      return deepFreeze({
        lifecycleState: currentState,
        lifecycleAction,
        previousState: currentState,
        nextState,
        stopLoss,
        remainingVolume,
        partialClosePercent,
        lifecycleScore,
        reasons,
        warnings,
        timestamp
      });
    }
  }

  // ==========================================
  // State 2: Partial TP Stages
  // ==========================================
  const stages = config.partialProfitStages || [];
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const stageId = i + 1; // stage number (1, 2, 3)

    if (currentRR >= stage.triggerRR && !partiallyClosedStages.includes(stageId)) {
      lifecycleAction = "PARTIAL_CLOSE";
      partialClosePercent = stage.closePercent;
      remainingVolume = Number((volume * (1 - stage.closePercent / 100)).toFixed(2));
      nextState = stageId === 3 ? "POSITION_CLOSED" : `PARTIAL_TP${stageId}`;
      reasons.push(`Triggered Partial TP${stageId} (RR ratio ${currentRR.toFixed(2)} reached trigger RR ${stage.triggerRR}).`);
      
      return deepFreeze({
        lifecycleState: currentState,
        lifecycleAction,
        previousState: currentState,
        nextState,
        stopLoss,
        remainingVolume,
        partialClosePercent,
        lifecycleScore,
        reasons,
        warnings,
        timestamp
      });
    }
  }

  // ==========================================
  // State 3: Trailing Stop (Only if break-even has already been applied)
  // ==========================================
  const hasBreakevenApplied = currentState !== "POSITION_OPEN";
  
  if (hasBreakevenApplied && !isEmergencySpread) {
    if (type === "BUY") {
      const distance = currentPrice - currentSL;
      if (distance > config.trailDistancePoints) {
        const targetSL = currentPrice - config.trailDistancePoints;
        // Never worsen stop loss protection
        if (targetSL > currentSL && (targetSL - currentSL) >= config.trailStepPoints) {
          lifecycleAction = "TRAIL_STOP";
          nextState = "TRAILING_ACTIVE";
          stopLoss = Number(targetSL.toFixed(2));
          reasons.push(`Trail Stop Loss to ${stopLoss} (distance from price exceeds ${config.trailDistancePoints} points)`);
        }
      }
    } else if (type === "SELL") {
      const distance = currentSL - currentPrice;
      if (distance > config.trailDistancePoints) {
        const targetSL = currentPrice + config.trailDistancePoints;
        // Never worsen stop loss protection
        if (targetSL < currentSL && (currentSL - targetSL) >= config.trailStepPoints) {
          lifecycleAction = "TRAIL_STOP";
          nextState = "TRAILING_ACTIVE";
          stopLoss = Number(targetSL.toFixed(2));
          reasons.push(`Trail Stop Loss to ${stopLoss} (distance from price exceeds ${config.trailDistancePoints} points)`);
        }
      }
    }
  }

  return deepFreeze({
    lifecycleState: currentState,
    lifecycleAction,
    previousState: currentState,
    nextState,
    stopLoss,
    remainingVolume,
    partialClosePercent,
    lifecycleScore,
    reasons,
    warnings,
    timestamp
  });
}
