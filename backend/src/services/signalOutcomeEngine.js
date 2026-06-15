import { saveOutcome, getOutcomeByMessageKey, getActiveAndPendingOutcomes } from "./signalOutcomeStore.js";
import { logger } from "../utils/logger.js";

const DEFAULT_EXPIRATION_HOURS = 72;

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
  if (Array.isArray(signal.targets)) {
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
      }
    });
  } else if (signal.target) {
    const price = Number(signal.target);
    if (!isNaN(price)) {
      targets.push({
        targetNumber: 1,
        price,
        isHit: false,
        hitAt: null,
        hitPrice: null,
      });
    }
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

  // If already in a terminal state (FULL_TP, SL_HIT, EXPIRED, CANCELLED), skip price updates
  if (["FULL_TP", "SL_HIT", "EXPIRED", "CANCELLED"].includes(outcome.status)) {
    return outcome;
  }

  let statusChanged = false;
  let targetsChanged = false;
  const originalStatus = outcome.status;

  // 1. Evaluate Expiration First
  if (t >= new Date(outcome.expiresAt)) {
    outcome.status = "EXPIRED";
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
      outcome.status = "ACTIVE";
      statusChanged = true;
      logger.info("outcome.state_transition", {
        messageKey: outcome.messageKey,
        from: originalStatus,
        to: "ACTIVE",
        triggerPrice: price,
      });
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
        outcome.status = "SL_HIT";
        outcome.outcomePrice = price;
        outcome.outcomeTime = t;
        outcome.outcomeReason = "PRICE_MONITOR";
        statusChanged = true;
        logger.info("outcome.state_transition", {
          messageKey: outcome.messageKey,
          from: originalStatus,
          to: "SL_HIT",
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
          outcome.status = "FULL_TP";
          outcome.outcomePrice = price;
          outcome.outcomeTime = t;
          outcome.outcomeReason = "PRICE_MONITOR";
          statusChanged = true;
        } else if (hitCount > 0) {
          outcome.status = "PARTIAL_TP";
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
  return saveOutcome(outcome);
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
  if (!["UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(classification)) {
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

  if (classification === "UPDATE_SIGNAL") {
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

