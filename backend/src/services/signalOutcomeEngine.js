import { saveOutcome, getOutcomeByMessageKey, getActiveAndPendingOutcomes } from "./signalOutcomeStore.js";
import { logger } from "../utils/logger.js";
import { updateParsedSignalState, updateParsedSignalLifecycle } from "./parsedSignalStore.js";
import { updateInMemorySignalState, updateInMemorySignalLifecycle } from "./pairStateEngine.js";


const DEFAULT_EXPIRATION_HOURS = 72;

const OUTCOME_TO_SIGNAL_STATE_MAP = {
  PENDING: "ACTIVE",
  ACTIVE: "ACTIVE",
  PARTIAL_TP: "PARTIAL",
  FULL_TP: "CLOSED",
};

const STATE_HIERARCHY = {
  PENDING: 1,
  ACTIVE: 2,
  PARTIAL_TP: 3,
  FULL_TP: 4,
  SL_HIT: 4,
  EXPIRED: 4,
  CANCELLED: 4,
};


/**
 * Resolves a pair name to its pip decimal scale factor
 * @param {string} pair - Normalized pair name
 * @returns {number} The scale value for 1 pip
 */
export function getPipValue(pair) {
  const normalized = String(pair).toUpperCase().replace(/[^A-Z0-9]/g, "");

  // 1. Metals
  if (["XAUUSD", "GOLD", "XAU"].includes(normalized)) {
    return 0.1;
  }
  if (["XAGUSD", "SILVER", "XAG"].includes(normalized)) {
    return 0.01;
  }

  // 2. JPY Pairs
  if (normalized.endsWith("JPY")) {
    return 0.01;
  }

  // 3. Crypto / Indices
  if (
    normalized.startsWith("BTC") || 
    normalized.startsWith("ETH") || 
    normalized.startsWith("SOL") ||
    ["US30", "DOW", "DOWJONES", "NAS100", "NASDAQ", "USTEC", "SPX500", "US100", "GER30", "GER40", "UK100"].includes(normalized)
  ) {
    return 1.0;
  }

  // 4. Commodities
  if (["USOIL", "WTI", "UKOIL", "BRENT", "NATGAS"].includes(normalized)) {
    return 0.01;
  }

  // 5. Default Forex (EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, etc.)
  return 0.0001;
}

/**
 * Initializes a new SignalOutcome record from a ParsedSignal
 * @param {Object} signal - The stored ParsedSignal document
 * @returns {Promise<Object|null>} The initialized outcome object or null
 */
