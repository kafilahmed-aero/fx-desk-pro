import crypto from "crypto";
import mongoose from "mongoose";
import { AiRecommendationOutcome } from "../models/aiRecommendationOutcomeModel.js";
import { connectedClients, broadcastToEAs } from "./mt5SyncService.js";
import { RECOVERY_MANAGER_POLICY } from "../config/recoveryManagerPolicy.js";
import { startPositionMonitoring } from "./positionManagerService.js";
import { PhoenixRecoveryAudit } from "../models/phoenixRecoveryAuditModel.js";
import { phoenixDeepFreeze } from "./phoenixFeatureEngine.js";
import { logger } from "../utils/logger.js";

// Offline Cache Map for Recovery Audits
export const localPhoenixRecoveryAudits = new Map();

let recoveryAttemptCount = 0;
let isRecoveryRunning = false;

/**
 * Triggers the main state synchronization and recovery pipeline.
 * 
 * @param {Array} mt5Positions - Open positions reported by the broker
 * @returns {Promise<Object>} Recovery status summary
 */
export async function executeRecoveryWorkflow(mt5Positions = null, options = {}) {
  if (isRecoveryRunning) {
    return { status: "ALREADY_RUNNING" };
  }
  isRecoveryRunning = true;
  recoveryAttemptCount++;

  const now = options.now || new Date();
  const hash = crypto.createHash("sha256")
    .update(`RECOVERY:${now.getTime()}:${recoveryAttemptCount}`)
    .digest("hex")
    .substring(0, 12);
  const recoveryId = `RECOVERY-${hash}`;

  await saveRecoveryAudit({
    recoveryId,
    timestamp: now,
    event: "RECOVERY_STARTED",
    details: { attempt: recoveryAttemptCount, positionsCount: mt5Positions ? mt5Positions.length : null },
    policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
  });

  logger.info("recovery_manager.started", { recoveryId, attempt: recoveryAttemptCount });

  // 1. Verify MT5 connection status
  const clientCount = connectedClients.size;
  const isConnected = clientCount > 0 || options.forceConnected === true;
  if (!isConnected) {
    if (recoveryAttemptCount >= RECOVERY_MANAGER_POLICY.maxRecoveryAttempts) {
      await saveRecoveryAudit({
        recoveryId: `RECOVERY-FAIL-${hash}`,
        timestamp: now,
        event: "RECOVERY_FAILED",
        details: { reason: "MT5_CONNECTION_UNAVAILABLE", attempts: recoveryAttemptCount },
        policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
      });
      isRecoveryRunning = false;
      return { status: "FAILED", reason: "MT5_CONNECTION_UNAVAILABLE" };
    } else {
      await saveRecoveryAudit({
        recoveryId: `RECOVERY-RETRY-${hash}`,
        timestamp: now,
        event: "RECOVERY_RETRIED",
        details: { reason: "MT5_CONNECTION_UNAVAILABLE", attempt: recoveryAttemptCount },
        policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
      });
      isRecoveryRunning = false;
      return { status: "RETRYING", reason: "MT5_CONNECTION_UNAVAILABLE" };
    }
  }

  // 2. Load DB active outcomes (handles MongoDB offline fallback)
  const isMongoConnected = mongoose.connection.readyState === 1;
  let activeDbTrades = [];
  if (isMongoConnected) {
    activeDbTrades = await AiRecommendationOutcome.find({
      simulationMode: "DEMO",
      status: { $in: ["ACTIVE", "PARTIAL_TP", "BREAK_EVEN"] }
    });
  } else {
    activeDbTrades = options.mockActiveTrades || [];
  }

  const livePositions = mt5Positions || options.mockPositions || [];
  const recoveredList = [];
  const closedList = [];
  const discrepancies = [];

  // 3. Match and Synchronize position parameters (MT5 is source of truth)
  for (const trade of activeDbTrades) {
    // Match by ticket or magicNumber
    const match = livePositions.find(
      pos => String(pos.ticket) === String(trade.mt5TicketId) ||
             Number(pos.magic) === Number(trade.magicNumber)
    );

    if (match) {
      // Scenario: Position still open
      let modified = false;
      
      if (trade.executionState !== "POSITION_OPEN") {
        trade.executionState = "POSITION_OPEN";
        modified = true;
      }
      if (!trade.mt5TicketId) {
        trade.mt5TicketId = String(match.ticket);
        modified = true;
      }
      if (match.volume && trade.volume !== match.volume) {
        trade.volume = match.volume;
        modified = true;
      }
      if (match.sl && trade.simulatedSL !== match.sl) {
        trade.simulatedSL = match.sl;
        modified = true;
      }

      if (modified) {
        if (isMongoConnected) await trade.save();
        discrepancies.push({
          recommendationId: trade.recommendationId,
          type: "PARAMETER_MISMATCH_RESOLVED",
          ticket: match.ticket
        });
      }

      recoveredList.push({
        recommendationId: trade.recommendationId,
        ticket: match.ticket,
        volume: match.volume
      });

      await saveRecoveryAudit({
        recoveryId: `REC-POS-${trade.recommendationId}-${hash}`,
        timestamp: new Date(),
        event: "RECOVERED_POSITION",
        details: { recommendationId: trade.recommendationId, ticket: match.ticket, state: "OPEN" },
        policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
      });

    } else {
      // Scenario: Position already closed while offline
      if (trade.executionState === "POSITION_OPEN") {
        trade.status = "CANCELLED";
        trade.executionState = "SYNC_COMPLETE";
        trade.outcomeTime = now;
        
        const closeMsg = "Recovery: Active trade not found on MT5. Closed locally.";
        if (!trade.simulationNotes.includes(closeMsg)) {
          trade.simulationNotes.push(closeMsg);
        }

        if (isMongoConnected) await trade.save();

        closedList.push({
          recommendationId: trade.recommendationId,
          ticket: trade.mt5TicketId
        });

        await saveRecoveryAudit({
          recoveryId: `REC-CLOSE-${trade.recommendationId}-${hash}`,
          timestamp: new Date(),
          event: "RECOVERED_CLOSED_TRADE",
          details: { recommendationId: trade.recommendationId, ticket: trade.mt5TicketId },
          policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
        });
      }
    }
  }

  // 4. Check for Zombie Positions (MT5 position exists but missing/closed in DB)
  for (const pos of livePositions) {
    const dbMatch = activeDbTrades.find(
      t => String(t.mt5TicketId) === String(pos.ticket) ||
           Number(t.magicNumber) === Number(pos.magic)
    );

    if (!dbMatch) {
      // Inconsistency: Missing or closed in DB
      discrepancies.push({
        type: "ZOMBIE_POSITION_DETECTED",
        ticket: pos.ticket,
        magic: pos.magic
      });

      await saveRecoveryAudit({
        recoveryId: `INCONSISTENCY-${pos.ticket}-${hash}`,
        timestamp: new Date(),
        event: "INCONSISTENCY_DETECTED",
        details: { ticket: pos.ticket, magic: pos.magic, issue: "ZOMBIE_POSITION" },
        policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
      });

      // Send close instruction to connected EA to protect account margin
      broadcastToEAs({
        action: "CLOSE_ORDER",
        recommendationId: `REC-RECOVER-${pos.ticket}`,
        magicNumber: Number(pos.magic),
        ticket: String(pos.ticket)
      }, options.forceAccountId || null);
    }
  }

  // 5. Resume Position Manager
  startPositionMonitoring();

  await saveRecoveryAudit({
    recoveryId: `RECOVERY-SUCCESS-${hash}`,
    timestamp: now,
    event: "RECOVERY_COMPLETED",
    details: {
      recoveredCount: recoveredList.length,
      closedCount: closedList.length,
      discrepanciesCount: discrepancies.length
    },
    policyVersion: RECOVERY_MANAGER_POLICY.policyVersion
  });

  logger.info("recovery_manager.completed", {
    recoveryId,
    recovered: recoveredList.length,
    closed: closedList.length,
    discrepancies: discrepancies.length
  });

  isRecoveryRunning = false;
  
  return {
    status: "COMPLETED",
    recoveredList,
    closedList,
    discrepancies
  };
}