export async function initializeOutcome(signal) {
  // Validate action and pair
  const classification = signal.parserClassification || signal.classification;
  if (classification !== "NEW_SIGNAL" || !signal.pair || !signal.action) {
    return null;
  }

  const messageKey = `${signal.channel}:${signal.messageId}`;
  
  // Format Entry Information
  let entryType = "PRICE";
  let entryPrice = signal.entry;
  let entryLow = null;
  let entryHigh = null;

  if (Array.isArray(signal.entryRange) && signal.entryRange.length > 0) {
    const numericRange = signal.entryRange
      .map(Number)
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
    
    if (numericRange.length >= 2) {
      entryType = "RANGE";
      entryLow = numericRange[0];
      entryHigh = numericRange[numericRange.length - 1];
      entryPrice = (entryLow + entryHigh) / 2; // Midpoint representation
    } else if (numericRange.length === 1) {
      entryPrice = numericRange[0];
    }
  }

  // Format Targets Information
  const targets = [];
  let targetsPopulated = false;
  
  if (Array.isArray(signal.targets) && signal.targets.length > 0) {
    signal.targets.forEach((tgt, index) => {
      const price = typeof tgt === "object" ? Number(tgt.price) : Number(tgt);
      if (!isNaN(price)) {
        targets.push({
          targetNumber: index + 1,
          price,
          isHit: false,
          hitAt: null,
          hitPrice: null,
        });
        targetsPopulated = true;
      }
    });
  }
  
  if (!targetsPopulated && signal.target) {
    const price = Number(signal.target);
    if (!isNaN(price)) {
      targets.push({
        targetNumber: 1,
        price,
        isHit: false,
        hitAt: null,
        hitPrice: null,
      });
      targetsPopulated = true;
    }
  }

  if (!targetsPopulated && Array.isArray(signal.pipTargets) && signal.pipTargets.length > 0 && typeof entryPrice === "number" && !isNaN(entryPrice)) {
    const pipValue = getPipValue(signal.pair);
    signal.pipTargets.forEach((pipTgt, index) => {
      const pips = Number(pipTgt);
      if (!isNaN(pips)) {
        let price;
        if (signal.action === "BUY") {
          price = entryPrice + pips * pipValue;
        } else if (signal.action === "SELL") {
          price = entryPrice - pips * pipValue;
        }
        if (price !== undefined) {
          const decimals = Math.max(2, (entryPrice.toString().split(".")[1] || "").length, (pipValue.toString().split(".")[1] || "").length);
          price = Number(price.toFixed(decimals));
          targets.push({
            targetNumber: index + 1,
            price,
            isHit: false,
            hitAt: null,
            hitPrice: null,
          });
        }
      }
    });
  }

  // Expiration calculation (Default 72 Hours)
  const createdAt = signal.createdAt ? new Date(signal.createdAt) : new Date();
  const expiresAt = new Date(createdAt.getTime() + DEFAULT_EXPIRATION_HOURS * 60 * 60 * 1000);

  const outcomeData = {
    signalId: signal._id,
    messageKey,
    channel: signal.channel,
    pair: signal.pair,
    action: signal.action,
    entry: {
      entryType,
      entryPrice,
      entryLow,
      entryHigh,
    },
    targets,
    stopLoss: signal.stopLoss ? Number(signal.stopLoss) : null,
    status: "PENDING",
    hitTargets: [],
    maxTargetHit: 0,
    outcomePrice: null,
    outcomeTime: null,
    outcomeReason: null,
    highestPriceSeen: null,
    lowestPriceSeen: null,
    expiresAt,
    lastCheckedAt: new Date(),
  };

  try {
    const saved = await saveOutcome(outcomeData);
    logger.info("outcome.initialized", {
      messageKey,
      pair: saved.pair,
      action: saved.action,
      entryType,
      expiresAt: saved.expiresAt,
    });
    return saved;
  } catch (error) {
    logger.error("outcome.initialization_failed", {
      messageKey,
      error: error.message,
    });
    return null;
  }
}

/**
 * Evaluates and updates an outcome record based on a new market price tick
 * @param {Object} outcome - The SignalOutcome document/object
 * @param {number} currentPrice - The current market price of the pair
 * @param {Date} timestamp - The price update timestamp
 * @returns {Promise<Object>} The updated outcome record
 */
export async function updateOutcomePrice(outcome, currentPrice, timestamp = new Date()) {
  const t = new Date(timestamp);
  const price = Number(currentPrice);
  if (isNaN(price) || price <= 0) {
    return outcome;
  }

  if (!Array.isArray(outcome.hitTargets)) {
    outcome.hitTargets = [];
  }

  // If already in a terminal state (FULL_TP, SL_HIT, EXPIRED, CANCELLED, BREAK_EVEN, SL), skip price updates
  if (["FULL_TP", "SL_HIT", "EXPIRED", "CANCELLED", "BREAK_EVEN", "SL"].includes(outcome.status)) {
    return outcome;
  }

  let statusChanged = false;
  let targetsChanged = false;
  const originalStatus = outcome.status;

  // 1. Evaluate Expiration First
  if (t >= new Date(outcome.expiresAt)) {
    if (outcome.isAiOutcomeAdapter) {
      outcome.status = "EXPIRED";
      outcome.rawAiOutcome.status = "EXPIRED";
      if (outcome.rawAiOutcome.executionStatus === "WAITING") {
        outcome.rawAiOutcome.executionStatus = "EXPIRED";
      }
      outcome.rawAiOutcome.outcomePrice = price;
      outcome.rawAiOutcome.outcomeTime = t;
      outcome.rawAiOutcome.simulationNotes = outcome.rawAiOutcome.simulationNotes || [];
      if (!outcome.rawAiOutcome.simulationNotes.includes("Trade expired")) {
        outcome.rawAiOutcome.simulationNotes.push("Trade expired");
      }
    } else {
      outcome.status = "EXPIRED";
    }
    outcome.outcomePrice = price;
    outcome.outcomeTime = t;
    outcome.outcomeReason = "PRICE_MONITOR";
    statusChanged = true;
  }

  // 2. Evaluate PENDING -> ACTIVE transition
  if (!statusChanged && outcome.status === "PENDING") {
    let entryTriggered = false;
    const entry = outcome.entry;

    if (entry.entryType === "RANGE") {
      if (price >= entry.entryLow && price <= entry.entryHigh) {
        entryTriggered = true;
      }
    } else if (entry.entryPrice !== null) {
      if (outcome.action === "BUY") {
        if (price <= entry.entryPrice) {
          entryTriggered = true;
        }
      } else if (outcome.action === "SELL") {
        if (price >= entry.entryPrice) {
          entryTriggered = true;
        }
      }
    }

    if (entryTriggered) {
      if (outcome.isAiOutcomeAdapter) {
        if (outcome.rawAiOutcome.executionStatus === "BLOCKED") {
          // Skip if already blocked
        } else {
          // Perform risk manager check
          const decision = await canOpenTrade(outcome.pair, t, outcome.rawAiOutcome.recommendationId);
          outcome.rawAiOutcome.simulationNotes = outcome.rawAiOutcome.simulationNotes || [];

          if (decision.allowed) {
            outcome.status = "ACTIVE";
            outcome.rawAiOutcome.status = "ACTIVE";
            outcome.rawAiOutcome.executionStatus = "EXECUTED";
            outcome.rawAiOutcome.simulatedEntryPrice = price;
            outcome.rawAiOutcome.simulatedEntryTime = t;
            outcome.rawAiOutcome.simulatedSL = outcome.stopLoss;
            if (!outcome.rawAiOutcome.simulationNotes.includes("Trade allowed")) {
              outcome.rawAiOutcome.simulationNotes.push("Trade allowed");
            }
            if (!outcome.rawAiOutcome.simulationNotes.includes("Entry triggered")) {
              outcome.rawAiOutcome.simulationNotes.push("Entry triggered");
            }
            statusChanged = true;
            logger.info("outcome.state_transition.allowed", {
              messageKey: outcome.messageKey,
              triggerPrice: price
            });
          } else {
            // Blocked by Risk Manager
            outcome.rawAiOutcome.executionStatus = "BLOCKED";
            outcome.rawAiOutcome.blockReason = decision.reason;
            outcome.rawAiOutcome.blockedAt = t;
            
            const readableReason = formatBlockReason(decision.reason);
            const noteText = `Trade blocked: ${readableReason}`;
            if (!outcome.rawAiOutcome.simulationNotes.includes(noteText)) {
              outcome.rawAiOutcome.simulationNotes.push(noteText);
            }
            // persist executionStatus change
            statusChanged = true;
            logger.info("outcome.state_transition.blocked", {
              messageKey: outcome.messageKey,
              reason: decision.reason
            });
          }
        }
      } else {
        outcome.status = "ACTIVE";
        statusChanged = true;
      }
    }
  }

  // Track Peak Prices Seen (only if ACTIVE or PARTIAL_TP)
  if (["ACTIVE", "PARTIAL_TP"].includes(outcome.status)) {
    if (outcome.highestPriceSeen === null || price > outcome.highestPriceSeen) {
      outcome.highestPriceSeen = price;
    }
    if (outcome.lowestPriceSeen === null || price < outcome.lowestPriceSeen) {
      outcome.lowestPriceSeen = price;
    }
  }

  // 3. Evaluate ACTIVE / PARTIAL_TP outcomes
  if (!statusChanged && ["ACTIVE", "PARTIAL_TP"].includes(outcome.status)) {
    // Check Stop Loss hit
    if (outcome.stopLoss !== null) {
      let slHit = false;
      if (outcome.action === "BUY") {
        if (price <= outcome.stopLoss) {
          slHit = true;
        }
      } else if (outcome.action === "SELL") {
        if (price >= outcome.stopLoss) {
          slHit = true;
        }
      }

      if (slHit) {
        if (outcome.isAiOutcomeAdapter) {
          outcome.rawAiOutcome.simulationNotes = outcome.rawAiOutcome.simulationNotes || [];
          if (outcome.status === "PARTIAL_TP") {
            outcome.status = "BREAK_EVEN";
            outcome.rawAiOutcome.status = "BREAK_EVEN";
            outcome.rawAiOutcome.exitType = "BREAK_EVEN";
            outcome.rawAiOutcome.closedAtBreakEven = true;
            if (!outcome.rawAiOutcome.simulationNotes.includes("Closed at breakeven")) {
              outcome.rawAiOutcome.simulationNotes.push("Closed at breakeven");
            }
          } else {
            outcome.status = "SL";
            outcome.rawAiOutcome.status = "SL";
            outcome.rawAiOutcome.exitType = "SL";
            if (!outcome.rawAiOutcome.simulationNotes.includes("Closed at SL")) {
              outcome.rawAiOutcome.simulationNotes.push("Closed at SL");
            }
          }
          outcome.rawAiOutcome.outcomePrice = price;
          outcome.rawAiOutcome.outcomeTime = t;

          // Calculate riskRMultiple using plannedRiskR
          const entry = outcome.rawAiOutcome.simulatedEntryPrice;
          const exit = outcome.rawAiOutcome.outcomePrice;
          const sl = outcome.rawAiOutcome.simulatedSL !== null ? outcome.rawAiOutcome.simulatedSL : outcome.rawAiOutcome.sl;
          const plannedRiskR = outcome.rawAiOutcome.plannedRiskR !== undefined && outcome.rawAiOutcome.plannedRiskR !== null ? outcome.rawAiOutcome.plannedRiskR : 1;
          if (entry && exit && sl && entry !== sl) {
            const riskPoints = Math.abs(entry - sl);
            if (riskPoints > 0) {
              let r = 0;
              if (outcome.status === "BREAK_EVEN") {
                r = 0;
              } else if (outcome.rawAiOutcome.direction === "BUY") {
                r = ((exit - entry) / riskPoints) * plannedRiskR;
              } else if (outcome.rawAiOutcome.direction === "SELL") {
                r = ((entry - exit) / riskPoints) * plannedRiskR;
              }
              outcome.rawAiOutcome.riskRMultiple = Number(r.toFixed(2));
            }
          }
        } else {
          outcome.status = "SL_HIT";
        }
        outcome.outcomePrice = price;
        outcome.outcomeTime = t;
        outcome.outcomeReason = "PRICE_MONITOR";
        statusChanged = true;
        logger.info("outcome.state_transition", {
          messageKey: outcome.messageKey,
          from: originalStatus,
          to: outcome.status,
          triggerPrice: price,
        });
      }
    }

    // Check Targets hit (only if SL is not hit)
    if (!statusChanged && Array.isArray(outcome.targets) && outcome.targets.length > 0) {
      let newlyHitTarget = false;

      outcome.targets.forEach((tgt) => {
        if (!tgt.isHit) {
          let targetReached = false;
          if (outcome.action === "BUY") {
            if (price >= tgt.price) {
              targetReached = true;
            }
          } else if (outcome.action === "SELL") {
            if (price <= tgt.price) {
              targetReached = true;
            }
          }

          if (targetReached) {
            tgt.isHit = true;
            tgt.hitAt = t;
            tgt.hitPrice = price;
            newlyHitTarget = true;
            targetsChanged = true;

            if (!outcome.hitTargets.includes(tgt.targetNumber)) {
              outcome.hitTargets.push(tgt.targetNumber);
            }
          }
        }
      });

      if (targetsChanged) {
        // Sort and find max hit
        outcome.hitTargets.sort((a, b) => a - b);
        outcome.maxTargetHit = outcome.hitTargets.length > 0 ? Math.max(...outcome.hitTargets) : 0;

        const totalTargets = outcome.targets.length;
        const hitCount = outcome.hitTargets.length;

        if (hitCount === totalTargets) {
          if (outcome.isAiOutcomeAdapter) {
            outcome.status = "FULL_TP";
            outcome.rawAiOutcome.status = "FULL_TP";
            outcome.rawAiOutcome.exitType = "TP";
            outcome.rawAiOutcome.outcomePrice = price;
            outcome.rawAiOutcome.outcomeTime = t;
            outcome.rawAiOutcome.simulationNotes = outcome.rawAiOutcome.simulationNotes || [];
            if (!outcome.rawAiOutcome.simulationNotes.includes("Closed at TP3")) {
              outcome.rawAiOutcome.simulationNotes.push("Closed at TP3");
            }

            // Calculate riskRMultiple using plannedRiskR
            const entry = outcome.rawAiOutcome.simulatedEntryPrice;
            const exit = outcome.rawAiOutcome.outcomePrice;
            const sl = outcome.rawAiOutcome.simulatedSL !== null ? outcome.rawAiOutcome.simulatedSL : outcome.rawAiOutcome.sl;
            const plannedRiskR = outcome.rawAiOutcome.plannedRiskR !== undefined && outcome.rawAiOutcome.plannedRiskR !== null ? outcome.rawAiOutcome.plannedRiskR : 1;
            if (entry && exit && sl && entry !== sl) {
              const riskPoints = Math.abs(entry - sl);
              if (riskPoints > 0) {
                let r = 0;
                if (outcome.rawAiOutcome.direction === "BUY") {
                  r = ((exit - entry) / riskPoints) * plannedRiskR;
                } else if (outcome.rawAiOutcome.direction === "SELL") {
                  r = ((entry - exit) / riskPoints) * plannedRiskR;
                }
                outcome.rawAiOutcome.riskRMultiple = Number(r.toFixed(2));
              }
            }
          } else {
            outcome.status = "FULL_TP";
          }
          outcome.outcomePrice = price;
          outcome.outcomeTime = t;
          outcome.outcomeReason = "PRICE_MONITOR";
          statusChanged = true;
        } else if (hitCount > 0) {
          if (outcome.isAiOutcomeAdapter) {
            outcome.status = "PARTIAL_TP";
            outcome.rawAiOutcome.status = "PARTIAL_TP";
            
            outcome.rawAiOutcome.simulationNotes = outcome.rawAiOutcome.simulationNotes || [];
            
            if (outcome.hitTargets.includes(1)) {
              const entryVal = outcome.rawAiOutcome.simulatedEntryPrice !== null ? outcome.rawAiOutcome.simulatedEntryPrice : price;
              outcome.rawAiOutcome.simulatedSL = entryVal;
              outcome.stopLoss = entryVal; // update mapped property
              
              if (!outcome.rawAiOutcome.simulationNotes.includes("TP1 reached")) {
                outcome.rawAiOutcome.simulationNotes.push("TP1 reached");
              }
              if (!outcome.rawAiOutcome.simulationNotes.includes("Stop moved to breakeven")) {
                outcome.rawAiOutcome.simulationNotes.push("Stop moved to breakeven");
              }
            } else {
              const latestTpHit = `TP${Math.max(...outcome.hitTargets)} reached`;
              if (!outcome.rawAiOutcome.simulationNotes.includes(latestTpHit)) {
                outcome.rawAiOutcome.simulationNotes.push(latestTpHit);
              }
            }
          } else {
            outcome.status = "PARTIAL_TP";
          }
          outcome.outcomePrice = price;
          outcome.outcomeTime = t;
          outcome.outcomeReason = "PRICE_MONITOR";
          statusChanged = true;
        }

        if (statusChanged) {
          logger.info("outcome.state_transition", {
            messageKey: outcome.messageKey,
            from: originalStatus,
            to: outcome.status,
            triggerPrice: price,
            hitTargets: outcome.hitTargets,
          });
        }
      }
    }
  }

  outcome.lastCheckedAt = new Date();
  
  // Save changes if anything was updated
  const saved = await saveOutcome(outcome);

  if (statusChanged) {
    try {
      const signalId = saved.signalId;
      const pair = saved.pair;
      const newSignalState = OUTCOME_TO_SIGNAL_STATE_MAP[saved.status];
      if (newSignalState && signalId) {
        await updateParsedSignalState(signalId, newSignalState);
        updateInMemorySignalState(pair, signalId, newSignalState);
      }

      if (saved.status === "PARTIAL_TP" && signalId) {
        const adj = getLifecycleAdjustments(saved);
        if (adj) {
          await updateParsedSignalLifecycle(signalId, adj.effectiveStopLoss, adj.remainingTargets, adj.lifecycleStage);
          updateInMemorySignalLifecycle(pair, signalId, adj.effectiveStopLoss, adj.remainingTargets, adj.lifecycleStage);
        }
      }
    } catch (syncErr) {
      logger.error("outcome.sync_failed", {
        messageKey: saved.messageKey,
        error: syncErr.message,
      });
    }
  }

  return saved;
}