/**
 * Saves a recovery audit record to database or local Map cache.
 */
export async function saveRecoveryAudit(auditRecord = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const newDoc = new PhoenixRecoveryAudit(auditRecord);
    const saved = await newDoc.save();
    return phoenixDeepFreeze(saved.toObject());
  } else {
    const frozen = phoenixDeepFreeze({ ...auditRecord });
    localPhoenixRecoveryAudits.set(auditRecord.recoveryId, frozen);
    return frozen;
  }
}

/**
 * Exposes read-only queries for recovery audits.
 */
export async function getRecoveryAudits(filter = {}, options = {}) {
  const isMongoConnected = mongoose.connection.readyState === 1;

  if (isMongoConnected) {
    const query = PhoenixRecoveryAudit.find(filter);
    if (options.sort) query.sort(options.sort);
    if (options.limit) query.limit(options.limit);
    if (options.skip) query.skip(options.skip);
    
    const docs = await query.exec();
    return phoenixDeepFreeze(docs.map(doc => doc.toObject()));
  } else {
    let list = Array.from(localPhoenixRecoveryAudits.values());
    
    Object.keys(filter).forEach(key => {
      list = list.filter(item => item[key] === filter[key]);
    });

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return phoenixDeepFreeze(list);
  }
}

/**
 * Reset attempt counts for manual triggers.
 */
export function resetRecoveryAttempts() {
  recoveryAttemptCount = 0;
}