/**
 * Processes manual updates or result messages to force states / record reasons
 * @param {string} messageKey - The "channel:messageId" primary key
 * @param {string} status - New target status
 * @param {string} reason - CHANNEL_RESULT | MANUAL_OVERRIDE
 * @param {Object} data - Optional outcome fields (price, time, hitTargets)
 * @returns {Promise<Object|null>} The updated outcome or null if not found
 */
export async function updateOutcomeStatus(messageKey, status, reason, data = {}) {
  const outcome = await getOutcomeByMessageKey(messageKey);
  if (!outcome) {
    return null;
  }

  const originalStatus = outcome.status;
  if (originalStatus === status) {
    return outcome;
  }

  const originalRank = STATE_HIERARCHY[originalStatus] || 0;
  const newRank = STATE_HIERARCHY[status] || 0;

  if (originalRank >= 4) {
    logger.warn("outcome.regression_lock.blocked_terminal", { messageKey, originalStatus, targetStatus: status });
    return outcome;
  }

  if (originalRank > newRank) {
    logger.warn("outcome.regression_lock.blocked_downgrade", { messageKey, originalStatus, targetStatus: status });
    return outcome;
  }

  outcome.status = status;
  outcome.outcomeReason = reason;
  outcome.outcomeTime = data.time ? new Date(data.time) : new Date();

  if (typeof data.price === "number") {
    outcome.outcomePrice = data.price;
  }

  if (Array.isArray(data.hitTargets)) {
    if (!Array.isArray(outcome.hitTargets)) {
      outcome.hitTargets = [];
    }
    outcome.hitTargets = [...new Set([...outcome.hitTargets, ...data.hitTargets])].sort((a, b) => a - b);
    outcome.maxTargetHit = outcome.hitTargets.length > 0 ? Math.max(...outcome.hitTargets) : 0;
  }

  outcome.lastCheckedAt = new Date();

  try {
    const saved = await saveOutcome(outcome);
    logger.info("outcome.manual_override", {
      messageKey,
      from: originalStatus,
      to: status,
      reason,
    });

    if (originalStatus !== status || Array.isArray(data.hitTargets)) {
      try {
        const signalId = saved.signalId;
        const pair = saved.pair;
        const newSignalState = OUTCOME_TO_SIGNAL_STATE_MAP[saved.status];
        if (newSignalState && signalId) {
          await updateParsedSignalState(signalId, newSignalState);
          updateInMemorySignalState(pair, signalId, newSignalState);
        }

        if (saved.status === "PARTIAL_TP" && signalId) {
          const adj = getLifecycleAdjustments(saved);
          if (adj) {
            await updateParsedSignalLifecycle(signalId, adj.effectiveStopLoss, adj.remainingTargets, adj.lifecycleStage);
            updateInMemorySignalLifecycle(pair, signalId, adj.effectiveStopLoss, adj.remainingTargets, adj.lifecycleStage);
          }
        }
      } catch (syncErr) {
        logger.error("outcome.sync_failed", {
          messageKey: saved.messageKey,
          error: syncErr.message,
        });
      }
    }

    return saved;
  } catch (error) {
    logger.error("outcome.manual_override_failed", {
      messageKey,
      error: error.message,
    });
    return null;
  }
}

/**
 * Processes an incoming UPDATE_SIGNAL or RESULT_SIGNAL to update target outcome
 * @param {Object} signal - The stored update/result ParsedSignal document
 * @returns {Promise<Object|null>} The updated outcome or null
 */
export async function processSignalUpdate(signal) {
  const classification = signal.parserClassification || signal.classification;
  if (!["UPDATE_SIGNAL", "RESULT_SIGNAL", "CANCEL_SIGNAL"].includes(classification)) {
    return null;
  }

  // Find active/pending outcomes for this pair
  const activeOutcomes = await getActiveAndPendingOutcomes(signal.pair);
  const matchingOutcomes = activeOutcomes.filter(
    (o) => o.channel === signal.channel && (!signal.action || o.action === signal.action)
  );

  if (matchingOutcomes.length === 0) {
    return null;
  }

  // Sort by age: newest first (standard matching heuristic)
  matchingOutcomes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const targetOutcome = matchingOutcomes[0];

  // Map the update to status and reason
  let targetStatus = null;
  const reason = "CHANNEL_RESULT";

  if (classification === "CANCEL_SIGNAL") {
    targetStatus = "CANCELLED";
  } else if (classification === "UPDATE_SIGNAL") {
    if (
      signal.managementAction === "CLOSE_TRADE" ||
      signal.managementAction === "CANCEL_SIGNAL"
    ) {
      targetStatus = "CANCELLED";
    } else if (signal.managementAction === "CLOSE_PARTIAL") {
      targetStatus = "PARTIAL_TP";
    }
  } else if (classification === "RESULT_SIGNAL") {
    if (signal.resultAction?.type === "TARGET_HIT") {
      // If we hit target and we know target number
      const targetNum = signal.resultAction?.targetIndex !== undefined ? (signal.resultAction.targetIndex + 1) : 1;
      
      // Update that specific target
      targetOutcome.targets.forEach((t) => {
        if (t.targetNumber === targetNum) {
          t.isHit = true;
          t.hitAt = signal.createdAt || new Date();
          t.hitPrice = t.price;
        }
      });

      if (!targetOutcome.hitTargets.includes(targetNum)) {
        targetOutcome.hitTargets.push(targetNum);
      }
      targetOutcome.hitTargets.sort((a, b) => a - b);
      targetOutcome.maxTargetHit = Math.max(...targetOutcome.hitTargets);

      const allHit = targetOutcome.targets.length > 0 && targetOutcome.targets.every((t) => t.isHit);
      targetStatus = allHit ? "FULL_TP" : "PARTIAL_TP";
    } else if (signal.resultAction?.type === "STOP_LOSS_HIT") {
      targetStatus = "SL_HIT";
    } else {
      targetStatus = "FULL_TP";
    }
  }

  if (targetStatus) {
    const outcomePrice = signal.resultAction?.hitPrice || signal.entry || targetOutcome.entry.entryPrice;
    return updateOutcomeStatus(targetOutcome.messageKey, targetStatus, reason, {
      price: outcomePrice,
      time: signal.createdAt || new Date(),
      hitTargets: targetOutcome.hitTargets,
    });
  }

  return null;
}

export function getLifecycleAdjustments(outcome) {
  const hitTargets = outcome.hitTargets || [];
  if (hitTargets.length === 0) {
    return null;
  }

  const sortedHits = [...hitTargets].sort((a, b) => a - b);
  const maxHit = sortedHits[sortedHits.length - 1];
  const totalTargets = (outcome.targets || []).length;

  if (maxHit >= totalTargets) {
    return null;
  }

  let newStopLoss = outcome.stopLoss;
  if (maxHit === 1) {
    newStopLoss = outcome.entry.entryPrice;
  } else if (maxHit > 1) {
    const prevTarget = outcome.targets.find(t => t.targetNumber === maxHit - 1);
    if (prevTarget) {
      newStopLoss = prevTarget.price;
    }
  }

  const remainingTargets = outcome.targets
    .filter(t => t.targetNumber > maxHit)
    .map(t => t.price);

  return {
    effectiveStopLoss: newStopLoss,
    remainingTargets,
    lifecycleStage: maxHit
  };
}


